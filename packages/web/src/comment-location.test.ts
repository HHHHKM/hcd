import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { threadTextAnchor, findCommentTarget } from './comment-location';
import type { Document } from '../../core/src/model';
import type { Thread } from './api';

const document: Document = {
  schemaVersion: 1,
  id: 'd_aaaaaaaa',
  title: 'Comments',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [
    {
      id: 'm_aaaaaaaa',
      title: 'Section',
      blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: '你好 🌍 world' }] }],
    },
  ],
};
const thread: Thread = {
  root: {
    id: 'cm_fixture',
    body: 'Check this',
    authorId: 'u_fixture',
    createdAt: '2026-10-23T00:00:00Z',
    anchor: { moduleId: 'm_aaaaaaaa', blockId: 'n_aaaaaaaa', field: 'text', quote: '🌍 world', version: 2 },
  },
  replies: [],
  anchorState: 'ok',
  range: { start: 3, end: 11 },
};
describe('comment location in the displayed snapshot', () => {
  it('uses exact UTF-16 offsets only for the matching official version and quote', () => {
    expect(threadTextAnchor(thread, document, 2)).toEqual({
      blockId: 'n_aaaaaaaa',
      field: 'text',
      quote: '🌍 world',
      range: { start: 3, end: 11 },
    });
    expect(threadTextAnchor(thread, document, 3)).toBeNull();
    expect(threadTextAnchor({ ...thread, range: { start: 0, end: 8 } }, document, 2)).toBeNull();
    expect(threadTextAnchor({ ...thread, range: { start: -1, end: 11 } }, document, 2)).toBeNull();
    expect(threadTextAnchor({ ...thread, anchorState: 'text_changed' }, document, 2)).toBeNull();
    expect(
      threadTextAnchor({ ...thread, root: { ...thread.root, deletedAt: '2026-10-23T01:00:00Z' } }, document, 2),
    ).toBeNull();
    expect(
      threadTextAnchor(
        { ...thread, root: { ...thread.root, anchor: { ...thread.root.anchor, moduleId: 'm_bbbbbbbb' } } },
        document,
        2,
      ),
    ).toBeNull();
  });
  it('navigates inside the requested module and falls back from changed text to a block or section', () => {
    const dom = new JSDOM(
      '<div id="reading"><section data-hcd-module-id="m_bbbbbbbb">' +
        '<span data-hcd-node-id="n_aaaaaaaa" data-hcd-field="text">Other snapshot</span></section>' +
        '<section data-hcd-module-id="m_aaaaaaaa"><p data-hcd-block-id="n_aaaaaaaa">' +
        '<span data-hcd-node-id="n_aaaaaaaa" data-hcd-field="text">你好 🌍 world</span></p></section></div>',
    );
    try {
      const root = dom.window.document.getElementById('reading')!;
      expect(findCommentTarget(root, thread.root.anchor!)?.tagName).toBe('SPAN');
      expect(findCommentTarget(root, thread.root.anchor!)?.textContent).toBe('你好 🌍 world');
      expect(findCommentTarget(root, thread.root.anchor!, false)?.tagName).toBe('P');
      expect(findCommentTarget(root, { ...thread.root.anchor, blockId: 'deleted' })?.tagName).toBe('SECTION');
      expect(findCommentTarget(root, { ...thread.root.anchor, moduleId: 'missing' })).toBeNull();
    } finally {
      dom.window.close();
    }
  });
});
