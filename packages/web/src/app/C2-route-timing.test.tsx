// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import type { Document } from '../../../core/src/model';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  history.replaceState({}, '', '/');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const docId = 'd_timing';
const content = (title: string): Document => ({
  schemaVersion: 1,
  id: docId,
  title,
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [
    {
      id: 'm_fixture',
      title: 'Main',
      blocks: [{ id: 'n_fixture', type: 'paragraph', text: [{ t: 'Known passage' }] }],
    },
  ],
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function fixture(path: string, delayed: 'version' | 'review') {
  history.replaceState({}, '', path);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const scrollVersions: string[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    if (this.closest('.document-page'))
      scrollVersions.push(document.querySelector('.document-actions .version-pill')?.textContent ?? '');
  });
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  let submissionReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace('/api/v1', '');
      if (path === '/auth/config') return json({ passwordResetEnabled: false });
      if (path === '/me')
        return json({ user: { id: 'u_fixture', name: 'Member', email: 'local@example.test', locale: 'en' } });
      if (path === '/spaces') return json({ spaces: [] });
      if (path === '/docs') return json({ docs: [] });
      if (path === '/notifications/unread-count') return json({ count: 0 });
      if (path === '/me/tokens') return json({ tokens: [] });
      if (path === `/docs/${docId}`)
        return json({
          doc: { id: docId, title: 'Current document', role: 'owner', currentVersion: 2, aiEnabled: false },
          content: content('Current document'),
        });
      if (path === `/docs/${docId}/comments?status=all`)
        return json({
          threads: [
            {
              root: {
                id: 'cm_target',
                body: 'Linked discussion',
                authorId: 'u_fixture',
                createdAt: '2026-10-24T00:00:00Z',
                anchor: { moduleId: 'm_fixture', blockId: 'n_fixture', field: 'text', quote: 'Known', version: 2 },
              },
              replies: [],
              anchorState: 'ok',
              range: { start: 0, end: 5 },
            },
          ],
        });
      if (path === `/docs/${docId}/submissions`) {
        submissionReads++;
        if (delayed === 'review' && submissionReads > 1) {
          signal = init?.signal ?? undefined;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return json({ submissions: [] });
      }
      if (path === `/docs/${docId}/versions/1`) {
        signal = init?.signal ?? undefined;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return json({ version: { number: 1, content: content('Historical document') } });
      }
      throw new Error(`Unexpected fixture URL ${path}`);
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  return { release: () => release?.(), signal: () => signal, scrollVersions };
}
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label)!;
it('C2 cancels a pending review read when navigating to personal settings', async () => {
  const f = await fixture(`/d/${docId}`, 'review');
  await act(async () => button('Review & publish (0)').click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(location.pathname).toBe('/settings');
  expect(f.signal()?.aborted).toBe(true);
  await act(async () => f.release());
  expect(document.querySelector('[aria-labelledby="review-title"]')).toBeNull();
  expect(document.querySelector('.settings-modal')).not.toBeNull();
});
it('C2 waits for the requested historical version before locating a linked comment', async () => {
  const f = await fixture(`/d/${docId}?v=1#comment-cm_target`, 'version');
  expect(f.scrollVersions).toEqual([]);
  await act(async () => f.release());
  expect(document.querySelector('.doc-title-block h1')?.textContent).toBe('Historical document');
  expect(f.scrollVersions).toEqual(['v1']);
});
