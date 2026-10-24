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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const content = {
  schemaVersion: 1,
  id: 'd_route',
  title: 'Route document',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [],
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function fixture(path: string, delayBoot = false) {
  history.replaceState({}, '', path);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  let bootSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input).replace('/api/v1', '');
      if (url === '/auth/config') return json({ passwordResetEnabled: false });
      if (url === '/me') {
        bootSignal = init?.signal ?? undefined;
        if (delayBoot) return new Promise<Response>(() => {});
        return json({ user: { id: 'u_route', name: 'Reader', email: 'reader@example.test', locale: 'en' } });
      }
      if (url === '/spaces') return json({ spaces: [{ id: 'sp_route', name: 'Fixture space', role: 'owner' }] });
      if (url === '/docs') return json({ docs: [] });
      if (url === '/notifications/unread-count') return json({ count: 0 });
      if (url === '/me/tokens') return json({ tokens: [] });
      if (url === '/auth/logout' || url === '/auth/logout-all') return new Response(null, { status: 204 });
      if (url === '/imports/im_saved/discard') return new Response(null, { status: 204 });
      if (url === '/docs/d_route')
        return json({
          doc: { id: 'd_route', title: content.title, role: 'owner', currentVersion: 1, aiEnabled: false },
          content,
        });
      if (url === '/docs/d_route/comments?status=all') return json({ threads: [] });
      if (url === '/docs/d_route/submissions') return json({ submissions: [] });
      if (url === '/imports/im_saved' || (url === '/imports' && init?.method === 'POST'))
        return json({
          import: {
            id: 'im_saved',
            status: 'ready',
            filename: 'saved.html',
            report: { removed: 0, warnings: [] },
            content,
          },
        });
      throw new Error(`Unexpected fixture URL ${url}`);
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  return { bootSignal: () => bootSignal };
}
it('C1 aborts an unfinished session request when the workspace unmounts', async () => {
  const f = await fixture('/', true);
  await act(async () => root!.unmount());
  root = undefined;
  expect(f.bootSignal()?.aborted).toBe(true);
});
it('C2 restores a saved import preview from its route', async () => {
  await fixture('/import/im_saved');
  expect(document.querySelector('.import-report-heading p')?.textContent).toBe('saved.html');
  expect(document.querySelector('.import-content-preview')).not.toBeNull();
});
it('C2 closes a discarded saved import route', async () => {
  await fixture('/import/im_saved');
  const discard = document.querySelector<HTMLButtonElement>('.import-report .modal-footer .button-soft')!;
  await act(async () => discard.click());
  expect(location.pathname).toBe('/');
  expect(document.querySelector('.import-modal')).toBeNull();
});
it('C2 puts a prepared import in its resumable route', async () => {
  await fixture('/import');
  const file = new File(['<h1>Saved</h1>'], 'saved.html', { type: 'text/html' });
  Object.defineProperty(file, 'text', { value: async () => '<h1>Saved</h1>' });
  const input = document.querySelector<HTMLInputElement>('.file-picker')!;
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const space = document.querySelector<HTMLSelectElement>('.import-modal select')!;
  await act(async () => {
    space.value = 'sp_route';
    space.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    document
      .querySelector<HTMLFormElement>('.import-modal form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(location.pathname).toBe('/import/im_saved');
  expect(document.querySelector('.import-report-heading p')?.textContent).toBe('saved.html');
});
it('C2 reflects logout in the login route', async () => {
  await fixture('/d/d_route');
  await act(async () => document.querySelector<HTMLButtonElement>('.profile')!.click());
  expect(location.pathname).toBe('/login');
  expect(document.querySelector('.auth-card')).not.toBeNull();
});
it('C2 reflects signing out all devices in the login route', async () => {
  await fixture('/settings');
  await act(async () => document.querySelector<HTMLButtonElement>('.logout-all-sessions button')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('.logout-all-confirm .button-danger')!.click());
  expect(location.pathname).toBe('/login');
  expect(document.querySelector('.auth-card')).not.toBeNull();
});
it('C2 restores the existing document settings controls from their route', async () => {
  await fixture('/d/d_route/settings');
  expect(document.querySelector('.settings-title-form input')?.getAttribute('value')).toBe('Route document');
  expect(document.querySelector('[role="switch"]')).not.toBeNull();
});
