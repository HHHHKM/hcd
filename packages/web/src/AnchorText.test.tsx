import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { anchorText } from '../../core/src/anchors';
import {
  createCounterIdSource,
  plainText,
  type Block,
  type Inline,
  type ListBlock,
  type TableBlock,
  type ChartBlock,
  type ImageBlock,
} from '../../core/src/model';
import { ChartRead } from '../../render/src/Chart';
import { ActiveTextAnchorContext, AnchorText, anchorHighlightRange, type ActiveTextAnchor } from './AnchorText';
import BlockRead, { RenderInline } from './BlockRead';
import { createBlock } from './editor-model';
import { DocumentAssetContext, DocumentImage, DocumentRaw } from './DocumentAssets';

type HtmlNode = {
  tagName?: string;
  nodeName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};
const attribute = (node: HtmlNode, name: string) => node.attrs?.find((item) => item.name === name)?.value;
function find(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  return [...(predicate(root) ? [root] : []), ...(root.childNodes ?? []).flatMap((child) => find(child, predicate))];
}
function text(root: HtmlNode): string {
  return root.tagName === 'br'
    ? '\n'
    : root.nodeName === '#text'
      ? (root.value ?? '')
      : (root.childNodes ?? []).map(text).join('');
}
const tree = (html: string) => parseFragment(html) as unknown as HtmlNode;
const marked = (html: string) =>
  find(tree(html), (node) => node.tagName === 'mark')
    .map(text)
    .join('');
const fields = (html: string) => find(tree(html), (node) => Boolean(attribute(node, 'data-hcd-field')));
const render = (value: Inline | string, active: ActiveTextAnchor | null, field = 'text') =>
  renderToStaticMarkup(
    <ActiveTextAnchorContext.Provider value={active}>
      <AnchorText nodeId="n_aaaaaaaa" field={field} value={value} />
    </ActiveTextAnchorContext.Provider>,
  );
const active = (start: number, end: number, quote: string): ActiveTextAnchor => ({
  blockId: 'n_aaaaaaaa',
  field: 'text',
  range: { start, end },
  quote,
});
function nodes(value: unknown, result = new Map<string, Record<string, unknown>>()) {
  if (Array.isArray(value)) value.forEach((child) => nodes(child, result));
  else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (typeof node.id === 'string') result.set(node.id, node);
    Object.values(node).forEach((child) => nodes(child, result));
  }
  return result;
}

