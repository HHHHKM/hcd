// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  history.replaceState({}, '', '/');
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const spaces = [
  { id: 'sp_first', name: 'First space', role: 'owner' },
  { id: 'sp_second', name: 'Second space', role: 'owner' },
];
const docs = [
  {
    id: 'd_first',
    title: 'First space document',
    spaceId: 'sp_first',
    currentVersion: 1,
    aiEnabled: false,
    role: 'owner',
  },
  {
    id: 'd_second',
    title: 'Second space document',
    spaceId: 'sp_second',
    currentVersion: 1,
    aiEnabled: false,
    role: 'owner',
  },
];
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function render() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
}
async function fixture(path = '/') {
  await import('../Administration');
  history.replaceState({}, '', path);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input).replace('/api/v1', '');
      if (url === '/auth/config') return json({ passwordResetEnabled: false });
      if (url === '/me')
        return json({
          user: { id: 'u_fixture', name: 'Admin', email: 'local@example.test', locale: 'en', isAdmin: true },
        });
      if (url === '/spaces') return json({ spaces });
      if (url === '/docs') return json({ docs });
      if (url === '/admin/users') return json({ users: [] });
      if (url === '/notifications/unread-count') return json({ count: 0 });
      if (/^\/spaces\/[^/]+\/members$/.test(url)) return json({ members: [] });
      if (/^\/spaces\/[^/]+\/integrations$/.test(url)) return json({ baseUrl: 'https://fixture.invalid', items: [] });
      throw new Error(`Unexpected fixture URL ${url}`);
    }),
  );
  await render();
}
const titles = () => [...document.querySelectorAll('.doc-card-title')].map((node) => node.textContent);
it('C2 space navigation filters documents and restores the selected space after refresh and Back', async () => {
  await fixture();
  await act(async () => document.querySelectorAll<HTMLButtonElement>('.space-item')[1]!.click());
  expect(location.pathname).toBe('/spaces/sp_second');
  expect(titles()).toEqual(['Second space document']);
  await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  await render();
  expect(location.pathname).toBe('/spaces/sp_second');
  expect(titles()).toEqual(['Second space document']);
  await act(async () => document.querySelector<HTMLButtonElement>('.primary-nav .nav-item')!.click());
  expect(location.pathname).toBe('/');
  expect(titles()).toHaveLength(2);
  await act(async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(location.pathname).toBe('/spaces/sp_second');
  expect(titles()).toEqual(['Second space document']);
});
it('C2 a direct space settings route selects the requested space in the existing administration panel', async () => {
  await fixture('/spaces/sp_second/settings');
  const select = [...document.querySelectorAll<HTMLSelectElement>('.administration-modal select')].find((node) =>
    [...node.options].some((option) => option.value === 'sp_second'),
  );
  expect(select?.value).toBe('sp_second');
  expect(document.querySelector('.space-integrations')).not.toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/spaces/sp_second/members'))).toBe(true);
});
it('C2 the new document button and refresh preserve the new document route', async () => {
  await fixture();
  await act(async () => document.querySelector<HTMLButtonElement>('.home-actions .button-primary')!.click());
  expect(location.pathname).toBe('/new');
  expect(document.querySelector('form.create-modal')).not.toBeNull();
  await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  await render();
  expect(location.pathname).toBe('/new');
  expect(document.querySelector('form.create-modal')).not.toBeNull();
});
