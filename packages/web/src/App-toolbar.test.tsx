// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import type { Document } from '../../core/src/model';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  history.replaceState({}, '', '/');
});
const content: Document = {
  schemaVersion: 1,
  id: 'd_toolbar',
  title: 'Toolbar fixture',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [],
};
async function fixture(width: number) {
  await Promise.all([import('./ShareLinks'), import('./Administration')]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: width <= Number(media.match(/\d+/)![0]),
    addEventListener() {},
    removeEventListener() {},
  }));
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
      else if (path === '/docs')
        body = { docs: [{ id: content.id, title: content.title, currentVersion: 2, aiEnabled: false, role: 'owner' }] };
      else if (path === '/notifications/unread-count') body = { count: 0 };
      else if (path === `/docs/${content.id}`)
        body = {
          doc: { id: content.id, title: content.title, currentVersion: 2, aiEnabled: false, role: 'owner' },
          content,
        };
      else if (path.startsWith(`/docs/${content.id}/submissions`))
        body = {
          submissions: [{ id: 'sb_fixture', status: 'pending', baseVersion: 2, createdAt: '2026-10-24T00:00:00Z' }],
        };
      else if (path === `/docs/${content.id}/comments?status=all`) body = { threads: [] };
      else if (path === `/docs/${content.id}/share-links`) body = { links: [], commenterAvailable: false };
      else if (path === `/docs/${content.id}/members`) body = { members: [] };
      else throw new Error(`Unexpected fixture request: ${path}`);
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  const card = document.querySelector<HTMLButtonElement>('.doc-card')!;
  await act(async () => card.click());
}
it('C5 the application hides secondary toolbar actions until More is opened', async () => {
  await fixture(805);
  expect(
    [...document.querySelectorAll('.document-actions button')].some((item) => item.textContent === 'Export ZIP'),
  ).toBe(false);
  const more = document.querySelector<HTMLButtonElement>('[aria-label="More document actions"]');
  expect(more).toBeTruthy();
  await act(async () => more!.click());
  expect([...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent === 'Export ZIP')).toBe(
    true,
  );
});

it('C5 the owner toolbar displays the pending submission count before opening review', async () => {
  await fixture(1440);
  expect(
    [...document.querySelectorAll('.document-actions button')].some(
      (item) => item.textContent === 'Review & publish (1)',
    ),
  ).toBe(true);
});

const exactButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!;
it('C2 Share opens the share dialog through its document settings route', async () => {
  await fixture(1440);
  await act(async () => exactButton('Share').click());
  expect(document.querySelector('.share-links-modal')).not.toBeNull();
  expect(document.querySelector('.settings-modal')).toBeNull();
});
it('C2 Members opens document membership through its document settings route', async () => {
  await fixture(1440);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="More document actions"]')!.click());
  await act(async () => exactButton('Members').click());
  expect(document.querySelector('[aria-labelledby="members-title"]')).not.toBeNull();
  expect(document.querySelector('.settings-modal')).toBeNull();
});
it('C2 browser Back from edit mode restores reading mode for the same document', async () => {
  await fixture(1440);
  await act(async () => exactButton('Edit document').click());
  expect(location.search).toBe('?edit=1');
  expect(exactButton('Submit changes')).toBeTruthy();
  await act(async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(location.pathname).toBe(`/d/${content.id}`);
  expect(location.search).toBe('');
  expect(exactButton('Edit document')).toBeTruthy();
  expect(document.querySelector('.edit-dock')).toBeNull();
});

it('C2 adding a title from settings navigates to the retained document edit mode', async () => {
  await fixture(1440);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  const form = document.querySelector<HTMLFormElement>('.settings-title-form')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Updated title');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(location.pathname).toBe(`/d/${content.id}`);
  expect(location.search).toBe('?edit=1');
  expect(document.querySelector<HTMLInputElement>('.doc-title-edit')?.value).toBe('Updated title');
});
