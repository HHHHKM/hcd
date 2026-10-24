// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import SharedDocument from './SharedDocument';
import type { Thread } from './api';
import { root, json, snapshot, enterComment, click, fixture } from './test-fixtures/shared-document';

describe('share document state (synthetic DOM)', () => {
  it(
    'clears old discussions and composition immediately when switching share tokens, ' + 'including failed new reads',
    async () => {
      const f = await fixture();
      await enterComment('Private draft on one');
      await click('Reply');
      expect(document.body.textContent).toContain('one discussion');
      let resolveDocument!: (value: Response) => void;
      f.controls.secondDocument = new Promise((resolve) => {
        resolveDocument = resolve;
      });
      f.controls.failComments = true;
      await act(async () => root!.render(<SharedDocument token="two" />));
      expect(document.body.textContent).not.toContain('one discussion');
      expect(document.querySelector('textarea')).toBeNull();
      await act(async () => {
        resolveDocument(json(snapshot('two')));
      });
      expect(document.body.textContent).toContain('two document');
      expect(document.body.textContent).not.toContain('one discussion');
      expect(document.querySelector('textarea')?.value).toBe('');
      expect(document.querySelector('select')?.value).toBe('');
      expect(document.body.textContent).toContain('Discussions could not be loaded');
      expect(f.posted).toHaveLength(0);
    },
  );
  it('clears stale threads on refresh failure while preserving the same document comment draft', async () => {
    const f = await fixture();
    await enterComment('Keep while refreshing');
    f.controls.failComments = true;
    await click('Refresh discussions');
    expect(document.body.textContent).not.toContain('one discussion');
    expect(document.body.textContent).toContain('Discussions could not be loaded');
    expect(document.querySelector('textarea')?.value).toBe('Keep while refreshing');
  });
  it('distinguishes a successful post from the subsequent discussion refresh failure', async () => {
    const f = await fixture();
    await enterComment('Accepted comment');
    f.controls.failAfterPost = true;
    await act(async () => {
      document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(f.posted).toEqual([{ body: 'Accepted comment', anchor: {} }]);
    expect(document.body.textContent).toContain('Comment posted, but discussions could not refresh');
    expect(document.querySelector('textarea')?.value).toBe('');
  });
});

async function selectPassage(activate = true) {
  const field = document.querySelector<HTMLElement>('[data-hcd-node-id="n_one"][data-hcd-field="text"]')!;
  expect(field).not.toBeNull();
  const text = document.createTreeWalker(field, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(text, 4);
  range.setEnd(text, 11);
  await act(async () => {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  if (activate) await click('Comment on selected text');
}
async function submitComment() {
  await act(async () => {
    document
      .querySelector('.guest-comment-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
const locatedThread = (changes: Partial<Thread> = {}): Thread => ({
  root: {
    id: 'cm_location',
    body: 'Discussion on visible words',
    authorId: 'g_fixture',
    createdAt: '2026-10-23T00:00:00Z',
    anchor: {
      moduleId: 'm_one',
      blockId: 'n_one',
      field: 'text',
      quote: 'visible',
      prefix: 'one ',
      suffix: ' content',
      version: 1,
    },
  },
  replies: [],
  anchorState: 'ok',
  range: { start: 4, end: 11 },
  ...changes,
});

describe('guest quoted comments (synthetic DOM)', () => {
  it('posts the visible pinned version and highlights its exact returned public projection', async () => {
    const f = await fixture({ pinned: true });
    await selectPassage();
    expect(document.querySelector('.shared-version')?.textContent).toContain('v1 · Pinned version');
    expect(document.querySelector('.shared-comment-selection')?.textContent).toContain('published version v1');
    expect(document.querySelector('.shared-comment-selection blockquote')?.textContent).toBe('visible');
    await enterComment('Discuss pinned content');
    await submitComment();
    expect(f.posted).toEqual([
      {
        body: 'Discuss pinned content',
        anchor: {
          moduleId: 'm_one',
          blockId: 'n_one',
          field: 'text',
          quote: 'visible',
          prefix: 'one ',
          suffix: ' content',
          version: 1,
        },
      },
    ]);
    expect(document.querySelector('.shared-comment-selection')).toBeNull();
    await click('Go to quoted content');
    expect(document.querySelector('[data-hcd-highlight]')?.textContent).toBe('visible');
    expect(document.querySelector('[data-hcd-location-active]')?.getAttribute('data-hcd-node-id')).toBe('n_one');
    // A new quote clears the old focus/highlight; the native range crosses the old mark.
    const field = document.querySelector<HTMLElement>('[data-hcd-node-id="n_one"]')!;
    const range = document.createRange();
    range.selectNodeContents(field);
    await act(async () => {
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
      field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await click('Comment on selected text');
    expect(document.querySelector('[data-hcd-highlight]')).toBeNull();
    expect(document.querySelector('[data-hcd-location-active]')).toBeNull();
  });
  it.each([{ role: 'viewer' }, { guest: false }, { showComments: false }])(
    'withholds both selection and replies without guest commenter access: %o',
    async (options) => {
      const f = await fixture(options);
      await selectPassage(false);
      expect(document.querySelector('.selection-comment-tools')).toBeNull();
      expect(document.querySelector('.guest-comment-form')).toBeNull();
      expect(Array.from(document.querySelectorAll('button')).some((button) => button.textContent === 'Reply')).toBe(
        false,
      );
      expect(f.posted).toEqual([]);
      if ('showComments' in options && !options.showComments)
        expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/comments'))).toBe(false);
    },
  );
  it.each(['ANCHOR_STALE', 'INVALID_ANCHOR_VERSION'])(
    'retains the body after %s, reloads without the reference, and can select again',
    async (code) => {
      const f = await fixture({ pinned: true });
      f.controls.rejectPost = code;
      await selectPassage();
      await enterComment('Keep this reply');
      await submitComment();
      expect(document.querySelector('textarea')?.value).toBe('Keep this reply');
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('reload and choose a location');
      await click('Reload and select again');
      expect(document.querySelector('textarea')?.value).toBe('Keep this reply');
      expect(document.querySelector('.shared-comment-selection')).toBeNull();
      f.controls.rejectPost = '';
      await selectPassage();
      await submitComment();
      expect(f.posted).toHaveLength(2);
      expect(document.querySelector('textarea')?.value).toBe('');
    },
  );
  it('converts a selected quote to a module comment without losing its body or the visible baseline', async () => {
    const f = await fixture({ pinned: true });
    await selectPassage();
    await enterComment('Discuss the section');
    await click('Comment on the section instead');
    expect(document.querySelector('select')?.value).toBe('m_one');
    expect(document.querySelector('textarea')?.value).toBe('Discuss the section');
    await submitComment();
    expect(f.posted).toEqual([{ body: 'Discuss the section', anchor: { moduleId: 'm_one', version: 1 } }]);
  });
  it('clears an independent quote when replying and sends only the parent reference', async () => {
    const f = await fixture();
    await selectPassage();
    await enterComment('A reply');
    await click('Reply');
    expect(document.querySelector('.shared-comment-selection')).toBeNull();
    await submitComment();
    expect(f.posted).toEqual([{ body: 'A reply', parentId: 'cm_one' }]);
  });
  it('guards synchronous duplicate submits and never retries accepted text after a refresh failure', async () => {
    const f = await fixture();
    await selectPassage();
    await enterComment('Only once');
    f.controls.failAfterPost = true;
    let resolvePost!: (value: Response) => void;
    f.controls.pendingPost = new Promise((resolve) => {
      resolvePost = resolve;
    });
    await act(async () => {
      const form = document.querySelector('.guest-comment-form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(f.posted).toHaveLength(1);
    await act(async () => {
      resolvePost(json({ comment: { id: 'cm_posted' } }, 201));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Comment posted, but discussions could not refresh',
    );
    expect(document.querySelector('textarea')?.value).toBe('');
    expect(document.querySelector('.shared-comment-selection')).toBeNull();
    await submitComment();
    expect(f.posted).toHaveLength(1);
  });
  it('clears selected references on same-document refresh while retaining the body', async () => {
    await fixture();
    await selectPassage();
    await enterComment('Save my draft');
    await click('Refresh discussions');
    expect(document.querySelector('.shared-comment-selection')).toBeNull();
    expect(document.querySelector('textarea')?.value).toBe('Save my draft');
  });
  it('clears a selected reference and its body on a share-token change', async () => {
    await fixture();
    await selectPassage();
    await enterComment('Do not leak');
    await act(async () => root!.render(<SharedDocument token="two" />));
    expect(document.querySelector('.shared-comment-selection')).toBeNull();
    expect(document.querySelector('textarea')?.value).toBe('');
    expect(document.body.textContent).not.toContain('one visible content');
  });
  it.each(['text_changed', 'block_deleted', 'mismatched_version', 'mismatched_quote'] as const)(
    'never highlights an inexact public anchor: %s',
    async (condition) => {
      const thread = locatedThread();
      if (condition === 'mismatched_version') thread.root.anchor!.version = 2;
      else if (condition === 'mismatched_quote') thread.root.anchor!.quote = 'different';
      else thread.anchorState = condition;
      if (condition === 'block_deleted') thread.root.anchor!.blockId = 'n_deleted';
      await fixture({ pinned: true, threads: [thread] });
      await click('Go to quoted content');
      expect(document.querySelector('[data-hcd-highlight]')).toBeNull();
      expect(document.querySelector('blockquote[aria-label="Quoted text"]')).toBeNull();
      const target = document.querySelector('[data-hcd-location-active]');
      expect(target?.getAttribute(condition === 'block_deleted' ? 'data-hcd-module-id' : 'data-hcd-block-id')).toBe(
        condition === 'block_deleted' ? 'm_one' : 'n_one',
      );
    },
  );
  it('withholds navigation for lost or deleted roots and hides deleted quote/body text', async () => {
    const lost = locatedThread({ anchorState: 'lost' });
    const deleted = locatedThread();
    deleted.root = {
      ...deleted.root,
      id: 'cm_deleted',
      body: 'REMOVED_BODY',
      deletedAt: '2026-10-23T00:00:00Z',
      anchor: { ...deleted.root.anchor, quote: 'REMOVED_QUOTE' },
    };
    await fixture({ threads: [lost, deleted] });
    expect(document.body.textContent).toContain('original location is unavailable');
    expect(document.body.textContent).toContain('Comment deleted');
    expect(document.body.textContent).not.toContain('REMOVED_BODY');
    expect(document.body.textContent).not.toContain('REMOVED_QUOTE');
    expect(
      Array.from(document.querySelectorAll('button')).some((button) => button.textContent === 'Go to quoted content'),
    ).toBe(false);
    expect(document.querySelector('[data-hcd-highlight]')).toBeNull();
  });
});

describe('guest discussion request ordering (synthetic DOM)', () => {
  it.each(['success', 'failure'] as const)(
    'ignores a delayed initial %s after the posted discussion refresh has completed',
    async (outcome) => {
      let finishInitial!: (value: Response) => void;
      const initialComments = new Promise<Response>((resolve) => {
        finishInitial = resolve;
      });
      const f = await fixture({ initialComments });
      await selectPassage();
      await enterComment('Keep the newest discussion');
      await submitComment();
      expect(f.posted).toHaveLength(1);
      expect(document.querySelector('.shared-discussions article')?.textContent).toContain(
        'Keep the newest discussion',
      );
      await act(async () => {
        finishInitial(
          outcome === 'success'
            ? json({
                threads: [
                  { ...locatedThread(), root: { ...locatedThread().root, body: 'Old read must not replace this' } },
                ],
              })
            : json({ error: { code: 'UNAVAILABLE' } }, 503),
        );
      });
      expect(document.querySelector('.shared-discussions article')?.textContent).toContain(
        'Keep the newest discussion',
      );
      expect(document.body.textContent).not.toContain('Old read must not replace this');
      expect(document.querySelector('[role="alert"]')).toBeNull();
    },
  );
  it('ignores an obsolete initial error while the post is still pending', async () => {
    let finishInitial!: (value: Response) => void;
    let finishPost!: (value: Response) => void;
    const initialComments = new Promise<Response>((resolve) => {
      finishInitial = resolve;
    });
    const f = await fixture({ initialComments });
    await selectPassage();
    await enterComment('Wait for the post');
    f.controls.pendingPost = new Promise((resolve) => {
      finishPost = resolve;
    });
    await submitComment();
    await act(async () => {
      finishInitial(json({ error: { code: 'UNAVAILABLE' } }, 503));
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      finishPost(json({ comment: { id: 'cm_posted' } }, 201));
    });
    expect(document.querySelector('.shared-discussions article')?.textContent).toContain('Wait for the post');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