describe('anchored text rendering', () => {
  it('preserves exact spaces, UTF-16 text and line breaks across all inline formats', () => {
    const inline: Inline = [
      { t: '  A🌍', b: true },
      { t: 'B', i: true, href: 'https://example.com/a' },
      { br: true },
      { t: 'C  D', code: true, sup: true, sub: true },
    ];
    const quote = '🌍B\nC';
    const range = active(3, 8, quote);
    const html = render(inline, range);
    expect(marked(html)).toBe(quote);
    expect(text(fields(html)[0]!)).toBe(plainText(inline));
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<code>');
    expect(html).toContain('<sup>');
    expect(html).toContain('<sub>');
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('<br data-hcd-br="true"/>');
  });

  it('uses the selected occurrence and preserves literal markup as escaped text', () => {
    const value = '<script>echo</script> echo';
    const start = value.lastIndexOf('echo');
    const html = render(value, active(start, value.length, 'echo'));
    expect(marked(html)).toBe('echo');
    expect(find(tree(html), (node) => node.tagName === 'mark')).toHaveLength(1);
    expect(html).toContain('&lt;script&gt;echo&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(text(fields(html)[0]!)).toBe(value);
  });

  it('does not highlight stale quotes, different fields/nodes or invalid boundaries', () => {
    const value = 'A🌍B';
    const invalid: ActiveTextAnchor[] = [
      active(-1, 2, 'A'),
      active(2, 1, ''),
      active(0, 99, value),
      active(0.5, 1, 'A'),
      active(0, NaN, 'A'),
      active(1, 3, 'wrong'),
      active(1, 2, value.slice(1, 2)),
      active(2, 3, value.slice(2, 3)),
      { ...active(1, 3, '🌍'), blockId: 'n_other' },
      { ...active(1, 3, '🌍'), field: 'title' },
    ];
    for (const selection of invalid) {
      expect(anchorHighlightRange(selection, 'n_aaaaaaaa', 'text', value)).toBeNull();
      expect(render(value, selection)).not.toContain('<mark');
    }
    expect(render(value, null)).not.toContain('<mark');
    expect(marked(render(value, { blockId: 'n_aaaaaaaa', range: { start: 1, end: 3 }, quote: '🌍' }))).toBe('🌍');
  });

  it('retains safe link behavior and keeps ordinary RenderInline output unchanged', () => {
    const inline: Inline = [
      { t: 'unsafe', href: 'javascript:steal()' },
      { t: ' safe', href: 'mailto:team@example.com' },
      { br: true },
      { t: 'end' },
    ];
    const html = render(inline, active(0, 6, 'unsafe'));
    expect(marked(html)).toBe('unsafe');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="mailto:team@example.com"');
    const ordinary = renderToStaticMarkup(<RenderInline inline={inline} links={false} />);
    expect(ordinary).toContain('<br/>');
    expect(ordinary).not.toContain('<a');
    expect(ordinary).not.toContain('data-hcd-');
    expect(text(tree(ordinary))).toBe(plainText(inline));
  });

  it('anchors a list item separately from its descendants and locates both wrappers', () => {
    const block: ListBlock = {
      id: 'n_listaaaa',
      type: 'list',
      ordered: true,
      items: [
        { id: 'n_aaaaaaaa', text: [{ t: 'Parent' }], items: [{ id: 'n_childaaa', text: [{ t: 'Child' }], items: [] }] },
      ],
    };
    const html = renderToStaticMarkup(
      <ActiveTextAnchorContext.Provider value={active(0, 6, 'Parent')}>
        <BlockRead block={block} locale="en" />
      </ActiveTextAnchorContext.Provider>,
    );
    expect(fields(html).map((node) => [attribute(node, 'data-hcd-node-id'), text(node)])).toEqual([
      ['n_aaaaaaaa', 'Parent'],
      ['n_childaaa', 'Child'],
    ]);
    expect(marked(html)).toBe('Parent');
    expect(html).toContain('<ol class="document-list" data-hcd-block-id="n_listaaaa">');
    expect(html).toContain('<li data-hcd-block-id="n_childaaa">');
  });

  it('uses row identity plus cell column key and column identity plus header field', () => {
    const block = createBlock('table', createCounterIdSource(), 'en') as TableBlock;
    block.rows[0]!.cells[block.columns[0]!.id] = [
      { t: 'Cell ', b: true },
      { t: '🌍', i: true },
    ];
    const id = block.rows[0]!.id;
    const field = `cell:${block.columns[0]!.id}`;
    const html = renderToStaticMarkup(
      <ActiveTextAnchorContext.Provider value={{ blockId: id, field, range: { start: 5, end: 7 }, quote: '🌍' }}>
        <BlockRead block={block} locale="en" />
      </ActiveTextAnchorContext.Provider>,
    );
    expect(marked(html)).toBe('🌍');
    expect(
      fields(html).some(
        (node) =>
          attribute(node, 'data-hcd-node-id') === id &&
          attribute(node, 'data-hcd-field') === field &&
          text(node) === 'Cell 🌍',
      ),
    ).toBe(true);
    expect(
      fields(html).some(
        (node) =>
          attribute(node, 'data-hcd-node-id') === block.columns[0]!.id &&
          attribute(node, 'data-hcd-field') === 'header',
      ),
    ).toBe(true);
    expect(html).toContain(`data-hcd-block-id="${id}"`);
  });

  it('makes every emitted field exactly match core anchorText across block types', () => {
    const ids = createCounterIdSource();
    let count = 0;
    const types: Block['type'][] = [
      'paragraph',
      'heading',
      'quote',
      'list',
      'callout',
      'table',
      'chart',
      'kpis',
      'timeline',
      'columns',
      'cards',
      'image',
      'raw',
      'divider',
    ];
    for (const type of types) {
      const block: Block =
        type === 'raw'
          ? { id: ids.next('n'), type: 'raw', asset: 'a_aaaaaaaa', height: 200, allowScripts: false, note: 'Raw note' }
          : createBlock(type, ids, 'en');
      if (block.type === 'image') {
        block.alt = 'Alt text';
        block.caption = 'Image caption';
      }
      if (block.type === 'table') block.caption = 'Table caption';
      if (block.type === 'chart') block.title = 'Chart title';
      const index = nodes(block);
      const html = renderToStaticMarkup(<BlockRead block={block} locale="en" />);
      expect(attribute(tree(html).childNodes![0]!, 'data-hcd-block-id')).toBe(block.id);
      for (const element of fields(html)) {
        const nodeId = attribute(element, 'data-hcd-node-id')!;
        const field = attribute(element, 'data-hcd-field')!;
        expect(index.has(nodeId), `${type}/${nodeId}/${field}`).toBe(true);
        expect(text(element), `${type}/${nodeId}/${field}`).toBe(anchorText(index.get(nodeId)!, field));
        count++;
      }
      expect(html).not.toContain('<mark');
    }
    expect(count).toBeGreaterThan(30);
  });

  it('anchors full chart HTML labels while leaving truncated SVG and unsupported unit text unmarked', () => {
    const block = createBlock('chart', createCounterIdSource(), 'en') as ChartBlock;
    block.title = 'Title';
    block.categories[0]!.label = 'Long category label beyond SVG width';
    block.unit = 'kg';
    const category = block.categories[0]!;
    const selection = {
      blockId: category.id,
      field: 'label',
      range: { start: 0, end: category.label.length },
      quote: category.label,
    };
    const html = renderToStaticMarkup(
      <ActiveTextAnchorContext.Provider value={selection}>
        <BlockRead block={block} locale="en" />
      </ActiveTextAnchorContext.Provider>,
    );
    expect(marked(html)).toBe(category.label);
    const svg = find(tree(html), (node) => node.tagName === 'svg')[0]!;
    expect(find(svg, (node) => Boolean(attribute(node, 'data-hcd-field')))).toEqual([]);
    expect(fields(html).map((node) => attribute(node, 'data-hcd-field'))).not.toContain('unit');
    expect(html).toContain(category.label.slice(0, 11) + '…');
    const standalone = renderToStaticMarkup(<ChartRead block={block} locale="en" />);
    expect(standalone).not.toContain('data-hcd-');
    expect(standalone).not.toContain('<mark');
  });

  it('anchors only visible image text and leaves generic placeholders and raw notes without invented fields', () => {
    const block: ImageBlock = {
      id: 'n_aaaaaaaa',
      type: 'image',
      asset: null,
      alt: 'Visible alt',
      caption: 'Visible caption',
      width: 'normal',
    };
    const html = renderToStaticMarkup(
      <ActiveTextAnchorContext.Provider value={{ ...active(0, 7, 'Visible'), field: 'alt' }}>
        <BlockRead block={block} locale="en" />
      </ActiveTextAnchorContext.Provider>,
    );
    expect(marked(html)).toBe('Visible');
    expect(fields(html).map((node) => attribute(node, 'data-hcd-field'))).toEqual(['alt', 'caption']);
    const loaded = renderToStaticMarkup(
      <DocumentAssetContext.Provider value={{ docId: 'd_aaaaaaaa' }}>
        <BlockRead block={{ ...block, asset: 'a_aaaaaaaa' }} locale="en" />
      </DocumentAssetContext.Provider>,
    );
    expect(fields(loaded).map((node) => attribute(node, 'data-hcd-field'))).toEqual(['caption']);
    const empty = renderToStaticMarkup(<BlockRead block={{ ...block, alt: '', caption: '' }} locale="en" />);
    expect(fields(empty)).toEqual([]);
    expect(empty).toContain('No image');
    const raw = renderToStaticMarkup(
      <BlockRead
        block={{
          id: 'n_aaaaaaaa',
          type: 'raw',
          asset: 'a_aaaaaaaa',
          height: 200,
          allowScripts: false,
          note: 'Raw note',
        }}
        locale="en"
      />,
    );
    expect(raw).toContain('data-hcd-block-id="n_aaaaaaaa"');
    expect(raw).toContain('Raw note');
    expect(fields(raw)).toEqual([]);
    expect(renderToStaticMarkup(<DocumentImage {...block} locale="en" />)).not.toContain('data-hcd-');
    expect(renderToStaticMarkup(<DocumentRaw asset="a_aaaaaaaa" note="Note" height={200} locale="en" />)).not.toContain(
      'data-hcd-',
    );
  });
});
