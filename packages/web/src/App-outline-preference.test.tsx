// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { Document } from '../../core/src/model';

let root: Root | undefined;
beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, '', '/d/d_outline');
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  history.replaceState({}, '', '/');
});
const content: Document = {
  schemaVersion: 1,
  id: 'd_outline',
  title: 'Outline fixture',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [{ id: 'm_outline', title: 'Remembered section', blocks: [] }],
};
const meta = { id: content.id, title: content.title, currentVersion: 1, aiEnabled: false, role: 'owner' };
async function fixture() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input).replace('/api/v1', '');
      let body: unknown;
      if (path === '/auth/config') body = { passwordResetEnabled: false };
      else if (path === '/me')
        body = { user: { id: 'u_fixture', name: 'Test', email: 'test@example.com', locale: 'en' } };
      else if (path === '/spaces') body = { spaces: [] };
      else if (path === '/me/tokens') body = { tokens: [] };
      else if (path === '/docs') body = { docs: [meta] };
      else if (path === '/notifications/unread-count') body = { count: 0 };
      else if (path === `/docs/${content.id}`) body = { doc: meta, content };
      else if (path.startsWith(`/docs/${content.id}/submissions`)) body = { submissions: [] };
      else if (path === `/docs/${content.id}/comments?status=all`) body = { threads: [] };
      else throw new Error(`Unexpected fixture request: ${path}`);
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  async function mount() {
    root = createRoot(container);
    await act(async () => root!.render(<App />));
  }
  await mount();
  return async () => {
    await act(async () => root!.unmount());
    await mount();
  };
}
function outlineButton() {
  return document.querySelector<HTMLButtonElement>('button.outline-toggle')!;
}
async function toggleOutline() {
  await act(async () => outlineButton().click());
}
it('C8 remembers both open and collapsed outline choices after remounting the application', async () => {
  const remount = await fixture();
  expect(outlineButton().getAttribute('aria-expanded')).toBe('false');
  await toggleOutline();
  expect(document.querySelector('.outline-rail.open')).not.toBeNull();
  await remount();
  expect(outlineButton().getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('.outline-rail.open')).not.toBeNull();
  await toggleOutline();
  expect(document.querySelector('.outline-rail.open')).toBeNull();
  await remount();
  expect(outlineButton().getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.outline-rail.open')).toBeNull();
});
it('C8 keeps the outline usable with its default collapsed state when browser storage is unavailable', async () => {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('Storage unavailable');
    },
    setItem() {
      throw new Error('Storage unavailable');
    },
  });
  const remount = await fixture();
  expect(outlineButton().getAttribute('aria-expanded')).toBe('false');
  await toggleOutline();
  expect(document.querySelector('.outline-rail.open')).not.toBeNull();
  await toggleOutline();
  expect(document.querySelector('.outline-rail.open')).toBeNull();
  await remount();
  expect(outlineButton().getAttribute('aria-expanded')).toBe('false');
});
