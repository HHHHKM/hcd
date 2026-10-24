import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';

function stylesheet(path: string): string {
  return readFileSync(path, 'utf8').replace(/@import\s+["']([^"']+)["'];/g, (_, name: string) =>
    stylesheet(join(dirname(path), name)),
  );
}
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    headless: true,
  });
});
afterAll(async () => {
  await browser?.close();
});
async function fixture(markup: string, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const css = [
    'styles.css',
    'block-editor.css',
    'discussion.css',
    'notifications.css',
    'cli-auth.css',
    'administration.css',
  ]
    .map((name) => stylesheet(`packages/web/src/${name}`))
    .join('\n');
  await page.setContent(`<style>${css}</style><main class="app dark">${markup}</main>`);
  return page;
}
async function style(page: Page, selector: string, property: string) {
  return page.locator(selector).evaluate((element, key) => getComputedStyle(element).getPropertyValue(key), property);
}

it('E4 rich editor focus has a visible outer ring and pressed controls retain accent in dark mode', async () => {
  const page = await fixture(
    '<div class="rich-editor"><div class="rich-toolbar"><button aria-pressed="true">B</button></div><div class="rich-text-input" contenteditable="true">Text</div></div>',
  );
  try {
    await page.locator('.rich-text-input').focus();
    expect(await style(page, '.rich-editor', 'box-shadow')).not.toBe('none');
    const expected = await page.locator('.app').evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      element.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(await style(page, '.rich-toolbar button', 'color')).toBe(expected);
  } finally {
    await page.close();
  }
});

it('E4 nested editor cards and tables use soft cards and row separators', async () => {
  const page = await fixture(
    '<div class="block-editor"><fieldset class="be-group"><div class="be-nested">Nested</div></fieldset><table class="be-data-table"><tr><th>Field</th><td>Value</td></tr></table></div>',
  );
  try {
    expect(await style(page, '.be-group', 'border-top-width')).toBe('0px');
    expect(await style(page, '.be-group', 'border-radius')).toBe('12px');
    expect(await style(page, '.be-data-table td', 'border-left-width')).toBe('0px');
    expect(await style(page, '.be-nested', 'border-left-width')).toBe('1px');
  } finally {
    await page.close();
  }
});

it('E4 notification preferences remain operable switches with an empty-state card', async () => {
  const page = await fixture(
    '<div class="notification-preferences"><label class="notification-preference-row">Updates<input type="checkbox"></label></div><p class="notification-empty">No updates</p>',
  );
  try {
    expect(await style(page, '.notification-preference-row input', 'appearance')).toBe('none');
    expect(await style(page, '.notification-preference-row input', 'width')).toBe('38px');
    await page.locator('input').check();
    expect(await page.locator('input').isChecked()).toBe(true);
    expect(await style(page, '.notification-empty', 'text-align')).toBe('center');
  } finally {
    await page.close();
  }
});

it('E4 authorization scopes are check rows and supporting state surfaces remain rounded', async () => {
  const page = await fixture(
    '<div class="oauth-consent"><ul class="oauth-scopes"><li>Read documents</li></ul></div><div class="error-pill">Error</div><div class="unresolved-note">Needs review</div>',
  );
  try {
    expect(
      await page.locator('.oauth-scopes li').evaluate((element) => getComputedStyle(element, '::before').content),
    ).toContain('✓');
    expect(await style(page, '.error-pill', 'border-radius')).toBe('980px');
    expect(await style(page, '.unresolved-note', 'padding-top')).toBe('12px');
  } finally {
    await page.close();
  }
});

it('E4 terminal code stays one exact text value and fits inside the identity card at narrow widths', async () => {
  for (const width of [360, 390, 1440]) {
    const page = await fixture(
      `<div class="auth-page"><section class="auth-card cli-auth"><section class="cli-auth-identity"><p class="cli-auth-code" dir="ltr">ABCD-EFGH</p></section></section></div>`,
      width,
    );
    try {
      const card = await page.locator('.cli-auth-identity').boundingBox();
      const code = await page.locator('.cli-auth-code').boundingBox();
      // scripts/acceptance-cli.ts compares innerText with the device code, so it must be exactly the code.
      expect((await page.locator('.cli-auth-code').innerText()).trim()).toBe('ABCD-EFGH');
      expect(code!.x + code!.width, `${width}px code card`).toBeLessThanOrEqual(card!.x + card!.width - 16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally {
      await page.close();
    }
  }
});
