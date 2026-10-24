import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalizeDocument, createCounterIdSource, validateDocument, type Block, type Document, type Inline, type LeafBlock, type ListItem, type TextRun } from './model';
import { parseSpecDocument, serializeDocument } from './spec-html';

// Short, valid Unicode strings include literal HTML syntax/entities, combining
// characters and multi-code-point emoji. Newlines in inline content use BR runs.
const token = fc.constantFrom('a', 'Z', '0', ' ', '中', '繁體', '🌍', '👩‍💻', 'é', '<&>', '"\'', '&amp;', '</script>');
const text = fc.array(token, { maxLength: 4 }).map(parts => parts.join(''));
const run: fc.Arbitrary<TextRun> = fc.record({
  t: fc.array(token, { minLength: 1, maxLength: 4 }).map(parts => parts.join('')),
  b: fc.boolean(), i: fc.boolean(), code: fc.boolean(), sup: fc.boolean(), sub: fc.boolean(),
  href: fc.option(fc.constantFrom('https://example.test/a?x=1&y=%22#中文', 'http://example.test/path', 'mailto:person+tag@example.test?subject=Hello%20world'), { nil: undefined }),
}).map(({ t, b, i, code, sup, sub, href }) => ({ t, ...(b ? { b: true as const } : {}), ...(i ? { i: true as const } : {}), ...(code ? { code: true as const } : {}), ...(sup ? { sup: true as const } : {}), ...(sub ? { sub: true as const } : {}), ...(href ? { href } : {}) }));
const inline: fc.Arbitrary<Inline> = fc.array(fc.oneof(run, fc.constant({ br: true as const })), { maxLength: 6 });
const asset = fc.constantFrom('as_aaaaaaaaaaaa', 'as_bbbbbbbbbbbb', 'as_234567abcdef');
const blankId = fc.constant('');
const heading = fc.record({ id: blankId, type: fc.constant('heading' as const), level: fc.constantFrom(3 as const, 4 as const), text: inline });
const paragraph = fc.record({ id: blankId, type: fc.constant('paragraph' as const), text: inline });
const quote = fc.record({ id: blankId, type: fc.constant('quote' as const), text: inline });
const childItem = fc.record({ id: blankId, text: inline, items: fc.constant<ListItem[]>([]) });
const list = fc.record({ id: blankId, type: fc.constant('list' as const), ordered: fc.boolean(), items: fc.array(fc.record({ id: blankId, text: inline, items: fc.array(childItem, { maxLength: 2 }) }), { maxLength: 3 }) });
const callout = fc.record({ id: blankId, type: fc.constant('callout' as const), tone: fc.constantFrom('info' as const, 'success' as const, 'warn' as const, 'danger' as const), title: text, text: inline });
const divider = fc.record({ id: blankId, type: fc.constant('divider' as const) });
const image = fc.record({ id: blankId, type: fc.constant('image' as const), asset: fc.option(asset, { nil: null }), alt: text, caption: text, width: fc.constantFrom('small' as const, 'normal' as const, 'wide' as const, 'full' as const) });
const table = fc.record({
  caption: text,
  columns: fc.array(fc.record({ header: inline, align: fc.constantFrom('left' as const, 'center' as const, 'right' as const) }), { maxLength: 3 }),
}).chain(({ caption, columns }) => fc.array(fc.array(fc.option(inline, { nil: undefined }), { minLength: columns.length, maxLength: columns.length }), { maxLength: 3 }).map(rows => ({
  id: '', type: 'table' as const, caption,
  columns: columns.map((column, index) => ({ ...column, id: `column_${index}` })),
  rows: rows.map(cells => ({ id: '', cells: Object.fromEntries(cells.flatMap((value, index) => value === undefined ? [] : [[`column_${index}`, value]])) })),
})));
const chart = fc.record({ kind: fc.constantFrom('bar' as const, 'line' as const, 'pie' as const), title: text, unit: text, categories: fc.array(text, { maxLength: 3 }) }).chain(({ kind, title, unit, categories }) => fc.array(fc.record({
  name: text,
  values: fc.array(fc.option(fc.oneof(fc.constant(0), fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }).map(value => value / 100)), { nil: null }), { minLength: categories.length, maxLength: categories.length }),
}), { maxLength: kind === 'pie' ? 1 : 3 }).map(series => ({
  id: '', type: 'chart' as const, kind, title, unit,
  categories: categories.map((label, index) => ({ id: `category_${index}`, label })),
  series: series.map(item => ({ id: '', name: item.name, values: Object.fromEntries(item.values.map((value, index) => [`category_${index}`, value])) })),
})));
const timeline = fc.record({ id: blankId, type: fc.constant('timeline' as const), items: fc.array(fc.record({ id: blankId, label: text, title: text, text: inline }), { minLength: 2, maxLength: 4 }) });
const kpis = fc.record({ id: blankId, type: fc.constant('kpis' as const), items: fc.array(fc.record({ id: blankId, label: text, value: text, delta: text, tone: fc.constantFrom('neutral' as const, 'good' as const, 'bad' as const) }), { minLength: 1, maxLength: 4 }) });
const raw = fc.record({ id: blankId, type: fc.constant('raw' as const), asset, height: fc.integer({ min: 80, max: 4000 }), allowScripts: fc.boolean(), note: text });
const leaves: fc.Arbitrary<LeafBlock> = fc.oneof(heading, paragraph, list, quote, callout, divider, image, table, chart, timeline, kpis, raw);
const columns = fc.constantFrom('1:1' as const, '1:2' as const, '2:1' as const, '1:1:1' as const).chain(ratio => fc.array(fc.record({ id: blankId, blocks: fc.array(leaves, { maxLength: 2 }) }), { minLength: ratio === '1:1:1' ? 3 : 2, maxLength: ratio === '1:1:1' ? 3 : 2 }).map(cols => ({ id: '', type: 'columns' as const, ratio, cols })));
const cards = fc.record({ id: blankId, type: fc.constant('cards' as const), perRow: fc.constantFrom(2 as const, 3 as const, 4 as const), items: fc.array(fc.record({ id: blankId, title: text, blocks: fc.array(leaves, { maxLength: 2 }) }), { minLength: 2, maxLength: 4 }) });
const blockTypes = ['heading', 'paragraph', 'list', 'quote', 'callout', 'divider', 'image', 'table', 'chart', 'timeline', 'kpis', 'raw', 'columns', 'cards'] as const;

