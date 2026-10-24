import { describe, expect, it } from 'vitest';
import { editorToInline, inlineToEditor, safeLink } from './inline-codec';
import type { Inline } from '../../core/src/model';

describe('rich inline editing conversion', () => {
  it('AT-09 preserves every supported mark, Chinese text, blank lines and links', () => {
    const inline: Inline = [
      { t: '中文粗体', b: true },
      { t: 'italic', i: true },
      { t: 'code', code: true },
      { t: 'sup', sup: true },
      { t: 'sub', sub: true },
      { br: true },
      { br: true },
      { t: 'link', href: 'https://example.com', b: true },
    ];
    expect(editorToInline(inlineToEditor(inline))).toEqual(inline);
    expect(editorToInline(inlineToEditor([]))).toEqual([]);
  });
  it('AT-09 preserves paragraph boundaries and filters executable pasted links', () => {
    const result = editorToInline({
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Pasted', marks: [{ type: 'hcdLink', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
        { type: 'paragraph' },
      ],
    });
    expect(result).toEqual([{ br: true }, { t: 'Pasted' }, { br: true }]);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,test',
      'https://example.com\n',
      '//example.com',
      'tel:123',
    ])
      expect(safeLink(url)).toBe(false);
    for (const url of ['https://example.com/a', 'http://localhost:3000', 'mailto:hello@example.com'])
      expect(safeLink(url)).toBe(true);
  });
});
