import { describe, expect, it } from 'vitest';
import { canonicalizeDocument, createCounterIdSource, type ChartBlock, type Document, type Module, type TableBlock } from '../../core/src/model';
import { serializeModule } from '../../core/src/spec-html';
import { applyOpsStrict } from '../../core/src/ops';
import { materializeSubmission, parseSubmissionInput } from '../../server/src/submission-input';
import { prepareSubmissionPlan, type SubmissionPlan, type LocalSource } from './submission-plan';

const base: Document = { schemaVersion: 1, id: 'd_zzzzzzzz', title: 'Plan', theme: { id: 'default', version: 1, overrides: {} }, modules: [
  { id: 'm_xxxxxxxx', title: 'Main', blocks: [{ id: 'n_xxxxxxxx', type: 'paragraph', text: [{ t: 'abcdefghij' }] }, { id: 'n_yyyyyyyy', type: 'paragraph', text: [{ t: 'another paragraph' }] }] },
  { id: 'm_yyyyyyyy', title: 'Other', blocks: [] },
  { id: 'm_zzzzzzzz', title: 'Delete me', blocks: [] },
] };
const inventory = base.modules.map((module, i) => ({ id: module.id, name: `${i + 1}-${module.title}.html` }));
const sources = (document = base): LocalSource[] => document.modules.map((module, index) => ({ name: inventory.find(file => file.id === module.id)?.name ?? `${index + 1}-New.html`, html: serializeModule(module) }));
const plan = (sourceSnapshot = sources(), document = base) => prepareSubmissionPlan({ base: document, sourceSnapshot, files: inventory });
const oracle = (prepared: SubmissionPlan, document = base) => {
  if (!prepared.input) throw new Error(prepared.submissionError);
  return materializeSubmission(document, parseSubmissionInput({ baseVersion: 1, message: 'test', ...prepared.input }), createCounterIdSource());
};
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, child]) => [key, key === 'cells' || key === 'values' ? Object.values(child as Record<string, unknown>).map(comparable) : comparable(child)]));
}