// Allocate after generation: each list/table/chart/container owns new identities,
// and every table cell/chart value points to its own generated column/category.
function identifyBlocks(blocks: Block[], next: () => string): Block[] {
  const items = (values: ListItem[]): ListItem[] => values.map(item => ({ ...item, id: next(), items: items(item.items) }));
  const leaf = (block: LeafBlock): LeafBlock => {
    const id = next();
    switch (block.type) {
      case 'list': return { ...block, id, items: items(block.items) };
      case 'table': {
        const columns = block.columns.map(column => ({ ...column, id: next() }));
        const remap = new Map(block.columns.map((column, index) => [column.id, columns[index]!.id]));
        return { ...block, id, columns, rows: block.rows.map(row => ({ id: next(), cells: Object.fromEntries(Object.entries(row.cells).map(([key, value]) => [remap.get(key)!, value])) })) };
      }
      case 'chart': {
        const categories = block.categories.map(category => ({ ...category, id: next() }));
        const remap = new Map(block.categories.map((category, index) => [category.id, categories[index]!.id]));
        return { ...block, id, categories, series: block.series.map(series => ({ ...series, id: next(), values: Object.fromEntries(Object.entries(series.values).map(([key, value]) => [remap.get(key)!, value])) })) };
      }
      case 'timeline': return { ...block, id, items: block.items.map(item => ({ ...item, id: next() })) };
      case 'kpis': return { ...block, id, items: block.items.map(item => ({ ...item, id: next() })) };
      default: return { ...block, id };
    }
  };
  return blocks.map(block => {
    if (block.type === 'columns') return { ...block, id: next(), cols: block.cols.map(column => ({ ...column, id: next(), blocks: column.blocks.map(leaf) })) };
    if (block.type === 'cards') return { ...block, id: next(), items: block.items.map(card => ({ ...card, id: next(), blocks: card.blocks.map(leaf) })) };
    return leaf(block);
  });
}

const document = fc.record({
  title: text, moduleTitles: fc.tuple(text, text),
  theme: fc.record({ id: fc.constantFrom('default', 'report', '主题<&>"', 'custom@brand'), version: fc.integer({ min: 1, max: 100 }), overrides: fc.option(fc.constantFrom('#aB1234', '#000000', '#ffffff'), { nil: undefined }).map(accent => accent ? { accent } : {}) }),
  themeIdentity: fc.constantFrom('separate' as const, 'document' as const, 'module' as const, 'node' as const),
  blocks: fc.tuple(heading, paragraph, list, quote, callout, divider, image, table, chart, timeline, kpis, raw, columns, cards),
  order: fc.shuffledSubarray(Array.from({ length: blockTypes.length }, (_, index) => index), { minLength: blockTypes.length, maxLength: blockTypes.length }),
  split: fc.integer({ min: 0, max: blockTypes.length }),
}).map(({ title, moduleTitles, theme, themeIdentity, blocks, order, split }): Document => {
  const ids = createCounterIdSource(); const id = ids.next('d');
  const identified = identifyBlocks(order.map(index => blocks[index]!), () => ids.next('n'));
  const modules = moduleTitles.map((moduleTitle, index) => ({ id: ids.next('m'), title: moduleTitle, blocks: index === 0 ? identified.slice(0, split) : identified.slice(split) }));
  // Theme names are metadata, not content IDs. Intentionally reuse an allocated
  // identity so parsing cannot accidentally delete the theme or a content node.
  const themeId = themeIdentity === 'document' ? id : themeIdentity === 'module' ? modules[0]!.id : themeIdentity === 'node' ? identified[0]!.id : theme.id;
  return canonicalizeDocument({ schemaVersion: 1, id, title, theme: { ...theme, id: themeId }, modules });
});

describe('Spec HTML property acceptance', () => {
  it('AT-13 round trips valid random documents containing every block type without changing their source', () => {
    const themeCollisions = new Set<string>();
    fc.assert(fc.property(document, source => {
      expect(source.modules.flatMap(module => module.blocks.map(block => block.type)).sort()).toEqual([...blockTypes].sort());
      if (source.theme.id === source.id) themeCollisions.add('document');
      if (source.modules.some(module => module.id === source.theme.id)) themeCollisions.add('module');
      if (source.modules.some(module => module.blocks.some(block => block.id === source.theme.id))) themeCollisions.add('node');
      const validation = validateDocument(source); expect(validation.ok, JSON.stringify(validation)).toBe(true);
      const before = structuredClone(source);
      const parsed = parseSpecDocument(serializeDocument(source));
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.issues).toEqual([]);
      expect(validateDocument(parsed.value.doc).ok).toBe(true);
      expect(canonicalizeDocument(parsed.value.doc as Document)).toEqual(source);
      expect(source).toEqual(before);
    }), { numRuns: 120, seed: 2026102313 });
    expect([...themeCollisions].sort()).toEqual(['document', 'module', 'node']);
  });
});
