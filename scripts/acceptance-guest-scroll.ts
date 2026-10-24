/** C7 browser regression: clicking a quoted discussion must keep its highlight in view. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { chromium } from 'playwright';
import { createApp } from '../packages/server/src/app';
import { openDatabase } from '../packages/server/src/db';
import { anchorText } from '../packages/core/src/anchors';
import { locate } from '../packages/core/src/ops';
import type { Document } from '../packages/core/src/model';

// Fixed local API payloads retain the published sample document, while removing
// authentication, publication, mail, and comment posting from the repro.
const db = openDatabase(':memory:');
const seeded = createApp({ db, seed: true, logger: { level: 'silent' }, exports: { autoStart: false } });
const content = JSON.parse(
  (db.prepare("SELECT content FROM versions WHERE doc_id='d_aaaaaaab' AND version=1").get() as { content: string })
    .content,
) as Document;
await seeded.close();
db.close();
const block = locate(content, 'n_aaaaaaab')!.value;
const text = anchorText(block, 'text')!;
const quote = '已经';
const start = text.indexOf(quote);
assert(start >= 0);
const thread = {
  root: {
    id: 'cm_scroll',
    body: 'C7 linked quote',
    authorName: 'Local reader',
    createdAt: '2026-10-24T00:00:00Z',
    anchor: { moduleId: 'm_aaaaaaaa', blockId: 'n_aaaaaaab', field: 'text', quote, version: 1 },
  },
  replies: [],
  anchorState: 'ok',
  range: { start, end: start + quote.length },
};
const app = Fastify({ logger: false });
app.get('/api/v1/s/scroll_fixture/doc', async () => ({
  doc: {
    id: content.id,
    version: 1,
    title: content.title,
    role: 'commenter',
    showComments: true,
    aiEnabled: false,
    expiresAt: null,
  },
  content,
  guest: { id: 'g_fixture', name: 'Local fixture' },
}));
app.get('/api/v1/s/scroll_fixture/comments', async () => ({ threads: [thread] }));
await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/', wildcard: false });
app.setNotFoundHandler((_request, reply) => reply.type('text/html').sendFile('index.html'));
const origin = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations: unknown[] = [];
let passed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/s/scroll_fixture`);
  const button = page.getByRole('button', { name: 'Go to quoted content', exact: true });
  await button.waitFor();
  const scenarios = [
    { width: 1440, height: 1000, theme: 'light' },
    { width: 360, height: 1000, theme: 'light' },
    { width: 1440, height: 1000, theme: 'light' },
    { width: 360, height: 1000, theme: 'dark' },
    { width: 1440, height: 1000, theme: 'dark' },
  ] as const;
  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ colorScheme: scenario.theme });
    await button.click();
    // A transient in-view rectangle during native smooth scrolling is not a
    // settled result. Do not resize the viewport while that scroll is running.
    await page.waitForTimeout(1500);
    await page.locator('.hcd-anchor-highlight').waitFor();
    try {
      await page.waitForFunction(
        () => {
          const quote = document.querySelector('.hcd-anchor-highlight')?.getBoundingClientRect();
          const header = document.querySelector('.shared-header')?.getBoundingClientRect();
          return quote && quote.top >= (header?.bottom ?? 0) && quote.bottom <= innerHeight;
        },
        undefined,
        { timeout: 4000 },
      );
    } catch {
      // Capture geometry after the normal smooth-scroll duration, then report
      // the precise visibility failure instead of a generic Playwright timeout.
    }
    const measured = await page.evaluate(() => {
      const quote = document.querySelector('.hcd-anchor-highlight')!;
      const target = document.querySelector('[data-hcd-location-active]')!;
      const quoteRect = quote.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return {
        quote: { top: quoteRect.top, bottom: quoteRect.bottom, height: quoteRect.height },
        target: { top: targetRect.top, bottom: targetRect.bottom, height: targetRect.height },
        headerBottom: document.querySelector('.shared-header')!.getBoundingClientRect().bottom,
        viewport: { width: innerWidth, height: innerHeight },
        scrollY,
        focus: document.activeElement?.className,
        scrolling: { element: document.scrollingElement?.tagName, top: document.scrollingElement?.scrollTop },
      };
    });
    observations.push({ scenario, measured });
    process.stdout.write(`${JSON.stringify({ scenario, measured })}\n`);
    assert(measured.quote.top >= measured.headerBottom, 'C7 quote is above the visible reading viewport');
    assert(measured.quote.bottom <= scenario.height, 'C7 quote is below the visible reading viewport');
  }
  assert.deepEqual(pageErrors, []);
  process.stdout.write('C7 guest quote visibility: PASS (5 real Chrome viewport/theme scenarios).\n');
  passed = true;
} finally {
  writeFileSync('outputs/D2-guest-scroll-results.json', JSON.stringify({ passed, observations }, null, 2));
  await browser.close();
  await app.close();
}
