/** C5 browser regression: every document menu action must be visible and clickable. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import fastifyStatic from '@fastify/static';
import { chromium } from 'playwright';
import { createApp } from '../packages/server/src/app';
import { openDatabase } from '../packages/server/src/db';

const directory = mkdtempSync(join(tmpdir(), 'hcd-toolbar-acceptance-'));
const db = openDatabase(join(directory, 'hcd.sqlite'));
const reservation = createServer();
await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((done) => reservation.close(() => done()));
const origin = `http://127.0.0.1:${port}`;
const app = createApp({
  db,
  dataDir: directory,
  seed: true,
  appUrl: origin,
  logger: { level: 'silent' },
  exports: { autoStart: false },
});
db.prepare("UPDATE users SET locale='en'").run();
await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/', wildcard: false });
app.setNotFoundHandler((request, reply) =>
  request.headers.accept?.includes('text/html')
    ? reply.type('text/html').sendFile('index.html')
    : reply.code(404).send({ error: { code: 'NOT_FOUND' } }),
);
await app.listen({ host: '127.0.0.1', port });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations: unknown[] = [];
const pageErrors: string[] = [];
let blockedExternalRequests = 0;
let passed = false;
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 1000 }, locale: 'en-US' });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blockedExternalRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/login`);
  await page.locator('input[type="email"]').fill('d@example.com');
  await page.locator('input[type="password"]').fill('hcd-demo-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.left-sidebar').waitFor({ state: 'attached' });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [360, 805, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${origin}/d/d_aaaaaaab`);
      const more = page.getByRole('button', { name: 'More document actions', exact: true });
      await more.click();
      await page.getByRole('menu').waitFor();
      const measured = await page.getByRole('menu').evaluate((menu) => {
        const bounds = menu.getBoundingClientRect();
        return {
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          items: [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => {
            const rect = item.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return {
              text: item.textContent,
              hit: hit === item || item.contains(hit),
              top: rect.top,
              bottom: rect.bottom,
            };
          }),
          viewport: { width: innerWidth, height: innerHeight },
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      observations.push({ width, theme, ...measured });
      process.stdout.write(`${JSON.stringify({ width, theme, ...measured })}\n`);
      await page.screenshot({ path: `outputs/C5-menu-${width}-${theme}.png` });
      assert(measured.bounds.x >= 0 && measured.bounds.x + measured.bounds.width <= width, 'C5 menu fits horizontally');
      assert(measured.scrollWidth <= width, 'C5 menu does not widen the viewport');
      assert(
        measured.items.every((item) => item.hit),
        'C5 every menu item must be visible and receive pointer input',
      );
      await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
      await page.waitForURL('**/d/d_aaaaaaab/history');
      assert.equal(await page.getByRole('menu').count(), 0, 'C5 selecting an action closes the menu');
    }
  }
  assert.deepEqual(pageErrors, []);
  assert.equal(blockedExternalRequests, 0);
  passed = true;
  process.stdout.write('C5 toolbar menu: PASS (6 real Chrome viewport/theme scenarios).\n');
} finally {
  writeFileSync(
    'outputs/C5-menu-results.json',
    JSON.stringify({ passed, observations, pageErrors, blockedExternalRequests }, null, 2),
  );
  await browser.close();
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
