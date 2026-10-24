// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
let root: Root | undefined;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});
async function fixture() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Set<() => void>();
  const darkQuery = {
    matches: true,
    addEventListener: (_: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
  };
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('prefers-color-scheme')
      ? darkQuery
      : { matches: false, addEventListener() {}, removeEventListener() {} },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace('/api/v1', '');
      const value =
        path === '/me'
          ? { user: { id: 'u_fixture', name: 'Local', email: 'local@example.test', locale: 'en' } }
          : path === '/docs'
            ? { docs: [] }
            : path === '/spaces'
              ? { spaces: [] }
              : path === '/auth/config'
                ? { passwordResetEnabled: false }
                : { count: 0 };
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  return {
    container,
    updateSystem: async (dark: boolean) => {
      await act(async () => {
        darkQuery.matches = dark;
        listeners.forEach((callback) => callback());
      });
    },
  };
}
describe('workspace theme preference', () => {
  it('C4 follows system changes while the user has no explicit theme preference', async () => {
    const f = await fixture();
    expect(document.querySelector('.app.dark')).not.toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await f.updateSystem(false);
    expect(document.querySelector('.app.dark')).toBeNull();
  });
  it('C4 remembers an explicit theme choice after a reload and keeps it when the system changes', async () => {
    const f = await fixture();
    await act(async () =>
      document
        .querySelector('[aria-label="Toggle appearance"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(localStorage.getItem('hcd.theme')).toBe('light');
    await act(async () => root!.unmount());
    root = createRoot(f.container);
    await act(async () => root!.render(<App />));
    expect(document.documentElement.dataset.theme).toBe('light');
    await f.updateSystem(true);
    expect(document.querySelector('.app.dark')).toBeNull();
  });
});
