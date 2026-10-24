import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyOpsStrict, canonicalizeDocument, createCounterTmpIdSource, diffDocuments, snapshotToOperations, type Document, type TableBlock, type ChartBlock, type Block, type ParagraphBlock } from './index';
const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Plan', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [] }] };
const id = (n: number, prefix = 'n') => `${prefix}_${n.toString(32).replace(/[0-9a-v]/g, c => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(c, 32)]!).padStart(8, 'a')}`;
const paragraph = (n: number): ParagraphBlock => ({ id: id(n), type: 'paragraph', text: [{ t: `Text ${n}` }] });
const document = (...blocks: Block[]): Document => ({ ...structuredClone(base), modules: [{ ...base.modules[0]!, blocks }] });
const table: TableBlock = { id: id(1), type: 'table', caption: '', columns: [{ id: id(2), header: [{ t: 'A' }], align: 'left' }, { id: id(3), header: [], align: 'right' }], rows: [{ id: id(4), cells: { [id(2)]: [{ t: 'First' }], [id(3)]: [{ t: 'Second' }] } }, { id: id(5), cells: { [id(2)]: [{ t: 'More' }] } }] };
const chart: ChartBlock = { id: id(11), type: 'chart', title: '', kind: 'bar', unit: '', categories: [{ id: id(12), label: 'A' }, { id: id(13), label: 'B' }], series: [{ id: id(14), name: 'One', values: { [id(12)]: 3, [id(13)]: 4 } }, { id: id(15), name: 'Two', values: { [id(12)]: 7 } }] };
function roundtrip(source: Document, target: Document) { const result = snapshotToOperations(source, target); expect(result.doc).toEqual(canonicalizeDocument(target)); return result; }

