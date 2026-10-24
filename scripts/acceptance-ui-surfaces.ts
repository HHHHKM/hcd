import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createSurfaceFixture } from './ui-surfaces-fixture';
import { createSurfaceCases, surfaceLogin } from './ui-surfaces-cases';

// Usage: pnpm exec tsx scripts/acceptance-ui-surfaces.ts E2
// Reusable for E4-before/E4-after; selectors/real interactions are exported for visual tests.
const prefix = process.argv[2] ?? 'E2';
assert(/^(E2|E4-before|E4-after)(?:-[a-z0-9-]+)?$/.test(prefix), 'Use a phase-prefixed evidence name');
const only = new Set((process.env.HCD_UI_SURFACES ?? '').split(',').filter(Boolean));
mkdirSync('outputs', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations: unknown[] = [];
const issues: unknown[] = [];
const runtimeErrors: string[] = [];
const consoleMessages: string[] = [];
let blockedExternalRequests = 0;
try {
  for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
    const fixture = await createSurfaceFixture();
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'zh-CN',
      colorScheme: theme, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(() => {
        localStorage.setItem('hcd.discussion.open', 'true');
      });
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
        blockedExternalRequests++;
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', (error) => runtimeErrors.push(`${width}/${theme}: ${error.message}`));
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) consoleMessages.push(`${width}/${theme}: ${message.text()}`);
      });
      let apiRequests = 0;
      context.on('request', (request) => { if (request.url().includes('/api/v1/')) apiRequests++; });
      await surfaceLogin(page, fixture.origin);
      const cases = await createSurfaceCases(fixture, context);
      for (const surface of cases) {
        if (only.size && !only.has(surface.name)) continue;
        const name = `${prefix}-${surface.name}-${width}-${theme}`;
        process.stdout.write(`Inspecting ${name}\n`);
        if (apiRequests > 210) {
          process.stdout.write('Observing normal per-user quota window before next surface.\n');
          await page.waitForTimeout(30000); await page.waitForTimeout(30000); await page.waitForTimeout(1000);
          apiRequests = 0;
        }
        await page.setViewportSize({ width, height: 1000 });
        try {
          if (width < 721 && surface.note?.includes('Native selection')) {
            await page.goto(`${fixture.origin}/d/d_aaaaaaab`);
            await page.locator('.document-page').waitFor();
            await page.screenshot({ path: `outputs/${name}.png`, animations: 'disabled', caret: 'hide' });
            observations.push({ name: surface.name, group: surface.group, width, theme, note: surface.note,
              screenshot: `${name}.png`, status: 'not-applicable-mobile-selection' });
            continue;
          }
          await surface.prepare(page, width);
          const target = page.locator(surface.target).first();
          const available = await target.count() > 0 && await target.isVisible().catch(() => false);
          if (!available && ((surface.note?.includes('mobile') && width < 721) ||
            (surface.note?.includes('Native selection') && width < 721))) {
            const measured = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
              targetUnavailable: true, mobileEditingRestriction: true }));
            await page.screenshot({ path: `outputs/${name}.png`, animations: 'disabled', caret: 'hide' });
            observations.push({ name: surface.name, group: surface.group, width, theme, note: surface.note,
              screenshot: `${name}.png`, status: 'not-applicable-mobile-editor', ...measured });
            continue;
          }
          await target.waitFor();
          if (surface.name !== 'selection') await target.scrollIntoViewIfNeeded();
          await page.evaluate(() => document.fonts.ready);
          // Wait a frame for a real rendered state, never replace frontend components or responses.
          await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
          const measured = await page.evaluate((selector) => {
            const target = document.querySelector(selector)!;
            const bounds = target.getBoundingClientRect();
            const style = getComputedStyle(target);
            const buttons = [...document.querySelectorAll<HTMLElement>('.document-toolbar button')]
              .filter((button) => button.getBoundingClientRect().width > 0)
              .map((button) => ({ text: button.textContent?.trim(), width: button.clientWidth,
                scrollWidth: button.scrollWidth, clipped: button.scrollWidth > button.clientWidth + 1 }));
            return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
              target: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
                color: style.color, background: style.backgroundColor, borderRadius: style.borderRadius,
                boxShadow: style.boxShadow, zIndex: style.zIndex }, buttons,
              legacyRichEditorNodes: document.querySelectorAll('.rich-editor,.rich-text-input').length,
              nativeTiptapNodes: document.querySelectorAll('.tiptap').length };
          }, surface.target);
          await page.screenshot({ path: `outputs/${name}.png`, animations: 'disabled', caret: 'hide' });
          const overflow = measured.scrollWidth > width;
          const clipped = measured.buttons.some((button) => button.clipped);
          const result = { name: surface.name, group: surface.group, width, theme, note: surface.note,
            screenshot: `${name}.png`, status: overflow || clipped ? 'visual-issue' : 'captured', ...measured };
          observations.push(result);
          if (overflow || clipped) issues.push(result);
        } catch (error) {
          const failure = { name: surface.name, group: surface.group, width, theme, status: 'failed', error: String(error) };
          issues.push(failure); observations.push(failure);
          await page.screenshot({ path: `outputs/${name}-failure.png` }).catch(() => undefined);
          writeFileSync(`outputs/${name}-failure.txt`, `${String(error)}\n${await page.locator('body').innerText()}`);
          process.stderr.write(`${name}: ${String(error)}\n`);
        }
      }
    } finally { await context.close(); await fixture.close(); }
  }
} catch (error) {
  issues.push({ stage: 'fixture-or-login', status: 'failed', error: String(error) });
  process.stderr.write(`${String(error)}\n`);
} finally {
  writeFileSync(`outputs/${prefix}-ui-surfaces-results.json`, JSON.stringify({
    browser: browser.version(), date: new Date().toISOString(), status: !observations.length || issues.length || runtimeErrors.length ||
      blockedExternalRequests ? 'issues' : 'passed', observations, issues, runtimeErrors,
    consoleMessages, blockedExternalRequests,
    fixture: 'Real createApp + disposable SQLite + actual dist + installed Chrome; only database fixtures and local email sink.',
    mobileEditor: 'Actual desktop editing state resized to 390px. Fresh mobile editing is intentionally unavailable.',
  }, null, 2));
  await browser.close();
}
process.stdout.write(`${prefix}: ${observations.length} surface screenshots; ${issues.length} issues; ` +
  `${runtimeErrors.length} runtime errors; ${blockedExternalRequests} external requests.\n`);
if (!observations.length || issues.length || runtimeErrors.length || blockedExternalRequests) process.exitCode = 1;
