import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';

function stylesheet(path: string): string {
  return readFileSync(path, 'utf8').replace(/@import\s+["']([^"']+)["'];/g, (_, name: string) =>
    stylesheet(join(dirname(path), name)),
  );
}

it('E4 keeps notification header and pointer controls inside the viewport under the blurred topbar', async () => {
  const browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const css = stylesheet('packages/web/src/styles.css') + stylesheet('packages/web/src/notifications.css');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(`<style>${css}</style><div class="app"><header class="topbar">
        <div class="overlay"><section class="review-modal notifications-modal">
          <div class="modal-top"><h2>Notifications</h2><button>Close</button></div>
          <div class="notification-controls"><label><input type="checkbox">Unread only</label></div>
          <ul class="notification-list">${'<li><button class="notification-item">An update</button></li>'.repeat(30)}</ul>
        </section></div></header><aside class="right-rail open" style="position:fixed;z-index:25;top:52px;right:0;bottom:0;width:355px;max-width:100vw;transform:none;visibility:visible;display:flex;height:auto">Open discussion panel</aside></div>`);
      const header = await page.locator('.notifications-modal .modal-top').boundingBox();
      expect(header!.y, `${width}px notification header`).toBeGreaterThanOrEqual(0);
      await page.locator('.notification-controls input').check({ timeout: 2000 });
      expect(await page.locator('.notification-controls input').isChecked()).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await browser.close();
  }
}, 20_000);

it('E4 keeps the member menu inside a right-aligned discussion composer', async () => {
  const browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const css = stylesheet('packages/web/src/styles.css') + stylesheet('packages/web/src/discussion.css');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(`<style>${css}</style><main class="app"><aside style="position:fixed;right:16px;top:200px;width:min(280px,calc(100vw - 48px))"><div class="comment-composer"><textarea></textarea><div class="composer-actions"><div class="mention-picker"><button>Mention</button><div class="mention-options"><button>Member</button></div></div></div></div></aside></main>`);
      const menu = await page.locator('.mention-options').boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await browser.close();
  }
}, 20_000);
