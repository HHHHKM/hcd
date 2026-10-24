// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Document } from '../../core/src/model';
import type { Anchor } from '../../core/src/anchors';
import type { Thread } from './api';

const content: Document = {
  schemaVersion: 1,
  id: 'd_aaaaaaaa',
  title: 'Selection fixture',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [
    {
      id: 'm_aaaaaaaa',
      title: 'Main',
      blocks: [
        {
          id: 'n_aaaaaaaa',
          type: 'paragraph',
          text: [{ t: 'Before ' }, { t: '你好 🌍', b: true }, { br: true }, { t: 'world after', i: true }],
        },
      ],
    },
  ],
};
let root: Root | undefined;
beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
function button(text: string) {
  const result = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === text);
  expect(result, text).toBeDefined();
  return result!;
}
async function typeComment(value: string) {
  const input = document.querySelector<HTMLTextAreaElement>('.comment-composer textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function selectQuote() {
  const field = document.querySelector<HTMLElement>('[data-hcd-node-id="n_aaaaaaaa"][data-hcd-field="text"]')!;
  expect(field).not.toBeNull();
  const start = document.createTreeWalker(field.querySelector('strong')!, NodeFilter.SHOW_TEXT).nextNode()!;
  const end = document.createTreeWalker(field.querySelector('em')!, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, 5);
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await click(button('Comment on selected text'));
}
async function fixture(role = 'commenter') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Element.prototype.scrollIntoView = vi.fn();
  let threads: Thread[] = [];
  const posted: Array<{ body: string; anchor: Anchor }> = [];
  const savedDrafts: Array<{ baseVersion: number; content: Document }> = [];
  const controls = { rejectAnchor: false, failRefresh: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace('/api/v1', '');
      let body: unknown;
      if (path === '/auth/config') body = { passwordResetEnabled: false };
      else if (path === '/me')
        body = { user: { id: 'u_fixture', name: 'Test', email: 'test@example.com', locale: 'en' } };
      else if (path === '/spaces') body = { spaces: [] };
      else if (path === '/me/tokens') body = { tokens: [] };
      else if (path === '/docs')
        body = { docs: [{ id: content.id, title: content.title, currentVersion: 2, aiEnabled: false, role }] };
      else if (path === '/notifications/unread-count') body = { count: 0 };
      else if (path === `/docs/${content.id}`)
        body = { doc: { id: content.id, title: content.title, currentVersion: 2, aiEnabled: false, role }, content };
      else if (path === `/docs/${content.id}/submissions`)
        body = {
          submissions: [
            {
              id: 'sb_fixture',
              authorId: 'u_fixture',
              message: 'Responsive review',
              status: 'pending',
              baseVersion: 2,
              createdAt: '2026-10-23T00:00:00Z',
            },
          ],
        };
      else if (path === `/docs/${content.id}/previews`)
        body = {
          preview: {
            id: 'pv_fixture',
            revision: 1,
            baseVersion: 2,
            status: 'open',
            publishable: true,
            conflicts: [],
            candidate: content,
          },
        };
      else if (path === `/docs/${content.id}/draft` && init?.method === 'PUT') {
        savedDrafts.push(JSON.parse(String(init.body)));
        body = {};
      } else if (path === `/docs/${content.id}/comments` && init?.method === 'POST') {
        const submitted = JSON.parse(String(init.body)) as { body: string; anchor: Anchor };
        posted.push(submitted);
        if (controls.rejectAnchor)
          return new Response(JSON.stringify({ error: { code: 'ANCHOR_STALE' } }), { status: 409 });
        const thread: Thread = {
          root: {
            id: 'cm_fixture',
            body: submitted.body,
            authorId: 'u_fixture',
            createdAt: '2026-10-23T00:00:00Z',
            anchor: submitted.anchor,
          },
          replies: [],
          anchorState: 'ok',
          range: { start: 7, end: 18 },
        };
        threads = [thread];
        body = { comment: { ...thread.root, anchorState: 'ok', range: thread.range } };
      } else if (path === `/docs/${content.id}/comments?status=all`) {
        if (controls.failRefresh)
          return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 });
        body = { threads };
      } else throw new Error(`Unexpected fixture request: ${path}`);
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await click(document.querySelector('.doc-card')!);
  return { posted, savedDrafts, controls };
}

