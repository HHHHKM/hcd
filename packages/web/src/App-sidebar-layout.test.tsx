// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { chromium } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  history.replaceState({}, '', '/');
});
function stylesheet(path: string): string {
  return readFileSync(path, 'utf8').replace(/@import\s+[\"']([^\"']+)[\"'];/g, (_, name: string) =>
    stylesheet(join(dirname(path), name)),
  );
}
async function appMarkup() {
  history.replaceState({}, '', '/');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input).replace('/api/v1', '');
      let body: unknown;
      if (path === '/auth/config') body = { passwordResetEnabled: false };
      else if (path === '/me')
        body = { user: { id: 'u_sidebar', name: 'Local', email: 'local@example.test', locale: 'en' } };
      else if (path === '/spaces') body = { spaces: [] };
      else if (path === '/me/tokens') body = { tokens: [] };
      else if (path === '/docs') body = { docs: [] };
      else if (path === '/notifications/unread-count') body = { count: 0 };
      else throw new Error(`Unexpected fixture request: ${path}`);
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  return container.innerHTML;
}
it('C8 shows compact sidebar navigation as fully visible named icons at 805px without clipped label text', async () => {
  const markup = await appMarkup();
  const browser = await chromium.launch({
    headless: true,
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
  });
  try {
    const page = await browser.newPage();
    const css = stylesheet('packages/web/src/styles.css');
    for (const dark of [false, true]) {
      await page.setContent(`<style>${css}</style>${markup}`);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value ? 'dark' : 'light';
        document.querySelector('.app')!.classList.toggle('dark', value);
      }, dark);
      for (const width of [805, 980, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const name of ['All documents', 'Recently viewed']) {
          const button = page.getByRole('button', { name, exact: true });
          expect(await button.count(), `${width}px ${name} accessible button`).toBe(1);
          expect(await button.isVisible(), `${width}px ${name} button`).toBe(true);
          const visibleText = (await button.innerText()).trim();
          if (width <= 980) expect(visibleText, `${width}px compact ${name} visible text`).toBe('');
          else expect(visibleText, `${width}px expanded ${name} visible text`).toContain(name);
          const geometry = await button.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            const icon = node.querySelector('svg')!.getBoundingClientRect();
            const sidebar = node.closest('.left-sidebar')!.getBoundingClientRect();
            return {
              iconWidth: icon.width,
              iconInside: icon.left >= bounds.left && icon.right <= bounds.right,
              buttonInside: bounds.left >= sidebar.left && bounds.right <= sidebar.right,
            };
          });
          expect(geometry.iconWidth, `${width}px ${name} icon width`).toBeGreaterThan(0);
          expect(geometry.iconInside, `${width}px ${name} icon fits`).toBe(true);
          expect(geometry.buttonInside, `${width}px ${name} button fits sidebar`).toBe(true);
        }
      }
    }
  } finally {
    await browser.close();
  }
}, 20_000);