describe('ID-preserving snapshot conversion', () => {
  it('preserves new module, nested node and cell IDs exactly', () => {
    const target = document(table, chart); target.modules[0]!.id = 'm_bbbbbbbb';
    const result = roundtrip(base, target); expect(Object.values(result.idMap)).toContain(id(4));
    expect(result.ops[0]).toMatchObject({ op: 'delete', target: base.modules[0]!.id });
    expect(result.ops[1]).toMatchObject({ op: 'insert', node: target.modules[0] });
  });
  it('preserves cells and values when adding rows and series to existing containers', () => {
    const source = document(table, chart); const target = structuredClone(source);
    (target.modules[0]!.blocks[0] as TableBlock).rows.push({ id: id(6), cells: { [id(2)]: [{ t: 'Keep this' }] } });
    (target.modules[0]!.blocks[1] as ChartBlock).series.push({ id: id(16), name: 'New', values: { [id(12)]: 0, [id(13)]: -2 } });
    roundtrip(source, target);
  });
  it('computes sequential coupled deletion hashes while removing rows/columns and categories/series', () => {
    const source = document(table, chart); const target = structuredClone(source);
    const t = target.modules[0]!.blocks[0] as TableBlock; t.columns.shift(); t.rows.shift(); delete t.rows[0]!.cells[id(2)];
    const c = target.modules[0]!.blocks[1] as ChartBlock; c.categories.shift(); c.series.shift(); delete c.series[0]!.values[id(12)];
    roundtrip(source, target);
  });
  it('deletes coupled columns before adding rows so hashes work for any generated IDs', () => {
    const source = document(table); const t = structuredClone(table); t.columns.shift(); for (const row of t.rows) delete row.cells[id(2)]; t.rows.push({ id: id(6), cells: { [id(3)]: [{ t: 'New row' }] } });
    const target = document(t); roundtrip(source, target);
    const ops = diffDocuments(source, target, createCounterTmpIdSource());
    const replay = applyOpsStrict(source, ops, { next: () => 'n_zzzzzzzz' });
    expect(replay.ok).toBe(true); if (replay.ok) expect((replay.value.doc.modules[0]!.blocks[0] as TableBlock).rows.at(-1)!.cells).toEqual(t.rows.at(-1)!.cells);
  });
  it('retains new column/category references in existing rows/series', () => {
    const source = document(table, chart); const target = structuredClone(source);
    const t = target.modules[0]!.blocks[0] as TableBlock; t.columns.push({ id: id(6), header: [], align: 'left' }); t.rows[0]!.cells[id(6)] = [{ t: 'Late column' }];
    const c = target.modules[0]!.blocks[1] as ChartBlock; c.categories.push({ id: id(16), label: 'New' }); c.series[0]!.values[id(16)] = 19;
    roundtrip(source, target);
  });
  it('moves rows and series across containers while rewriting their coupled references', () => {
    const t = structuredClone(table); const c = structuredClone(chart);
    const otherTable: TableBlock = { id: id(21), type: 'table', caption: '', columns: [{ id: id(22), header: [], align: 'left' }], rows: [] };
    const otherChart: ChartBlock = { id: id(31), type: 'chart', kind: 'bar', title: '', unit: '', categories: [{ id: id(32), label: 'Other' }], series: [] };
    const source = document(t, c, otherTable, otherChart);
    const target = document({ ...otherTable, rows: [{ id: id(4), cells: { [id(22)]: [{ t: 'Moved cell' }] } }] }, { ...otherChart, series: [{ id: id(14), name: 'Moved', values: { [id(32)]: 9 } }] });
    roundtrip(source, target);
  });
  it('evacuates a removed container into a new container before validating cardinality', () => {
    const source = document({ id: id(1), type: 'columns', ratio: '1:1', cols: [{ id: id(2), blocks: [paragraph(4)] }, { id: id(3), blocks: [paragraph(5)] }] });
    const target = structuredClone(source); target.modules[0]!.blocks[0]!.id = id(6);
    const result = roundtrip(source, target); expect(result.ops.filter(op => op.op === 'move')).toHaveLength(2);
  });
  it('replaces a column at the maximum allowed size without rejecting the intermediate document', () => {
    const t = structuredClone(table); t.columns = Array.from({ length: 50 }, (_, i) => ({ id: id(i + 100), header: [], align: 'left' })); t.rows = [];
    const source = document(t); const target = structuredClone(source); const next = target.modules[0]!.blocks[0] as TableBlock; next.columns[0] = { id: id(999), header: [{ t: 'Replacement' }], align: 'center' };
    roundtrip(source, target);
  });
  it.each(['theme', 'kind', 'raw'] as const)('rejects nonrepresentable %s changes explicitly', kind => {
    const source = document({ id: id(1), type: 'raw', asset: 'as_aaaaaaaaaaaa', height: 400, note: '', allowScripts: false }); const target = structuredClone(source);
    if (kind === 'theme') target.theme.version = 2;
    else if (kind === 'kind') target.modules[0]!.blocks[0] = { id: id(1), type: 'divider' };
    else (target.modules[0]!.blocks[0] as { asset: string }).asset = 'as_bbbbbbbbbbbb';
    expect(() => snapshotToOperations(source, target)).toThrow('SNAPSHOT_NOT_REPRESENTABLE');
  });
  it('rejects dangling references, duplicate IDs and changed document identity before normalization', () => {
    const target = document(table); (target.modules[0]!.blocks[0] as TableBlock).rows[0]!.cells[id(999)] = [{ t: 'Do not erase' }];
    expect(() => snapshotToOperations(base, target)).toThrow('VALIDATION_FAILED');
    expect(() => snapshotToOperations(base, document(paragraph(1), paragraph(1)))).toThrow('VALIDATION_FAILED');
    expect(() => snapshotToOperations(base, { ...base, id: 'd_bbbbbbbb' })).toThrow('DOCUMENT_ID_MISMATCH');
  });
  it('allows unchanged snapshots for existing clients and explicitly limits oversized diffs', () => {
    expect(roundtrip(base, base).ops).toEqual([]);
    expect(() => snapshotToOperations(base, document(...Array.from({ length: 501 }, (_, n) => paragraph(n + 1))))).toThrow('TOO_MANY_OPERATIONS');
  });
  it('round trips randomized insert/delete/reorder/move/edit combinations deterministically', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { maxLength: 25 }), fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 30 }), fc.integer({ min: 0, max: 30 }), (before, after, split) => {
      const source = document(...before.map(paragraph)); source.modules.push({ id: 'm_bbbbbbbb', title: 'Second', blocks: [] });
      const target = structuredClone(source); target.modules[0]!.blocks = after.slice(0, split).map(paragraph); target.modules[1]!.blocks = after.slice(split).map(paragraph);
      target.title = `Count ${after.length}`;
      const result = roundtrip(source, target); expect(snapshotToOperations(source, target)).toEqual(result);
    }), { numRuns: 200, seed: 20261023 });
  });
});
