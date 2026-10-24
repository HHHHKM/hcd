import { describe, expect, it } from 'vitest';
import { canonicalizeDocument, parseSpecDocument, serializeDocument, type Document } from './index';

const doc: Document = {
  schemaVersion: 1,
  id: 'd_aaaaaaaa',
  title: ' Full model ',
  theme: { id: 'default', version: 1, overrides: { accent: '#123abc' } },
  modules: [{ id: 'm_aaaaaaaa', title: ' Overview ', blocks: [
    { id: 'n_aaaaaaaa', type: 'heading', level: 3, text: [{ t: 'Hello', b: true }, { br: true }, { t: 'world', href: 'https://example.test' }] },
    { id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'Paragraph' }] },
    { id: 'n_cccccccc', type: 'list', ordered: true, items: [{ id: 'n_dddddddd', text: [{ t: 'One' }], items: [{ id: 'n_eeeeeeee', text: [{ t: 'Child' }], items: [] }] }] },
    { id: 'n_ffffffff', type: 'quote', text: [{ t: 'Quoted' }] },
    { id: 'n_gggggggg', type: 'callout', tone: 'warn', title: 'Heads up', text: [{ t: 'Careful' }] },
    { id: 'n_hhhhhhhh', type: 'divider' },
    { id: 'n_iiiiiiii', type: 'image', asset: 'as_aaaaaaaaaaaa', alt: 'Alt', caption: 'Caption', width: 'wide' },
    { id: 'n_jjjjjjjj', type: 'table', caption: 'Table', columns: [{ id: 'n_kkkkkkkk', header: [{ t: 'Name' }], align: 'center' }], rows: [{ id: 'n_llllllll', cells: { n_kkkkkkkk: [{ t: 'Ada' }] } }] },
    { id: 'n_mmmmmmmm', type: 'chart', kind: 'line', title: 'Trend', unit: '%', categories: [{ id: 'n_nnnnnnnn', label: 'Q1' }], series: [{ id: 'n_oooooooo', name: 'Users', values: { n_nnnnnnnn: 12.5 } }] },
    { id: 'n_pppppppp', type: 'timeline', items: [{ id: 'n_qqqqqqqq', label: 'Q1', title: 'Start', text: [{ t: 'Begin' }] }, { id: 'n_rrrrrrrr', label: 'Q2', title: 'Ship', text: [] }] },
    { id: 'n_ssssssss', type: 'kpis', items: [{ id: 'n_tttttttt', label: 'DAU', value: '15k', delta: '+12%', tone: 'good' }] },
    { id: 'n_uuuuuuuu', type: 'raw', asset: 'as_bbbbbbbbbbbb', height: 480, allowScripts: false, note: 'Read only' },
    { id: 'n_vvvvvvvv', type: 'columns', ratio: '1:1', cols: [{ id: 'n_wwwwwwww', blocks: [{ id: 'n_xxxxxxxx', type: 'paragraph', text: [{ t: 'Left' }] }] }, { id: 'n_yyyyyyyy', blocks: [{ id: 'n_zzzzzzzz', type: 'paragraph', text: [{ t: 'Right' }] }] }] },
    { id: 'n_22222222', type: 'cards', perRow: 2, items: [{ id: 'n_33333333', title: 'Card A', blocks: [{ id: 'n_44444444', type: 'divider' }] }, { id: 'n_55555555', title: 'Card B', blocks: [] }] },
  ] }],
};

describe('HCD Spec HTML', () => {
  it('AT-13 / AT-43 round trips the canonical model across every block type', () => {
    const html = serializeDocument(doc);
    const parsed = parseSpecDocument(html);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.issues).toEqual([]);
      expect(parsed.value.doc).toEqual(canonicalizeDocument(doc));
    }
  });

  it.each(['custom@brand', '@brand', 'brand@', 'one@two@three', 'd_aaaaaaaa', 'm_aaaaaaaa', 'n_aaaaaaaa'])('AT-13 preserves theme ID %s and its version ' +
                                                                                                           'through HTML', (id) => {
    const source = { ...doc, theme: { ...doc.theme, id, version: 7 } };
    const parsed = parseSpecDocument(serializeDocument(source));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.issues).toEqual([]);
      expect(parsed.value.doc).toEqual(canonicalizeDocument(source));
    }
  });

  it('AT-13 retains default and unversioned theme parsing', () => {
    for (const [attribute, id] of [['', 'default'], ['data-theme="custom"', 'custom']]) {
      const parsed = parseSpecDocument(`<article data-hcd ${attribute}></article>`);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.doc.theme).toEqual({ id, version: 1, overrides: {} });
    }
  });

  it('AT-13 keeps chart data inert and reports malformed chart JSON', () => {
    const parsed = parseSpecDocument('<section data-module><h2 data-role="module-title">M</h2><figure data-block="chart" data-id="n_aaaaaaaa" data-kind="bar"><script type="application/hcd+json">{bad}</script></figure></section>');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.issues).toContainEqual(expect.objectContaining({ code: 'doc.import.chart_json' }));
  });
});
