import { test, expect, type Page } from '@playwright/test';
import { createSurfaceFixture } from '../scripts/ui-surfaces-fixture';
import { createSurfaceCases, surfaceLogin, type SurfaceCase } from '../scripts/ui-surfaces-cases';

test.describe.configure({ mode: 'parallel' });

async function captureSurface(page: Page, surface: SurfaceCase, width: number, theme: string) {
  const target = page.locator(surface.target).first();
  await expect(target).toBeVisible();
  if (surface.name !== 'selection') await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`surface-${surface.name}-${width}-${theme}.png`, {
    fullPage: false,
    mask: [page.locator('time, .comment-head small, .submission-author small, ' +
      '.oauth-destination dd, .new-token code, .admin-link input')],
  });
}

// Each combination owns a real isolated app/database. Every surface retains its original interaction.
for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`E4 component surfaces ${width} ${theme}`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const fixture = await createSurfaceFixture();
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'zh-CN',
      timezoneId: 'Asia/Taipei', colorScheme: theme, reducedMotion: 'reduce' });
    const external: string[] = [];
    const errors: string[] = [];
    const quotas: string[] = [];
    const restrictions: unknown[] = [];
    let requests = 0;
    try {
      await context.addInitScript(() => { localStorage.setItem('hcd.discussion.open', 'true'); });
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => { if (response.status() === 429) quotas.push(response.url()); });
      context.on('request', (request) => { if (request.url().includes('/api/v1/')) requests++; });
      await surfaceLogin(page, fixture.origin);
      const surfaces = await createSurfaceCases(fixture, context);
      for (const surface of surfaces) await test.step(`${surface.name} (${surface.group})`, async () => {
        if (requests > 210) {
          await page.waitForTimeout(30000); await page.waitForTimeout(30000); await page.waitForTimeout(1000);
          requests = 0;
        }
        await page.setViewportSize({ width, height: 1000 });
        if (width < 721 && surface.note?.includes('mobile')) {
          await surface.prepare(page, width);
          await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
          await expect(page.locator('.mobile-reading-note')).toBeVisible();
          await expect(page.locator('.document-editor-fields')).toHaveCount(0);
          restrictions.push({ name: surface.name, width, theme, reason: surface.note });
          return;
        }
        if (width < 721 && surface.note?.includes('Native selection')) {
          restrictions.push({ name: surface.name, width, theme, reason: surface.note });
          return;
        }
        await surface.prepare(page, width);
        const target = page.locator(surface.target).first();
        if (width < 721 && surface.note?.includes('mobile') && !await target.isVisible().catch(() => false)) {
          restrictions.push({ name: surface.name, width, theme, reason: surface.note });
          return;
        }
        await captureSurface(page, surface, width, theme);
      });
      expect(external, 'external browser requests').toEqual([]);
      expect(errors, 'browser runtime errors').toEqual([]);
      expect(quotas, 'rate-limit failures').toEqual([]);
    } finally {
      await testInfo.attach('surface-browser-audit', { body: JSON.stringify({
        external, errors, quotas, restrictions,
        notificationEmpty: 'Checkbox and mark-read button are exercised with normal pointer interactions.',
      }, null, 2), contentType: 'application/json' });
      await context.close(); await fixture.close();
    }
  });
}
