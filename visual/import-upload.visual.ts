import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createSurfaceFixture } from '../scripts/ui-surfaces-fixture';
import { surfaceLogin } from '../scripts/ui-surfaces-cases';

// E4 §8: the real import upload area keeps its dashed, large-radius fill surface.
// This regression runs with pnpm test:visual and uses the actual compiled application.
for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`E4 import upload surface ${width} ${theme}`, async ({ browser }, testInfo) => {
    test.setTimeout(30_000);
    const fixture = await createSurfaceFixture();
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'zh-CN',
      timezoneId: 'Asia/Taipei', colorScheme: theme, reducedMotion: 'reduce' });
    const external: string[] = [];
    const errors: string[] = [];
    const quotas: string[] = [];
    try {
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => { if (response.status() === 429) quotas.push(response.url()); });
      await surfaceLogin(page, fixture.origin);
      await page.goto(`${fixture.origin}/import`);
      const picker = page.locator('.import-modal .file-picker');
      await expect(picker).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const measured = await picker.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const probe = document.createElement('span');
        probe.hidden = true;
        probe.style.backgroundColor = style.getPropertyValue('--fill').trim();
        document.body.append(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { width: rect.width, height: rect.height, x: rect.x, y: rect.y,
          borderStyle: style.borderStyle, borderWidth: style.borderWidth, borderColor: style.borderColor,
          borderRadius: style.borderRadius, backgroundColor: style.backgroundColor,
          padding: style.padding, minHeight: style.minHeight, fontSize: style.fontSize,
          expectedRadius: style.getPropertyValue('--radius-l').trim(),
          expectedFill: style.getPropertyValue('--fill').trim(),
          expectedBackground,
          viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
      });
      const evidence = { date: new Date().toISOString(), width, theme, measured, external, errors, quotas,
        requirement: 'CODEX_UI_GUIDE.md E4 §8: dashed upload area with large radius and shallow fill.',
        fixture: 'Real createApp, disposable SQLite, actual dist and installed Chrome.' };
      const path = `outputs/E4-followup-import-${width}-${theme}`;
      writeFileSync(`${path}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
      await page.screenshot({ path: `${path}.png`, animations: 'disabled', caret: 'hide' });
      await testInfo.attach('import-upload-computed-style', {
        body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
      });
      expect.soft(measured.borderStyle, 'E4 dashed upload border').toBe('dashed');
      expect.soft(measured.borderRadius, 'E4 large upload radius').toBe(measured.expectedRadius);
      expect.soft(measured.backgroundColor, 'E4 upload fill surface').toBe(measured.expectedBackground);
      expect(measured.height, 'Upload area remains a usable pointer target').toBeGreaterThanOrEqual(44);
      expect(measured.scrollWidth, 'Import modal fits the viewport').toBeLessThanOrEqual(width);
      expect(external, 'external requests').toEqual([]);
      expect(errors, 'runtime errors').toEqual([]);
      expect(quotas, 'rate-limit failures').toEqual([]);
    } finally {
      await context.close(); await fixture.close();
    }
  });
}
