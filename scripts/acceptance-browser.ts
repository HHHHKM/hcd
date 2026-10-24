import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import fastifyStatic from '@fastify/static';
import { chromium, type Page } from 'playwright';
import { createApp } from '../packages/server/src/app';
import { openDatabase } from '../packages/server/src/db';
import { createOutboxWorker, type NotificationMail } from '../packages/server/src/outbox';

// Disposable local HTTP/browser acceptance. No real mail or external integration.
const directory = mkdtempSync(join(tmpdir(), 'hcd-browser-acceptance-'));
const db = openDatabase(join(directory, 'hcd.sqlite'));
const reservation = createServer();
await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((done) => reservation.close(() => done()));
const origin = `http://127.0.0.1:${port}`;
const sent: NotificationMail[] = [];
const delivery = {
  async send(mail: NotificationMail) {
    sent.push(mail);
  },
};
const secretKey = 'local-disposable-browser-acceptance-secret';
const app = createApp({
  db,
  dataDir: directory,
  seed: true,
  appUrl: origin,
  secretKey,
  mailDelivery: delivery,
  logger: { level: 'silent' },
});
db.prepare("UPDATE users SET locale='en'").run();
db.prepare('DELETE FROM submissions').run();
await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/', wildcard: false });
app.setNotFoundHandler((request, reply) =>
  request.headers.accept?.includes('text/html')
    ? reply.type('text/html').sendFile('index.html')
    : reply.code(404).send({ error: { code: 'NOT_FOUND' } }),
);
await app.listen({ host: '127.0.0.1', port });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'en-US',
  colorScheme: 'light',
});
const page = await context.newPage();
const docId = 'd_aaaaaaab';
const observations: Record<string, unknown>[] = [];
const consoleMessages: string[] = [];
const pageErrors: string[] = [];
function trackPage(p: Page, label: string) {
  p.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  p.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) consoleMessages.push(`${label}: ${message.text()}`);
  });
}
trackPage(page, 'member');
let stage = 'setup';
let previewId = '';
let blockedExternalRequests = 0;
async function blockExternal(ctx: typeof context) {
  await ctx.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blockedExternalRequests++;
    return route.abort();
  });
}
await blockExternal(context);
const quotaWindow = async () => {
  process.stdout.write('Waiting for the normal per-user quota window between acceptance batches.\n');
  await page.waitForTimeout(30000);
  await page.waitForTimeout(30000);
  await page.waitForTimeout(1000);
};
const screenshot = async (p: Page, name: string) => p.screenshot({ path: `outputs/D2-${name}.png` });
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await context.request.fetch(`${origin}/api/v1${path}`, {
    method,
    data: body,
    headers: { origin, 'x-hcd-request': '1' },
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}
async function login(p: Page, password = 'hcd-demo-2026') {
  await p.goto(`${origin}/login`);
  await p.locator('input[type="email"]').fill('d@example.com');
  await p.locator('input[type="password"]').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.locator('.left-sidebar').waitFor();
}
async function reading(p: Page) {
  await p.goto(`${origin}/d/${docId}`);
  await p.locator('.document-page [data-hcd-node-id="n_aaaaaaab"]').first().waitFor();
}
async function nativeQuote(p: Page, shared = false) {
  const field = p
    .locator(`${shared ? '.shared-page' : '.document-page'} [data-hcd-node-id="n_aaaaaaab"][data-hcd-field="text"]`)
    .first();
  await field.scrollIntoViewIfNeeded();
  const point = await field.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const at = node.textContent?.indexOf('已经') ?? -1;
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 2);
        const r = range.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    throw new Error('Fixture quote absent');
  });
  await p.mouse.dblclick(point.x, point.y);
  await p.getByRole('button', { name: 'Comment on selected text', exact: true }).click();
}
async function layout(p: Page, width: number, theme: string, name: string) {
  await p.setViewportSize({ width, height: 1000 });
  await p.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
  if (name === 'reading') await p.locator('.document-toolbar button').first().waitFor();
  await p.waitForTimeout(100);
  const measured = await p.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    contentWidth: document.querySelector('.module-content')?.getBoundingClientRect().width,
    background: getComputedStyle(document.querySelector('.app') ?? document.body).backgroundColor,
    primaryButtons: [...document.querySelectorAll('.document-toolbar button')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => ({
        text: e.textContent?.trim(),
        width: e.getBoundingClientRect().width,
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
      })),
  }));
  assert(measured.scrollWidth <= width, `${name} overflow: ${JSON.stringify(measured)}`);
  if (name === 'reading') assert(measured.primaryButtons.length > 0, 'D2 reading toolbar has visible actions');
  if (name === 'reading' && width >= 1280) assert((measured.contentWidth ?? 0) >= 680, JSON.stringify(measured));
  assert(
    measured.primaryButtons.every((button) => button.scrollWidth <= button.clientWidth + 1),
    `${name}: clipped toolbar button`,
  );
  if (name === 'reading' && width === 805) {
    const sidebarActions = p.locator('.left-sidebar .primary-nav');
    for (const label of ['All documents', 'Recently viewed']) {
      const action = sidebarActions.getByRole('button', { name: label, exact: true });
      assert(await action.isVisible(), `C8 compact sidebar ${label} remains accessible`);
      assert.equal((await action.innerText()).trim(), '', 'C8 compact sidebar hides labels without clipping text');
      const withinBounds = await action.evaluate((button) => {
        const icon = button.querySelector('svg')!.getBoundingClientRect();
        const bounds = button.getBoundingClientRect();
        const sidebar = button.closest('.left-sidebar')!.getBoundingClientRect();
        return (
          icon.left >= bounds.left &&
          icon.right <= bounds.right &&
          bounds.left >= sidebar.left &&
          bounds.right <= sidebar.right
        );
      });
      assert(withinBounds, 'C8 compact sidebar icons stay inside their buttons and sidebar');
    }
  }
  observations.push({ stage: name, width, theme, ...measured });
  await screenshot(p, `${name}-${width}-${theme}`);
}
try {
  stage = 'login/read';
  await login(page);
  await reading(page);
  observations.push({ stage, result: 'passed' });

  stage = 'native word comment';
  await nativeQuote(page);
  await page.getByRole('textbox', { name: 'Add a comment', exact: true }).fill('D2 v1 member quote');
  const posted = page.waitForResponse(
    (r) => r.url().endsWith(`/docs/${docId}/comments`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const comment = (await (await posted).json()).comment;
  assert(comment.anchor.quote?.length > 0);
  await page.goto(`${origin}/d/${docId}#comment-${comment.id}`);
  await page.locator('.hcd-anchor-highlight').first().waitFor();
  assert.equal(await page.locator('.hcd-anchor-highlight').first().textContent(), comment.anchor.quote);
  await screenshot(page, 'member-comment-highlight');
  observations.push({ stage, quote: comment.anchor.quote, result: 'passed' });

  stage = 'edit and submit';
  await reading(page);
  await page.getByRole('button', { name: 'Edit document', exact: true }).click();
  const inline = page.locator('.be-inline-preview').filter({ hasText: '本季度重点提升' }).first();
  await inline.click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.press('ControlOrMeta+End');
  await editor.press('End');
  await page.keyboard.insertText(' D2 browser acceptance 你好 🌍.');
  await editor.press('Shift+Enter');
  await page.keyboard.insertText('Second browser line.');
  await page.locator('.submission-message input').fill('D2 browser acceptance submission');
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith(`/docs/${docId}/submissions`) && r.request().method() === 'POST',
  );
  await page.locator('.edit-dock').getByRole('button', { name: 'Submit changes', exact: true }).click();
  assert.equal((await submitted).status(), 201);
  assert.equal((await api(`/docs/${docId}`)).doc.currentVersion, 1);
  observations.push({ stage, officialVersionBeforePublish: 1, result: 'passed' });

  stage = 'owner review/publish';
  await reading(page);
  await page.getByRole('button', { name: /Review & publish/ }).click();
  await page.getByText('D2 browser acceptance submission', { exact: true }).waitFor();
  await page.locator('.submission-select input').first().check();
  await page.getByRole('button', { name: 'Build merge preview', exact: true }).click();
  await page.locator('.preview-content').waitFor();
  previewId = new URL(page.url()).pathname.split('/').at(-1)!;
  assert.match(previewId, /^pv_/);
  await screenshot(page, 'review-before-publish');
  await page.getByRole('button', { name: 'Confirm & publish', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.preview-content'));
  assert.equal((await api(`/docs/${docId}`)).doc.currentVersion, 2);
  observations.push({ stage, publishedVersion: 2, result: 'passed' });

  stage = 'history comparison';
  await page.goto(`${origin}/d/${docId}/compare?from=1&to=2`);
  await page.locator('.version-comparison-result .change-list').waitFor();
  assert((await page.locator('.version-comparison-result').textContent())?.includes('D2 browser acceptance'));
  assert(!(await page.locator('.version-pair-metadata').textContent())?.includes('u_owner'));
  await screenshot(page, 'history-comparison');
  observations.push({ stage, result: 'passed' });

  stage = 'pinned guest fixtures';
  await api(`/docs/${docId}/comments`, {
    body: 'D2 hidden v2 member root',
    anchor: { moduleId: 'm_aaaaaaaa', version: 2 },
  });
  await api(`/docs/${docId}/comments`, { body: 'D2 hidden v2 reply on member v1 root', parentId: comment.id });
  const share = await api(`/docs/${docId}/share-links`, { role: 'commenter', versionPin: 1, showComments: true });
  const token = new URL(share.link.url).pathname.split('/').at(-1)!;
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  await blockExternal(guestContext);
  const guest = await guestContext.newPage();
  trackPage(guest, 'guest');
  await guest.goto(`${origin}/s/${token}`);
  await guest.getByLabel('Display name', { exact: true }).fill('D2 Local Guest');
  await guest.getByLabel('Email', { exact: true }).fill('guest-d2@fixture.test');
  await guest.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await guest.getByLabel('Six-digit code', { exact: true }).waitFor();
  await createOutboxWorker(db, delivery, origin, Date.now, secretKey).tick();
  const code = sent.findLast((mail) => mail.to === 'guest-d2@fixture.test')?.text.match(/\b\d{6}\b/)?.[0];
  assert(code);
  await guest.getByLabel('Six-digit code', { exact: true }).fill(code);
  await guest.getByRole('button', { name: 'Verify and open', exact: true }).click();
  await guest.locator('.shared-page').waitFor();
  let guestText = await guest.locator('.shared-page').textContent();
  assert(guestText?.includes('D2 v1 member quote'));
  assert(!guestText?.includes('D2 hidden v2 member root'));
  assert(!guestText?.includes('D2 hidden v2 reply'));
  assert(!guestText?.includes('D2 browser acceptance 你好'));
  const visible = await guestContext.request.get(`${origin}/api/v1/s/${token}/doc`);
  const pinned = await visible.json();
  assert.equal(pinned.doc.version, 1);
  assert(!('currentVersion' in pinned.doc));
  await nativeQuote(guest, true);
  await guest.getByLabel('Your comment', { exact: true }).fill('D2 guest v1 quote after v2 publish');
  const guestPosted = guest.waitForResponse(
    (r) => r.url().endsWith(`/s/${token}/comments`) && r.request().method() === 'POST',
  );
  await guest.getByRole('button', { name: 'Post comment', exact: true }).click();
  const guestRoot = (await (await guestPosted).json()).comment;
  await api(`/docs/${docId}/comments`, { body: 'D2 visible member reply to guest at v2', parentId: guestRoot.id });
  await guest.getByRole('button', { name: 'Refresh discussions', exact: true }).click();
  await guest.getByText('D2 visible member reply to guest at v2', { exact: false }).waitFor();
  const guestThread = guest
    .locator('.shared-discussions article')
    .filter({ hasText: 'D2 guest v1 quote after v2 publish' });
  await guestThread.getByRole('button', { name: 'Go to quoted content', exact: true }).click();
  await guest.locator('.hcd-anchor-highlight').first().waitFor();
  // Native smooth scrolling can briefly cross the viewport before settling.
  // Wait for that animation before resizing or issuing another navigation.
  await guest.waitForTimeout(1500);
  for (const theme of ['light', 'dark'])
    for (const width of [360, 805, 1440]) {
      await guest.setViewportSize({ width, height: 1000 });
      await guest.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
      await guestThread.getByRole('button', { name: 'Go to quoted content', exact: true }).click();
      await guest.waitForTimeout(1500);
      const outline = await guest
        .locator('[data-hcd-location-active="true"]')
        .first()
        .evaluate((e) => getComputedStyle(e).outlineStyle);
      assert.equal(outline, 'none');
      await guest.waitForFunction(() => {
        const r = document.querySelector('.hcd-anchor-highlight')?.getBoundingClientRect();
        return r && r.top >= 0 && r.bottom <= innerHeight;
      });
      await layout(guest, width, theme, 'guest-highlight');
    }
  observations.push({
    stage: 'pinned guest B2',
    hiddenMemberRoot: true,
    hiddenLateMemberReply: true,
    guestThreadReplyVisible: true,
    version: 1,
    noCurrentVersion: true,
  });

  stage = 'responsive screenshots';
  await quotaWindow();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await quotaWindow();
    for (const width of [360, 805, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
      await reading(page);
      if (width < 1200 && (await page.getByRole('button', { name: 'Close panel', exact: true }).isVisible()))
        await page.getByRole('button', { name: 'Close panel', exact: true }).click();
      if (width >= 1200) {
        await page.evaluate(() => localStorage.setItem('hcd.discussion.open', 'true'));
        await page.reload();
        await page.locator('.module-content').first().waitFor();
      }
      await layout(page, width, theme, 'reading');
      if (width === 1280) continue;
      await page.getByRole('button', { name: 'More document actions', exact: true }).click();
      await page.getByRole('menu').waitFor();
      const bounds = await page.getByRole('menu').boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      await screenshot(page, `toolbar-menu-${width}-${theme}`);
      const menuItems = await page.getByRole('menu').evaluate((menu) =>
        [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => {
          const r = item.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { text: item.textContent, pointerReachable: hit === item || item.contains(hit) };
        }),
      );
      assert(
        menuItems.every((item) => item.pointerReachable),
        'C5 every toolbar menu item is visible and clickable',
      );
      observations.push({ stage: 'toolbar-menu', width, theme, menuItems });
      await page.keyboard.press('Escape');
      await page.goto(`${origin}/d/${docId}/compare?from=1&to=2`);
      await page.locator('.version-comparison-result .change-list').waitFor();
      await layout(page, width, theme, 'comparison');
      await page.goto(`${origin}/d/${docId}/review/${previewId}`);
      await page.locator('.preview-content').waitFor();
      await layout(page, width, theme, 'review');
      await page.goto(`${origin}/settings`);
      await page.locator('.password-settings').waitFor();
      await layout(page, width, theme, 'settings');
    }
  }
  await guestContext.close();

  stage = 'change password / logout all';
  await page.setViewportSize({ width: 1440, height: 1000 });
  const other = await browser.newContext({ locale: 'en-US' });
  await blockExternal(other);
  const otherPage = await other.newPage();
  trackPage(otherPage, 'other session');
  await login(otherPage);
  await page.goto(`${origin}/settings`);
  await page.getByLabel('Current password', { exact: true }).fill('hcd-demo-2026');
  await page.getByLabel('New password', { exact: true }).fill('D2-new-password-2026');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await page.getByText('Password updated.', { exact: true }).waitFor();
  assert.equal((await other.request.get(`${origin}/api/v1/me`)).status(), 401);
  assert.equal((await context.request.get(`${origin}/api/v1/me`)).status(), 200);
  await login(otherPage, 'D2-new-password-2026');
  await page.getByRole('button', { name: 'Sign out all devices', exact: true }).click();
  await page.getByRole('group', { name: 'Confirm sign out all devices', exact: true }).waitFor();
  await screenshot(page, 'logout-all-inline-confirm');
  await page.getByRole('button', { name: 'Confirm sign out', exact: true }).click();
  await page.locator('.auth-card').waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  assert.equal((await other.request.get(`${origin}/api/v1/me`)).status(), 401);
  assert.equal((await context.request.get(`${origin}/api/v1/me`)).status(), 401);
  await login(page, 'D2-new-password-2026');
  await other.close();
  observations.push({
    stage,
    otherSessionRevokedOnPasswordChange: true,
    bothSessionsRevokedOnLogoutAll: true,
    newPasswordLogin: true,
  });
  assert.deepEqual(pageErrors, [], 'D2 all browser pages are free of runtime errors');
  writeFileSync(
    'outputs/browser-acceptance-results.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        observations,
        consoleMessages,
        pageErrors,
        blockedExternalRequests,
        status: 'passed',
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    JSON.stringify({
      status: 'passed',
      browser: browser.version(),
      observations: observations.length,
      blockedExternalRequests,
      consoleMessages,
      pageErrors,
    }) + '\n',
  );
} catch (error) {
  await screenshot(page, 'failure').catch(() => undefined);
  writeFileSync(
    'outputs/browser-acceptance-failure.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        stage,
        observations,
        consoleMessages,
        pageErrors,
        blockedExternalRequests,
        status: 'failed',
        error: String(error),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    'outputs/browser-acceptance-failure.txt',
    `Stage: ${stage}\n${String(error)}\n${(await page.locator('body').innerText()).slice(0, 10000)}`,
  );
  process.stderr.write(`Stage: ${stage}\n${String(error)}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
