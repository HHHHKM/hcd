// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Document } from '../../../core/src/model';

let root: Root | undefined;
const first = 'd_aaaaaaaa';
const second = 'd_aaaaaaab';
const content = (id: string): Document => ({
  schemaVersion: 1,
  id,
  title: id === first ? 'First document' : 'Second document',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [
    {
      id: 'm_aaaaaaaa',
      title: 'Main',
      blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Known passage' }] }],
    },
  ],
});
const meta = (id: string) => ({
  id,
  title: content(id).title,
  role: 'owner',
  currentVersion: 1,
  aiEnabled: false,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  window.history.replaceState({}, '', '/');
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function click(selector: string) {
  const node = document.querySelector(selector);
  expect(node, selector).not.toBeNull();
  await act(async () => node!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
async function fixture(path = '/', delayed = false) {
  await import('../VersionComparison');
  window.history.replaceState({}, '', path);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Element.prototype.scrollIntoView = vi.fn();
  let release: (() => void) | undefined;
  let oldSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input).replace('/api/v1', '');
      if (url === '/auth/config') return json({ passwordResetEnabled: false });
      if (url === '/me')
        return json({
          user: {
            id: 'u_fixture',
            name: 'Member',
            email: 'local@example.test',
            locale: 'en',
          },
        });
      if (url === '/spaces') return json({ spaces: [] });
      if (url === '/docs') return json({ docs: [meta(first), meta(second)] });
      if (url === '/notifications/unread-count') return json({ count: 0 });
      if (url === '/me/tokens') return json({ tokens: [] });
      const id = url.includes(second) ? second : first;
      if (url === `/docs/${id}`) {
        if (delayed && id === first) {
          oldSignal = init?.signal ?? undefined;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return json({ doc: meta(id), content: content(id) });
      }
      if (url.endsWith('/versions'))
        return json({
          versions: [
            {
              version: 1,
              authorName: 'Member',
              kind: 'create',
              createdAt: '2026-10-24T00:00:00Z',
            },
            { version: 2, authorName: 'Member', kind: 'publish', createdAt: '2026-10-24T01:00:00Z' },
          ],
        });
      if (url.includes('/compare?')) {
        const query = new URLSearchParams(url.split('?')[1]);
        return json({ from: Number(query.get('from')), to: Number(query.get('to')), changeSet: { changes: [] } });
      }
      if (url.endsWith('/versions/1'))
        return json({
          version: {
            number: 1,
            content: content(id),
            authorName: 'Member',
            kind: 'create',
            createdAt: '2026-10-24T00:00:00Z',
          },
        });
      if (url.endsWith('/submissions'))
        return json({
          submissions: [
            {
              id: 'sub_saved',
              authorId: 'u_fixture',
              status: 'pending',
              message: 'A saved review',
              baseVersion: 1,
              createdAt: '2026-10-24T00:00:00Z',
            },
          ],
        });
      if (url.endsWith('/previews') || url === '/previews/pv_saved')
        return json({
          preview: {
            id: 'pv_saved',
            revision: 1,
            baseVersion: 1,
            status: 'open',
            publishable: true,
            conflicts: [],
            candidate: content(id),
          },
        });
      if (url.endsWith('/comments?status=all'))
        return json({
          threads: [
            {
              root: {
                id: 'cm_target',
                authorId: 'u_fixture',
                body: 'Linked discussion',
                createdAt: '2026-10-24T00:00:00Z',
                anchor: {
                  moduleId: 'm_aaaaaaaa',
                  blockId: 'n_aaaaaaaa',
                  field: 'text',
                  quote: 'Known',
                  version: 1,
                },
              },
              replies: [],
              anchorState: 'ok',
              range: { start: 0, end: 5 },
            },
          ],
        });
      throw new Error(`Unexpected fixture URL ${url}`);
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  return { release: () => release?.(), oldSignal: () => oldSignal };
}

describe('workspace navigation and requests', () => {
  it(
    'C1 aborts an older document request and prevents its late response ' + 'from replacing the selected document',
    async () => {
      const pending = await fixture('/', true);
      await click('.doc-card');
      await click('.doc-list-item:nth-of-type(2)');
      expect(pending.oldSignal()?.aborted).toBe(true);
      await act(async () => pending.release());
      expect(document.querySelector('.doc-title-block h1')?.textContent).toBe('Second document');
      expect(window.location.pathname).toBe(`/d/${second}`);
    },
  );
  it.each(['history', 'compare?from=1&to=1', 'review'])('C2 restores a direct document %s route', async (page) => {
    await fixture(`/d/${first}/${page}`);
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('First document');
    expect(
      page === 'review' ? document.querySelector('.review-modal') : document.querySelector('.version-comparison'),
    ).not.toBeNull();
  });
  it('C2 restores the requested comparison direction and writes selector changes to browser history', async () => {
    await fixture(`/d/${first}/compare?from=2&to=1`);
    const selectors = document.querySelectorAll<HTMLSelectElement>('.version-selectors select');
    expect(Array.from(selectors).map((select) => select.value)).toEqual(['2', '1']);
    await act(async () => {
      selectors[0]!.value = '1';
      selectors[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(window.location.search).toBe('?from=1&to=1');
  });
  it('C2 puts a newly saved preview in the URL so refresh can restore it', async () => {
    await fixture(`/d/${first}/review`);
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent === 'Build merge preview',
    );
    await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(window.location.pathname).toBe(`/d/${first}/review/pv_saved`);
    const container = document.body.firstElementChild!;
    await act(async () => root!.unmount());
    root = createRoot(container);
    await act(async () => root!.render(<App />));
    expect(document.querySelector('.preview-content')).not.toBeNull();
  });
  it('C2 restores the previous document with the browser Back button', async () => {
    await fixture();
    await click('.doc-card');
    await click('.doc-list-item:nth-of-type(2)');
    expect(window.location.pathname).toBe(`/d/${second}`);
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(window.location.pathname).toBe(`/d/${first}`);
    expect(document.querySelector('.doc-title-block h1')?.textContent).toBe('First document');
  });
  it('C8 remembers a collapsed discussion rail across document changes and reloads', async () => {
    localStorage.setItem('hcd.discussion.open', 'true');
    await fixture();
    await click('.doc-card');
    expect(document.querySelector('.right-rail.open')).not.toBeNull();
    await click('.right-tab-more');
    await click('.doc-list-item:nth-of-type(2)');
    expect(document.querySelector('.right-rail.open')).toBeNull();
    const container = document.body.firstElementChild!;
    await act(async () => root!.unmount());
    root = createRoot(container);
    await act(async () => root!.render(<App />));
    expect(document.querySelector('.right-rail')).not.toBeNull();
    expect(document.querySelector('.right-rail.open')).toBeNull();
  });
  it('C2 restores personal settings directly from the route', async () => {
    await fixture('/settings');
    expect(document.querySelector('.settings-modal .password-form')).not.toBeNull();
  });
  it('C2 locates and highlights a comment from the URL fragment', async () => {
    await fixture(`/d/${first}#comment-cm_target`);
    expect(document.querySelector('.right-rail.open')).not.toBeNull();
    expect(document.querySelector('[data-hcd-location-active]')).not.toBeNull();
    expect(document.querySelector('[data-hcd-highlight]')?.textContent).toBe('Known');
  });
  it('C2 scrolls and highlights the linked discussion topic', async () => {
    await fixture(`/d/${first}#comment-cm_target`);
    const topic = document.getElementById('comment-cm_target');
    expect(topic).not.toBeNull();
    expect(topic?.getAttribute('data-hcd-thread-active')).toBe('true');
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    expect(scroll.mock.contexts).toContain(topic);
  });
});
