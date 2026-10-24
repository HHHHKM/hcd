import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';

function stylesheet(path: string): string {
  return readFileSync(path, 'utf8').replace(/@import\s+[\"']([^\"']+)[\"'];/g, (_, name: string) =>
    stylesheet(join(dirname(path), name)),
  );
}

it('C8 preserves at least 680px of reading text with desktop discussions open', async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
  });
  try {
    const page = await browser.newPage();
    const css = stylesheet('packages/web/src/styles.css');
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(`<style>${css}</style><div class="app"><div class="app-frame">
        <aside class="left-sidebar"></aside><main class="main-area"><div class="document-grid">
          <aside class="outline-rail"></aside><article class="document-page"><section class="doc-module">
            ${
              '<div class="module-gutter"></div><div class="module-body">' +
              '<div class="module-content">Reading text</div></div>'
            }
          </section></article><aside class="right-rail open"></aside>
        </div></main></div></div>`);
      const text = await page.locator('.module-content').boundingBox();
      expect(text!.width, `${width}px reading text`).toBeGreaterThanOrEqual(680);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await browser.close();
  }
}, 20_000);

it('C7 highlights guest quote text without adding a block outline in the browser', async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
  });
  try {
    const page = await browser.newPage();
    const css = ['styles.css', 'discussion.css', 'sharing.css', 'anchor-text.css']
      .map((name) => stylesheet(`packages/web/src/${name}`))
      .join('\n');
    await page.setContent(
      `<style>${css}</style><article class="shared-page"><p data-hcd-location-active="true">Before ` +
        '<mark class="hcd-anchor-highlight">quoted text</mark> after</p></article>',
    );
    expect(
      await page.locator('[data-hcd-location-active]').evaluate((node) => getComputedStyle(node).outlineStyle),
    ).toBe('none');
    expect(await page.locator('mark').evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
  } finally {
    await browser.close();
  }
});
