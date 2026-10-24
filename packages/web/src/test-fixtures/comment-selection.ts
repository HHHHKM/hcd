import type { Document as HcdDocument } from '../../../core/src/model';
import { commentSelectionFromDom } from '../comment-selection';

export const model: HcdDocument = {
  schemaVersion: 1,
  id: 'd_aaaaaaaa',
  title: 'Comments',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [
    {
      id: 'm_aaaaaaaa',
      title: 'First',
      blocks: [
        {
          id: 'n_aaaaaaaa',
          type: 'paragraph',
          text: [{ t: 'Hello ', b: true }, { t: '🌍' }, { br: true }, { t: 'world', href: 'https://example.test' }],
        },
        { id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'Other field' }] },
        {
          id: 'n_cccccccc',
          type: 'table',
          caption: '',
          columns: [{ id: 'n_dddddddd', header: [{ t: 'Header' }], align: 'left' }],
          rows: [{ id: 'n_eeeeeeee', cells: { n_dddddddd: [{ t: 'Table cell' }] } }],
        },
        {
          id: 'n_ffffffff',
          type: 'list',
          ordered: false,
          items: [
            {
              id: 'n_gggggggg',
              text: [{ t: 'Parent' }],
              items: [{ id: 'n_hhhhhhhh', text: [{ t: 'Child' }], items: [] }],
            },
          ],
        },
        { id: 'n_iiiiiiii', type: 'raw', asset: 'as_aaaaaaaaaaaa', height: 480, allowScripts: false, note: 'Raw note' },
      ],
    },
    {
      id: 'm_bbbbbbbb',
      title: 'Second',
      blocks: [{ id: 'n_jjjjjjjj', type: 'paragraph', text: [{ t: 'Second module' }] }],
    },
  ],
};
export const html = [
  '<section data-hcd-module-id="m_aaaaaaaa">',
  '<p data-hcd-block-id="n_aaaaaaaa">',
  '<span data-hcd-node-id="n_aaaaaaaa" data-hcd-field="text">',
  '<strong>Hello ',
  '</strong>🌍',
  '<br data-hcd-br="true">',
  '<a href="https://example.test">world',
  '</a>',
  '</span>',
  '</p>',
  '<p>',
  '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field',
  '</span>',
  '</p>',
  '</section>',
  '<section data-hcd-module-id="m_bbbbbbbb">',
  '<span data-hcd-node-id="n_jjjjjjjj" data-hcd-field="text">Second module',
  '</span>',
  '</section>',
].join('');
export function markupInto(root: Element, markup: string) {
  root.replaceChildren(...new DOMParser().parseFromString(markup, 'text/html').body.childNodes);
}
export function fixture(markup = html) {
  const root = document.createElement('div');
  markupInto(root, markup);
  document.body.append(root);
  return root;
}
export function select(start: Node, startOffset: number, end: Node, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}
export function selectNode(node: Node): Selection {
  const range = document.createRange();
  range.selectNode(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}
export const read = (root: HTMLElement, selection = window.getSelection()) =>
  commentSelectionFromDom({ root, selection, document: model, version: 3 });
export const baseInput = {
  document: model,
  version: 3,
  moduleId: 'm_aaaaaaaa',
  nodeId: 'n_aaaaaaaa',
  field: 'text',
  text: 'Hello 🌍\nworld',
  start: 6,
  end: 11,
};
