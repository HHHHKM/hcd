import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { documentId, showcaseId, type SurfaceFixture } from './ui-surfaces-fixture';

export type SurfaceCase = {
  name: string;
  group: number;
  target: string;
  note?: string;
  prepare: (page: Page, width: number) => Promise<void>;
};

export async function surfaceLogin(page: Page, origin: string) {
  await page.goto(`${origin}/login`);
  await page.locator('input[type="email"]').fill('d@example.com');
  await page.locator('input[type="password"]').fill('hcd-demo-2026');
  await page.locator('.auth-submit').click();
  await page.locator('.left-sidebar').waitFor({ state: 'attached' });
}

export async function createSurfaceCases(fixture: SurfaceFixture, context: BrowserContext): Promise<SurfaceCase[]> {
  const { origin, db } = fixture;
  const doc = `/d/${documentId}`;
  async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await context.request.fetch(`${origin}${path}`, {
      method, data: body, headers: { origin, 'x-hcd-request': '1' },
    });
    assert(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.status() === 204 ? null : response.json();
  }
  const share = await api(`/api/v1/docs/${documentId}/share-links`, { role: 'viewer', showComments: true });
  const expired = await api(`/api/v1/docs/${documentId}/share-links`, { role: 'viewer', showComments: true });
  db.prepare('UPDATE share_links SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.link.id);
  await api('/api/v1/me/tokens', { name: '本地验收 CLI', scopes: ['read', 'comment', 'submit'] });
  const cli = await api('/api/v1/cli-auth/start', { clientName: 'mdoc', hostname: 'local-mac-fixture' });
  // Each isolated database uses one fixed display code so screenshot text is repeatable.
  const stableCode = 'ABCD-EFGH';
  db.prepare('UPDATE cli_auth_requests SET code=? WHERE code=?').run(stableCode, cli.code);
  cli.verifyUrl = `${origin}/cli-auth?code=${stableCode}`;
  const callback = 'http://127.0.0.1:65530/callback';
  const client = await api('/oauth/register', { client_name: '本地验收客户端（未验证名称）', redirect_uris: [callback] });
  // Register through the real API, then stabilize this disposable fixture's ID.
  // Random proportional glyph widths can wrap a masked ID onto one or two lines.
  const clientCount = (db.prepare('SELECT COUNT(*) n FROM oauth_clients').get() as { n: number }).n;
  const stableClientId = `oc_${'A'.repeat(40)}${String(clientCount).padStart(3, '0')}`;
  db.prepare('UPDATE oauth_clients SET id=? WHERE id=?').run(stableClientId, client.client_id);
  client.client_id = stableClientId;
  const authorize = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback,
    response_type: 'code', code_challenge: createHash('sha256').update('v'.repeat(64)).digest('base64url'),
    code_challenge_method: 'S256', resource: `${origin}/mcp`, scope: 'read comment submit ai_tasks preview' });
  const flow = await context.request.get(`${origin}/oauth/authorize?${authorize}`, { maxRedirects: 0 });
  assert.equal(flow.status(), 302);
  const oauthPath = flow.headers().location!;
  const go = async (page: Page, path: string, target: string) => {
    await page.goto(new URL(path, origin).href);
    await page.locator(target).first().waitFor();
  };
  const reading = async (page: Page) => {
    await go(page, doc, '.document-page [data-hcd-node-id]');
    if (await page.locator('.right-rail.open').count() === 0)
      await page.locator('.mobile-comments').click({ force: true });
  };
  const select = async (page: Page) => {
    await go(page, doc, '.document-page [data-hcd-field="text"]');
    if ((page.viewportSize()?.width ?? 1440) < 981 && await page.locator('.right-rail.open').isVisible())
      await page.locator('.right-rail.open .right-tab-more').click();
    const field = page.locator('.document-page [data-hcd-node-id="n_aaaaaaab"][data-hcd-field="text"]').first();
    await field.scrollIntoViewIfNeeded();
    const point = await field.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const index = node.textContent?.indexOf('已经') ?? -1;
        if (index < 0) continue;
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 2);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      throw new Error('Native selection fixture text absent');
    });
    await page.mouse.dblclick(point.x, point.y);
    await page.locator('.selection-comment-tools').waitFor();
  };
  const edit = async (page: Page, width: number, id = documentId) => {
    // Existing product permits editing on desktop. Resize the already-open editor for CSS inspection.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go(page, `/d/${id}`, '.document-page');
    await page.getByRole('button', { name: /编辑文档|Edit document/, exact: true }).click();
    await page.locator('.editable-block').first().waitFor();
    if (width !== 1440) await page.setViewportSize({ width, height: 1000 });
  };
  const review = (page: Page) => go(page, `${doc}/review`, '.submission-select');
  const settings = (page: Page) => go(page, `${doc}/settings`, '.settings-modal .token-list');
  const cases: SurfaceCase[] = [
    { name: 'selection', group: 1, target: '.selection-comment-tools', prepare: select },
    { name: 'rich-editor', group: 2, target: '.be-rich-toolbar',
      note: '390px screenshot resizes a desktop-opened editor; fresh mobile navigation remains read-only.',
      prepare: async (page, width) => {
        await edit(page, 1440);
        await page.locator('.be-inline-preview').filter({ hasText: '本季度重点提升' }).first().click();
        await page.locator('.be-rich-toolbar').waitFor();
        await page.locator('.be-rich-toolbar button').first().click();
        await page.setViewportSize({ width, height: 1000 });
      } },
    { name: 'notifications', group: 3, target: '.notification-list', prepare: async (page) => {
      await go(page, doc, '.notification-bell'); await page.locator('.notification-bell').click();
      await page.locator('.notification-list').waitFor();
    } },
    { name: 'notification-preferences', group: 3, target: '.notification-preferences', prepare: (page) =>
      go(page, '/settings/notifications', '.notification-preference-row') },
    { name: 'share-modal', group: 4, target: '.share-links-modal', prepare: (page) =>
      go(page, `${doc}/settings?panel=share`, '.share-link-list') },
    { name: 'share-revoke', group: 4, target: '.share-revoke-confirm', prepare: async (page) => {
      await go(page, `${doc}/settings?panel=share`, '.share-link-list');
      await page.locator('.share-link-list').getByRole('button', { name: /^(撤销|Revoke)$/ }).first().click();
    } },
    { name: 'share-expired', group: 4, target: '.shared-state', prepare: (page) =>
      go(page, expired.link.url, '.shared-state') },
    { name: 'share-page', group: 4, target: '.shared-page', prepare: (page) => go(page, share.link.url, '.shared-page') },
    { name: 'mentions', group: 5, target: '.mention-options', prepare: async (page) => {
      await reading(page); await page.locator('.comment-composer').scrollIntoViewIfNeeded();
      await page.locator('.comment-composer .mention-picker > button').click();
      await page.locator('.mention-options button').nth(1).waitFor();
    } },
    { name: 'selection-summary', group: 5, target: '.comment-selection-summary', prepare: async (page) => {
      await select(page); await page.locator('.selection-comment-tools button').click();
      await page.locator('.comment-selection-summary').waitFor();
    } },
    { name: 'admin-accounts', group: 6, target: '.administration-modal', prepare: (page) =>
      go(page, '/admin/accounts', '.admin-list li') },
    { name: 'admin-confirm', group: 6, target: '.admin-confirm', prepare: async (page) => {
      await go(page, '/admin/accounts', '.admin-list li');
      await page.locator('.admin-list li').filter({ hasText: 'a@example.com' })
        .getByRole('button', { name: /^(停用|禁用|Disable)$/ }).click();
    } },
    { name: 'integrations', group: 6, target: '.space-integrations', prepare: (page) =>
      go(page, '/spaces/sp_demo000000/settings', '.space-integrations') },
    { name: 'cli-consent', group: 7, target: '.cli-auth-options', prepare: (page) =>
      go(page, cli.verifyUrl, '.cli-auth-code') },
    { name: 'oauth-consent', group: 7, target: '.oauth-consent', prepare: (page) =>
      go(page, oauthPath, '.oauth-doc') },
    { name: 'forgot-password', group: 7, target: '.auth-card', prepare: (page) =>
      go(page, '/auth/forgot', '.auth-card input[type="email"]') },
    { name: 'invite', group: 7, target: '.auth-card', prepare: (page) =>
      go(page, fixture.invite.url, '.auth-card input[type="password"]') },
    { name: 'reset', group: 7, target: '.auth-card', prepare: (page) =>
      go(page, fixture.reset.url, '.auth-card input[type="password"]') },
    { name: 'import-upload', group: 8, target: '.import-modal', prepare: (page) =>
      go(page, '/import', '.file-picker') },
    { name: 'import-preview', group: 8, target: '.import-report', prepare: async (page) => {
      await go(page, '/import', '.file-picker');
      await page.locator('.file-picker').setInputFiles({ name: '本地验收.html', mimeType: 'text/html',
        buffer: Buffer.from('<h1>验收导入</h1><h2>项目计划</h2><p><strong>保留结构</strong>，验证真实导入预览。</p><ul><li>检查内容</li><li>检查布局</li></ul><script>removed</script>') });
      await page.locator('.import-modal select').selectOption('sp_demo000000');
      await page.locator('.import-modal .button-primary').click();
      await page.locator('.import-report').waitFor();
      await page.locator('.import-content-preview summary').first().click();
    } },
    { name: 'ai-tasks', group: 8, target: '.ai-task-list', prepare: (page) =>
      go(page, `${doc}/ai-tasks`, '.ai-task-card') },
    { name: 'ai-confirm', group: 8, target: '.ai-task-confirm', prepare: async (page) => {
      await go(page, `${doc}/ai-tasks`, '.ai-task-card');
      await page.locator('.ai-task-card').filter({ hasText: /待批准|等待批准|Requested/ })
        .getByRole('button', { name: /^(批准|Approve)$/ }).click();
    } },
    { name: 'review', group: 9, target: '.submission-list', prepare: review },
    { name: 'review-preview', group: 9, target: '.preview-content', prepare: async (page) => {
      await review(page); await page.locator('.submission-select input').first().check();
      await page.locator('.review-modal .modal-footer .button-primary').click();
      await page.locator('.preview-content .review-presentation').waitFor();
    } },
    { name: 'submission-changes', group: 9, target: '.change-list', prepare: async (page) => {
      await review(page); await page.locator('.submission-row .text-link').first().click();
      await page.locator('.change-list').waitFor();
    } },
    { name: 'submission-document', group: 9, target: '.submission-document', prepare: async (page) => {
      await review(page); await page.locator('.submission-row .text-link').first().click();
      await page.locator('.change-tabs button').nth(1).click();
      await page.locator('.submission-document').waitFor();
    } },
    { name: 'version-comparison', group: 9, target: '.version-comparison-result', prepare: (page) =>
      go(page, `${doc}/compare?from=1&to=2`, '.version-comparison-result .change-list') },
    { name: 'reading-chart', group: 10, target: '.read-chart', prepare: (page) =>
      go(page, `/d/${showcaseId}`, '.read-chart') },
    { name: 'reading-timeline', group: 10, target: '.read-timeline', prepare: (page) =>
      go(page, `/d/${showcaseId}`, '.read-timeline') },
    { name: 'reading-columns', group: 10, target: '.read-columns', prepare: (page) =>
      go(page, `/d/${showcaseId}`, '.read-columns') },
    { name: 'reading-cards', group: 10, target: '.read-cards', prepare: (page) =>
      go(page, `/d/${showcaseId}`, '.read-cards') },
    { name: 'editing-blocks', group: 10, target: '.document-editor-fields',
      note: '390px screenshot resizes a desktop-opened editor; fresh mobile navigation remains read-only.',
      prepare: (page, width) => edit(page, width, showcaseId) },
    { name: 'editing-nested', group: 10, target: '.document-editor-fields',
      note: '390px screenshot resizes a desktop-opened editor; fresh mobile navigation remains read-only.',
      prepare: (page, width) => edit(page, width, showcaseId) },
    { name: 'settings-tokens', group: 11, target: '.token-list', prepare: settings },
    { name: 'settings-document', group: 11, target: '.settings-switch-row', prepare: settings },
    { name: 'global-error', group: 11, target: '.global-error', prepare: (page) =>
      go(page, '/d/d_zzzzzzzz', '.global-error') },
    { name: 'toast', group: 11, target: '.toast', prepare: async (page) => {
      await settings(page);
      await page.locator('.token-scopes').locator('..').locator('input[maxlength="100"]').fill('本地 toast 验收');
      await page.locator('.token-scopes').locator('..').locator('.button-primary').click();
      await page.locator('.toast').waitFor();
    } },
    { name: 'notification-empty', group: 3, target: '.notification-empty', prepare: async (page) => {
      // The topbar precedes document loading; wait for the real rail to mount before closing it.
      await go(page, doc, '.document-page [data-hcd-node-id]');
      await page.locator('.right-rail').waitFor({ state: 'attached' });
      if ((page.viewportSize()?.width ?? 1440) < 721) {
        if (await page.locator('.right-rail.open').count())
          await page.locator('.right-rail.open .right-tab-more').click();
        await page.locator('.right-rail.open').waitFor({ state: 'detached' });
      }
      await page.locator('.notification-bell').click();
      await page.locator('.notification-list').waitFor();
      const unreadOnly = page.locator('.notification-controls input');
      await unreadOnly.scrollIntoViewIfNeeded();
      await unreadOnly.check();
      await page.locator('.notification-controls .button-soft').first().click();
      await page.locator('.notification-empty').waitFor();
    } },
  ];
  return cases;
}