describe('native CLI submission planning', () => {
  it('AT-28 returns an unchanged plan without writes or randomized identities', () => {
    const snapshot = sources(); const frozen = structuredClone({ base, snapshot });
    const result = plan(snapshot); expect(result.input).toEqual({ ops: [] }); expect(result.document).toEqual(base); expect(result.opCount).toBe(0);
    expect(result.status).toEqual({ added: [], modified: [], deleted: [], moved: [], renamed: [], warnings: [] });
    expect({ base, snapshot }).toEqual(frozen); expect(plan(snapshot)).toEqual(result);
  });

  it('AT-28 submits additions, edits, deletions and existing-module reorder as one native ' +
     'operation request', () => {
    const target = structuredClone(base); target.modules = [target.modules[1]!, target.modules[0]!]; target.modules[1]!.title = 'Updated';
    target.modules[1]!.blocks.push({ id: 'n_wwwwwwww', type: 'paragraph', text: [{ t: 'brand new content' }] });
    target.modules.push({ id: 'm_vvvvvvvv', title: 'New module', blocks: [] });
    const snapshot = sources(target); snapshot[0]!.name = '0-Renamed.html';
    const result = plan(snapshot); expect(result.input && 'ops' in result.input).toBe(true);
    expect(result.input && 'ops' in result.input && result.input.ops.some(op => op.uncertain)).toBe(false);
    expect(new Set(result.operations.map(op => op.op))).toEqual(new Set(['move', 'set', 'insert', 'delete']));
    expect(result.status).toMatchObject({ added: ['3-New.html'], deleted: ['3-Delete me.html'], renamed: ['0-Renamed.html'], moved: ['0-Renamed.html', '1-Main.html'], modified: ['1-Main.html'] });
    const actual = oracle(result); expect(comparable(actual.content)).toEqual(comparable(target)); expect(actual.ops).toHaveLength(result.opCount);
    expect(JSON.stringify(result.input)).toContain('tmp_cli_'); expect(JSON.stringify(result.document)).not.toContain('tmp_');
  });

  it('AT-28 recovers a missing block ID with high confidence before allocating any new identities', () => {
    const snapshot = sources(); snapshot[0]!.html = snapshot[0]!.html.replace('data-id="n_xxxxxxxx"', '').replace('abcdefghij', 'abcdefghik');
    const result = plan(snapshot); expect(result.uncertainIds).toEqual([]); expect(result.document.modules[0]!.blocks[0]!.id).toBe('n_xxxxxxxx');
    expect(result.input).toEqual({ ops: [{ op: 'set', at: { id: 'n_xxxxxxxx', field: 'text' }, before: [{ t: 'abcdefghij' }], after: [{ t: 'abcdefghik' }] }] });
    expect(oracle(result).content).toEqual(result.document);
  });

  it('AT-28 uses the known filename when only a module ID is missing and recognizes a rename by ' +
     'explicit ID', () => {
    const snapshot = sources(); snapshot[0]!.html = snapshot[0]!.html.replace('data-id="m_xxxxxxxx"', '').replace('abcdefghij', 'updated text'); snapshot[1]!.name = '2-Renamed.html';
    const result = plan(snapshot); expect(result.document.modules[0]!.id).toBe('m_xxxxxxxx'); expect(result.status.renamed).toEqual(['2-Renamed.html']);
    expect(result.files).toEqual([{ name: '1-Main.html', moduleId: 'm_xxxxxxxx' }, { name: '2-Renamed.html', moduleId: 'm_yyyyyyyy' }, { name: '3-Delete me.html', moduleId: 'm_zzzzzzzz' }]);
    expect(oracle(result).content).toEqual(result.document);
  });

  it('AT-28 sends original HTML for weak matching together with explicit deletions and new modules ' +
     'in source order', () => {
    const snapshot = sources().slice(0, 2); snapshot[0]!.html = snapshot[0]!.html.replace('data-id="n_xxxxxxxx"', '').replace('abcdefghij', 'abcdezzzzz');
    const fresh = (name: string): LocalSource => ({ name, html: `<section data-module><h2 data-role="module-title">${name}</h2><p>Completely new ${name}</p></section>` });
    snapshot.splice(1, 0, fresh('new-one.html'), fresh('new-two.html'));
    const result = plan(snapshot); expect(result.uncertainIds).toContain('n_xxxxxxxx');
    expect(result.input && 'moduleHtml' in result.input ? result.input : null).toEqual({ moduleHtml: [
      { moduleId: 'm_xxxxxxxx', html: snapshot[0]!.html },
      { html: snapshot[1]!.html, after: 'm_xxxxxxxx' }, { html: snapshot[2]!.html, after: 'm_xxxxxxxx' },
    ], deleteModules: ['m_zzzzzzzz'] });
    const actual = oracle(result); expect(actual.uncertain).toContain('n_xxxxxxxx'); expect(actual.ops.some(op => op.uncertain)).toBe(true);
    expect(comparable(actual.content)).toEqual(comparable(result.document));
  });

  it('AT-28 anchors new leading modules at null without changing surviving old module order', () => {
    const snapshot = sources(); snapshot[0]!.html = snapshot[0]!.html.replace('data-id="n_xxxxxxxx"', '').replace('abcdefghij', 'abcdezzzzz');
    snapshot.unshift({ name: '0-new.html', html: '<section data-module><h2 data-role="module-title">Fresh</h2><p>Zebra rocket universe</p></section>' });
    const result = plan(snapshot); expect(result.input && 'moduleHtml' in result.input && result.input.moduleHtml[0]!.after).toBeNull();
    expect(comparable(oracle(result).content)).toEqual(comparable(result.document));
  });

  it('AT-28 keeps an inspectable plan but blocks weak matches combined with existing-module ' +
     'reorder', () => {
    const snapshot = sources(); snapshot[0]!.html = snapshot[0]!.html.replace('data-id="n_xxxxxxxx"', '').replace('abcdefghij', 'abcdezzzzz');
    [snapshot[0], snapshot[1]] = [snapshot[1]!, snapshot[0]!];
    const result = plan(snapshot); expect(result.input).toBeNull(); expect(result.submissionError).toContain('reordering');
    expect(result.document.modules[1]!.blocks[0]).toMatchObject({ id: 'n_xxxxxxxx', text: [{ t: 'abcdezzzzz' }] }); expect(result.operations.some(op => op.op === 'move')).toBe(true);
  });

  it('AT-28 supports explicit cross-module moves natively, but blocks mixed weak matches without ' +
     'splitting requests', () => {
    const target = structuredClone(base); target.modules[1]!.blocks.push(target.modules[0]!.blocks.pop()!);
    const certain = plan(sources(target)); expect(certain.input && 'ops' in certain.input).toBe(true); expect(oracle(certain).content).toEqual(target);
    const snapshot = sources(target); snapshot[0]!.html = snapshot[0]!.html.replace('data-id="n_xxxxxxxx"', '').replace('abcdefghij', 'abcdezzzzz');
    const uncertain = plan(snapshot); expect(uncertain.input).toBeNull(); expect(uncertain.submissionError).toContain('cross-module'); expect(uncertain.document.modules[1]!.blocks).toEqual(target.modules[1]!.blocks);
  });

  it('AT-28 does not turn a weak module root match into a certain moduleHtml target', () => {
    const source: Document = { ...base, modules: [{ id: 'm_xxxxxxxx', title: 'abcdefghij', blocks: [] }] };
    const result = prepareSubmissionPlan({ base: source, sourceSnapshot: [{ name: 'renamed.html', html: '<section data-module><h2 data-role="module-title">abcdezzzzz</h2></section>' }] });
    expect(result.uncertainIds).toEqual(['m_xxxxxxxx']); expect(result.input).toBeNull(); expect(result.submissionError).toContain('Uncertain module identity');
  });

  it('AT-28 preserves nested tables, charts, links, list items and coupled references with new IDs', () => {
    const table: TableBlock = { id: 'n_kkkkkkkk', type: 'table', caption: 'Table', columns: [{ id: 'n_llllllll', header: [{ t: 'Name' }], align: 'left' }], rows: [{ id: 'n_mmmmmmmm', cells: { n_llllllll: [{ t: 'Link', href: 'https://example.test/' }] } }] };
    const chart: ChartBlock = { id: 'n_nnnnnnnn', type: 'chart', kind: 'bar', title: 'Chart', unit: '%', categories: [{ id: 'n_oooooooo', label: 'First' }], series: [{ id: 'n_pppppppp', name: 'Series', values: { n_oooooooo: 0 } }] };
    const fresh: Module = { id: 'm_qqqqqqqq', title: 'Complex', blocks: [{ id: 'n_rrrrrrrr', type: 'cards', perRow: 2, items: [{ id: 'n_ssssssss', title: 'Data', blocks: [table, chart] }, { id: 'n_tttttttt', title: 'Notes', blocks: [{ id: 'n_uuuuuuuu', type: 'list', ordered: false, items: [{ id: 'n_vvvvvvvv', text: [{ t: 'A', b: true }], items: [{ id: 'n_wwwwwwww', text: [{ t: 'Nested' }], items: [] }] }] }] }] }] };
    const result = plan([...sources(), { name: '4-Complex.html', html: serializeModule(fresh) }]);
    expect(result.input && 'ops' in result.input).toBe(true); expect(comparable(oracle(result).content)).toEqual(comparable(result.document));
    expect(comparable(result.document.modules.at(-1))).toEqual(comparable(fresh));
    const again = plan([...sources(), { name: '4-Complex.html', html: serializeModule(fresh) }]); expect(again).toEqual(result);
  });

  it('AT-28 accepts unchanged and edited serialized documents containing every supported block ' +
     'type', () => {
    const document = canonicalizeDocument({ ...base, modules: [{ id: 'm_aaaaaaaa', title: 'Full model', blocks: [
      { id: 'n_aaaaaaaa', type: 'heading', level: 3, text: [{ t: 'Hello', b: true, i: true, code: true, sup: true, href: 'https://example.test' }, { br: true }, { t: 'world', sub: true }] },
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
    ] }] } as Document);
    const snapshot = [{ name: 'full.html', html: serializeModule(document.modules[0]!) }];
    const unchanged = prepareSubmissionPlan({ base: document, sourceSnapshot: snapshot });
    expect(unchanged.input).toEqual({ ops: [] }); expect(unchanged.document).toEqual(document);
    const target = structuredClone(document); const blocks = target.modules[0]!.blocks;
    const raw = blocks.find(block => block.type === 'raw')!; if (raw.type !== 'raw') throw new Error('Expected raw');
    raw.height = 720; raw.allowScripts = true; raw.note = 'Updated raw metadata';
    const table = blocks.find(block => block.type === 'table')!; if (table.type !== 'table') throw new Error('Expected table');
    table.columns.push({ id: 'n_66666666', header: [{ t: 'Score' }], align: 'right' }); table.rows[0]!.cells.n_66666666 = [{ t: '42' }];
    const chart = blocks.find(block => block.type === 'chart')!; if (chart.type !== 'chart') throw new Error('Expected chart');
    chart.categories.push({ id: 'n_77777777', label: 'Q2' }); chart.series[0]!.values.n_77777777 = 0;
    const changed = prepareSubmissionPlan({ base: document, sourceSnapshot: [{ name: 'full.html', html: serializeModule(target.modules[0]!) }] });
    expect(changed.input && 'ops' in changed.input).toBe(true); expect(changed.uncertainIds).toEqual([]);
    expect(comparable(changed.document)).toEqual(comparable(target));
    expect(comparable(oracle(changed, document).content)).toEqual(comparable(target));
  });

  it('AT-28 rejects duplicate IDs, multiple roots and content the parser would otherwise discard', () => {
    const original = sources()[0]!;
    expect(() => plan([original, { ...original, name: 'copy.html' }])).toThrow('Duplicate ID');
    expect(() => plan([
      { name: 'first.html', html: '<section data-module data-id="m_xxxxxxxx"><p data-id="n_xxxxxxxx">First</p></section>' },
      { name: 'copy.html', html: '<section data-module data-id="m_yyyyyyyy"><p data-id="n_xxxxxxxx">Copy</p></section>' },
    ])).toThrow('Duplicate ID');
    expect(() => plan([{ ...original, html: original.html + original.html }])).toThrow('exactly one');
    const bad = [
      original.html.replace('</section>', '<button>Lost text</button></section>'),
      original.html.replace('<p ', '<p style="color:red" '),
      original.html.replace('<p ', '<p onload="alert(1)" '),
      original.html.replace('</section>', '<script>alert(1)</script></section>'),
      original.html.replace('abcdefghij', '<span data-custom="lost">abcdefghij</span>'),
      original.html.replace('</section>', '<section data-module><p>Hidden module</p></section></section>'),
      original.html.replace('<h2 data-role="module-title">Main</h2>', '<h2 data-role="module-title">Main</h2><h2 data-role="module-title">Silently discarded</h2>'),
    ];
    for (const html of bad) expect(() => plan([{ name: original.name, html }])).toThrow();
    const cells = '<section data-module><h2 data-role="module-title">Table</h2><table><caption></caption><thead><tr><th data-align="left">A</th></tr></thead><tbody><tr><td>Keep</td><td>Would be lost</td></tr></tbody></table></section>';
    expect(() => plan([{ name: 'new.html', html: cells }])).toThrow('lossy');
  });

  it('AT-28 rejects duplicate or malformed chart payloads instead of silently accepting a subset', () => {
    const data = { title: 'Chart', unit: '', categories: [{ id: 'n_oooooooo', label: 'One' }], series: [{ id: 'n_pppppppp', name: 'Series', values: [1] }] };
    const html = (payload: unknown, extra = '') => `<section data-module><h2 data-role="module-title">Chart</h2><figure data-block="chart" data-kind="bar"><script type="application/hcd+json">${JSON.stringify(payload)}</script>${extra}</figure></section>`;
    expect(() => plan([{ name: 'new.html', html: html(data, '<script type="application/hcd+json">{}</script>') }])).toThrow();
    expect(() => plan([{ name: 'new.html', html: html({ ...data, ignored: 'lost' }) }])).toThrow('lossy');
    expect(() => plan([{ name: 'new.html', html: html({ ...data, series: [{ ...data.series[0], values: [1, 2] }] }) }])).toThrow('lossy');
    expect(() => plan([{ name: 'new.html', html: html(data).replace('"values":[1]', '"values":[1e999]') }])).toThrow('Invalid chart data');
  });

  it('AT-28 bounds operation count and rejects invalid resulting structures before network ' +
     'submission', () => {
    const module = structuredClone(base.modules[0]!); module.blocks = Array.from({ length: 501 }, (_, i) => ({ id: `n_${i.toString(32).replace(/[0-9a-v]/g, c => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(c, 32)]!).padStart(8, 'a')}`, type: 'paragraph', text: [{ t: `New ${i}` }] }));
    expect(() => plan([{ name: inventory[0]!.name, html: serializeModule(module) }])).toThrow('TOO_MANY_OPERATIONS');
    const malformed = '<section data-module><h2 data-role="module-title">Cards</h2><div data-block="cards" data-per-row="2"><div data-card><p data-role="card-title">Only one</p></div></div></section>';
    expect(() => plan([{ name: 'new.html', html: malformed }])).toThrow('cannot be applied safely');
  });

  it('AT-28 generated native operations strictly replay with an independent allocator', () => {
    const snapshot = sources(); snapshot[0]!.html = snapshot[0]!.html.replace('</section>', '<p>Completely additional paragraph</p></section>');
    const result = plan(snapshot); if (!result.input || !('ops' in result.input)) throw new Error('Expected ops');
    const applied = applyOpsStrict(base, result.input.ops, createCounterIdSource()); expect(applied.ok).toBe(true);
    if (applied.ok) expect(comparable(applied.value.doc)).toEqual(comparable(result.document));
  });
});