describe('quoted comments in the application (synthetic DOM)', () => {
  it(
    'carries a formatted Unicode/newline selection through composition, posting ' + 'and exact highlight navigation',
    async () => {
      const f = await fixture();
      await selectQuote();
      expect(document.querySelector('.comment-selection-summary blockquote')!.textContent).toBe('你好 🌍\nworld');
      await typeComment('Discuss this phrase');
      await act(async () => {
        document
          .querySelector('.comment-composer')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(f.posted).toEqual([
        {
          body: 'Discuss this phrase',
          anchor: {
            moduleId: 'm_aaaaaaaa',
            blockId: 'n_aaaaaaaa',
            field: 'text',
            quote: '你好 🌍\nworld',
            prefix: 'Before ',
            suffix: ' after',
            version: 2,
          },
        },
      ]);
      expect(document.querySelector('.comment-selection-summary')).toBeNull();
      await click(button('Go to quoted content'));
      expect(
        Array.from(document.querySelectorAll('[data-hcd-highlight]'))
          .map((node) => (node.querySelector('br') ? '\n' : node.textContent))
          .join(''),
      ).toBe('你好 🌍\nworld');
      expect(document.querySelector('[data-hcd-location-active]')?.getAttribute('data-hcd-node-id')).toBe('n_aaaaaaaa');
      await selectQuote();
      expect(document.querySelector('[data-hcd-location-active]')).toBeNull();
      expect(document.querySelector('[data-hcd-highlight]')).toBeNull();
    },
  );
  it(
    'preserves comment text on a stale selection and reloads the same document ' + 'without reusing the old anchor',
    async () => {
      const f = await fixture();
      f.controls.rejectAnchor = true;
      await selectQuote();
      await typeComment('Keep my work');
      await act(async () => {
        document
          .querySelector('.comment-composer')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(document.querySelector<HTMLTextAreaElement>('.comment-composer textarea')?.value).toBe('Keep my work');
      expect(document.querySelector('.global-error')?.textContent).toContain('choose a location');
      await click(button('Reload and select again'));
      expect(document.querySelector<HTMLTextAreaElement>('.comment-composer textarea')?.value).toBe('Keep my work');
      expect(document.querySelector('.comment-selection-summary')).toBeNull();
      expect(f.posted).toHaveLength(1);
    },
  );
  it('does not offer selection posting to a viewer', async () => {
    await fixture('viewer');
    const field = document.querySelector('[data-hcd-node-id="n_aaaaaaaa"]')!;
    const range = document.createRange();
    range.selectNodeContents(field);
    await act(async () => {
      document.getSelection()!.addRange(range);
      field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(document.querySelector('.selection-comment-tools')).toBeNull();
    expect(document.querySelector('.comment-composer')).toBeNull();
  });
  it('reports a completed send separately from a failed refresh without reusing the submitted text', async () => {
    const f = await fixture();
    await selectQuote();
    await typeComment('Already posted');
    f.controls.failRefresh = true;
    await act(async () => {
      document
        .querySelector('.comment-composer')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(f.posted).toHaveLength(1);
    expect(document.querySelector('.global-error')?.textContent).toContain('Your comment was posted');
    expect(document.querySelector<HTMLTextAreaElement>('.comment-composer textarea')?.value).toBe('');
    expect(document.querySelector('.comment-selection-summary')).toBeNull();
    await act(async () => {
      document
        .querySelector('.comment-composer')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(f.posted).toHaveLength(1);
  });
});

function viewport(initialWidth: number) {
  let width = initialWidth;
  const queries: Array<{ media: string; matches: boolean; update: () => void }> = [];
  vi.stubGlobal('matchMedia', (media: string) => {
    const listeners = new Set<() => void>();
    const query = {
      media,
      matches: width <= Number(media.match(/\d+/)![0]),
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      update() {
        this.matches = width <= Number(media.match(/\d+/)![0]);
        listeners.forEach((listener) => listener());
      },
    };
    queries.push(query);
    return query;
  });
  return async (nextWidth: number) => {
    await act(async () => {
      width = nextWidth;
      queries.forEach((query) => query.update());
    });
  };
}

describe('responsive reading controls (synthetic DOM)', () => {
  it('withholds title editing in phone settings and saves a retained desktop draft after resizing', async () => {
    const resize = viewport(360);
    const f = await fixture('owner');
    await click(document.querySelector('[aria-label="Settings"]')!);
    expect(document.querySelector('.settings-modal')).not.toBeNull();
    expect(document.querySelector('.settings-title-form')).toBeNull();
    expect(f.savedDrafts).toEqual([]);
    await resize(805);
    const title = document.querySelector<HTMLInputElement>('.settings-title-form input')!;
    expect(title).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Desktop title draft');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      document
        .querySelector('.settings-title-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector<HTMLInputElement>('.doc-title-edit')?.value).toBe('Desktop title draft');
    // Switching to phone reading must keep the pending desktop draft save.
    await resize(360);
    expect(document.querySelector('.doc-title-edit')).toBeNull();
    expect(document.querySelector('.doc-title-block h1')?.textContent).toBe(content.title);
    await act(async () => {
      await vi.waitFor(() => expect(f.savedDrafts).toHaveLength(1), { timeout: 2000 });
    });
    expect(f.savedDrafts[0]).toMatchObject({ baseVersion: 2, content: { title: 'Desktop title draft' } });
    await resize(805);
    expect(document.querySelector<HTMLInputElement>('.doc-title-edit')?.value).toBe('Desktop title draft');
  });
  it(
    'keeps review viewing available on phones while withholding editing and publication, ' + 'including after resize',
    async () => {
      const resize = viewport(360);
      await fixture('owner');
      expect(Array.from(document.querySelectorAll('button')).some((item) => item.textContent === 'Edit document')).toBe(
        false,
      );
      expect(document.querySelector('.mobile-reading-note')?.textContent).toContain('Use a computer');
      await click(button('View review'));
      await click(button('Build merge preview'));
      expect(document.querySelector('.mobile-review-note')?.textContent).toContain('Use a computer');
      expect(
        Array.from(document.querySelectorAll('button')).some((item) => item.textContent === 'Confirm & publish'),
      ).toBe(false);
      await resize(805);
      expect(button('Edit document')).toBeDefined();
      expect(button('Confirm & publish')).toBeDefined();
      await resize(360);
      expect(
        Array.from(document.querySelectorAll('button')).some((item) => item.textContent === 'Confirm & publish'),
      ).toBe(false);
      expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/publish'))).toBe(false);
    },
  );
  it('closes the tablet discussion drawer when navigating to highlighted text', async () => {
    viewport(805);
    await fixture();
    await selectQuote();
    await typeComment('Show this passage');
    await act(async () => {
      document
        .querySelector('.comment-composer')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.right-rail.open')).not.toBeNull();
    await click(button('Go to quoted content'));
    expect(document.querySelector('.right-rail.open')).toBeNull();
    expect(document.querySelector('[data-hcd-highlight]')).not.toBeNull();
  });
});
