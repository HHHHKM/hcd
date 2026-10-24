import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalJson, type Block, type Document, type Inline, type TableBlock } from './model';
import { type Op, subtreeHash } from './ops';
import { snapshotToOperations } from './snapshot-ops';
import { compareDocumentChanges, textChangeSegments, toChanges } from './changes';
const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Plan', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [] }] };
const id = (n: number) => `n_${n.toString(32).replace(/[0-9a-v]/g, c => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(c, 32)]!).padStart(8, 'a')}`;
const paragraph = (n: number, text = `Text ${n}`): Block => ({ id: id(n), type: 'paragraph', text: [{ t: text }] });
const document = (...blocks: Block[]): Document => ({ ...structuredClone(base), modules: [{ ...base.modules[0]!, blocks }] });
const inlineFrom = (segments: ReturnType<typeof textChangeSegments>['segments'], side: 'before' | 'after') => segments.filter(segment => segment.type !== (side === 'before' ? 'ins' : 'del')).flatMap(segment => segment.value as Inline);
const units = (value: Inline) => value.flatMap<Inline[number]>(run => 'br' in run ? [{ br: true }] : Array.from(run.t).map(t => ({ ...run, t })));

describe('text change presentation', () => {
  it('preserves spaces, newlines, Unicode and formatting-only changes', () => {
    const before: Inline = [{ t: ' 中 A  ', b: true }, { br: true }, { t: '🙂 tail ' }];
    const after: Inline = [{ t: ' 中 A  ', i: true }, { br: true }, { t: '🙂 tail  ' }];
    const result = textChangeSegments(before, after);
    expect(result.detail).toBe('tokens');
    expect(units(inlineFrom(result.segments, 'before'))).toEqual(units(before));
    expect(units(inlineFrom(result.segments, 'after'))).toEqual(units(after));
    expect(result.segments.some(segment => segment.type === 'del' && (segment.value as Inline).some(run => 'b' in run))).toBe(true);
    expect(result.segments.some(segment => segment.type === 'ins' && (segment.value as Inline).some(run => 'i' in run))).toBe(true);
  });
  it('preserves plain-string whitespace without inline normalization', () => {
    const before = '  a\t\nb  '; const after = ' a\t\nc   ';
    const result = textChangeSegments(before, after);
    expect(result.segments.filter(segment => segment.type !== 'ins').map(segment => segment.value).join('')).toBe(before);
    expect(result.segments.filter(segment => segment.type !== 'del').map(segment => segment.value).join('')).toBe(after);
  });
  it('shows link-only formatting edits even when readable text matches', () => {
    const result = textChangeSegments([{ t: 'Read', href: 'https://a.example/' }], [{ t: 'Read', href: 'https://b.example/' }]);
    expect(result.segments.map(segment => segment.type)).toEqual(['del', 'ins']);
  });
  it('falls back to a bounded replacement for long unrelated text', () => {
    const before = `prefix ${'甲'.repeat(20_000)} suffix`;
    const after = `prefix ${'乙'.repeat(20_000)} suffix`;
    const result = textChangeSegments(before, after);
    expect(result.detail).toBe('replacement');
    expect(result.segments.map(segment => segment.type)).toEqual(['eq', 'del', 'ins', 'eq']);
    expect(result.segments.filter(segment => segment.type !== 'ins').map(segment => segment.value).join('')).toBe(before);
    expect(result.segments.filter(segment => segment.type !== 'del').map(segment => segment.value).join('')).toBe(after);
  });
  it('round-trips randomized units and marks from either side of a diff', () => {
    const run = fc.record({ t: fc.constantFrom('a', 'b', ' 中 ', '🙂', ' ', 'word'), b: fc.boolean(), i: fc.boolean() }).map(({ t, b, i }) => ({ t, ...(b ? { b: true as const } : {}), ...(i ? { i: true as const } : {}) }));
    fc.assert(fc.property(fc.array(run, { maxLength: 30 }), fc.array(run, { maxLength: 30 }), (before, after) => {
      const result = textChangeSegments(before, after);
      expect(units(inlineFrom(result.segments, 'before'))).toEqual(units(before));
      expect(units(inlineFrom(result.segments, 'after'))).toEqual(units(after));
    }), { numRuns: 150, seed: 20261024 });
  });
});

describe('recorded operation presentation', () => {
  it('keeps repeated edits, no-ops, uncertainty and original operation indices', () => {
    const source = document(paragraph(1, 'Start')); const target = document(paragraph(1, 'Finish'));
    const operations: Op[] = [
      { op: 'set', at: { id: id(1), field: 'text' }, before: [{ t: 'Start' }], after: [{ t: 'Middle' }], uncertain: true },
      { op: 'set', at: { id: id(1), field: 'text' }, before: [{ t: 'Middle' }], after: [{ t: 'Middle' }] },
      { op: 'set', at: { id: id(1), field: 'text' }, before: [{ t: 'Middle' }], after: [{ t: 'Finish' }] },
    ];
    const changes = toChanges(source, target, operations);
    expect(changes.map(change => change.opIndex)).toEqual([0, 1, 2]);
    expect(changes[0]).toMatchObject({ uncertain: true, before: [{ t: 'Start' }], after: [{ t: 'Middle' }], moduleTitle: 'Main', targetType: 'paragraph' });
    expect(changes[1]!.segments).toEqual([{ type: 'eq', value: [{ t: 'Middle' }] }]);
    expect(changes.every(change => change.sources === undefined)).toBe(true);
  });
  it('captures inserted and deleted objects at operation time even when absent from both endpoints', () => {
    const source = document(); const transient = paragraph(1);
    const middle = document(paragraph(1, 'Temporary edit'));
    const operations: Op[] = [
      { op: 'insert', parent: { id: base.modules[0]!.id, list: 'blocks' }, after: null, node: transient },
      { op: 'set', at: { id: id(1), field: 'text' }, before: [{ t: 'Text 1' }], after: [{ t: 'Temporary edit' }] },
      { op: 'delete', target: id(1), beforeHash: subtreeHash(middle, id(1))! },
    ];
    const changes = toChanges(source, source, operations);
    expect(changes.map(change => change.kind)).toEqual(['insert', 'text', 'delete']);
    expect(changes[0]!.nodeAfter).toEqual(transient);
    expect(changes[2]!.nodeBefore).toEqual(paragraph(1, 'Temporary edit'));
  });
  it('uses sequential module ancestry and intermediate move positions', () => {
    const source = document(paragraph(1), paragraph(2)); source.modules.push({ id: 'm_bbbbbbbb', title: 'Second', blocks: [] });
    const target = structuredClone(source); target.modules[0]!.blocks = [paragraph(2)]; target.modules[1]!.blocks = [paragraph(1, 'After moving')];
    const operations: Op[] = [
      { op: 'move', target: id(1), parent: { id: 'm_bbbbbbbb', list: 'blocks' }, after: null, from: { parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null } },
      { op: 'set', at: { id: id(1), field: 'text' }, before: [{ t: 'Text 1' }], after: [{ t: 'After moving' }] },
    ];
    const changes = toChanges(source, target, operations);
    expect(changes[0]).toMatchObject({ kind: 'move', from: { parentLabel: 'Main' }, to: { parentLabel: 'Second' }, nodeBefore: paragraph(1), nodeAfter: paragraph(1) });
    expect(changes[1]).toMatchObject({ moduleId: 'm_bbbbbbbb', moduleTitle: 'Second' });
  });
  it('distinguishes text fields from scalar strings and document accent', () => {
    const source = document({ id: id(1), type: 'callout', tone: 'info', title: '', text: [] });
    const target = structuredClone(source); target.title = 'Updated'; target.theme.overrides.accent = '#aabbcc'; (target.modules[0]!.blocks[0] as { tone: string }).tone = 'warn';
    const changes = toChanges(source, target, snapshotToOperations(source, target).ops);
    expect(changes.find(change => change.field === 'title')!.kind).toBe('text');
    expect(changes.find(change => change.field === 'tone')!.kind).toBe('field');
    expect(changes.find(change => change.field === 'theme.overrides.accent')).toMatchObject({ kind: 'field', moduleId: null, targetType: 'document' });
  });
  it('labels cell fields using the column header at operation time', () => {
    const table: TableBlock = { id: id(1), type: 'table', caption: '', columns: [{ id: id(2), header: [{ t: 'Revenue' }], align: 'left' }], rows: [{ id: id(3), cells: { [id(2)]: [{ t: '10' }] } }] };
    const source = document(table); const target = structuredClone(source); (target.modules[0]!.blocks[0] as TableBlock).rows[0]!.cells[id(2)] = [{ t: '20' }];
    const changes = toChanges(source, target, snapshotToOperations(source, target).ops);
    expect(changes[0]).toMatchObject({ fieldLabel: 'Revenue', field: `cell:${id(2)}`, targetType: 'table-row', kind: 'text' });
  });
  it('captures data removed indirectly by deleting table columns and chart categories', () => {
    const table: TableBlock = { id: id(1), type: 'table', caption: '', columns: [{ id: id(2), header: [{ t: 'Amount' }], align: 'left' }], rows: [{ id: id(3), cells: { [id(2)]: [{ t: 'Lost value', b: true }] } }] };
    const source = document(table, { id: id(4), type: 'chart', kind: 'bar', title: '', unit: '', categories: [{ id: id(5), label: 'Q1' }], series: [{ id: id(6), name: 'Revenue', values: { [id(5)]: 0 } }] });
    const target = structuredClone(source);
    const t = target.modules[0]!.blocks[0] as TableBlock; t.columns = []; t.rows[0]!.cells = {};
    const chart = target.modules[0]!.blocks[1]; if (chart?.type !== 'chart') throw new Error('fixture'); chart.categories = []; chart.series[0]!.values = {};
    const changes = toChanges(source, target, snapshotToOperations(source, target).ops);
    expect(changes.find(change => change.targetId === id(2))!.coupledBefore).toEqual([{ targetId: id(3), field: `cell:${id(2)}`, value: [{ t: 'Lost value', b: true }] }]);
    expect(changes.find(change => change.targetId === id(5))!.coupledBefore).toEqual([{ targetId: id(6), field: `value:${id(5)}`, value: 0 }]);
  });
  it('rejects wrong deletion hashes and recorded move origins instead of guessing', () => {
    const source = document(paragraph(1), paragraph(2));
    expect(() => toChanges(source, source, [{ op: 'delete', target: id(1), beforeHash: '0'.repeat(64) }])).toThrow('DISPLAY_DELETE_PRECONDITION');
    expect(() => toChanges(source, source, [{ op: 'move', target: id(1), parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: id(2), from: { parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: id(2) } }])).toThrow('DISPLAY_MOVE_PRECONDITION');
  });
  it('rejects mismatched snapshots, stale preconditions and temporary receipt IDs', () => {
    const source = document(paragraph(1)); const target = document(paragraph(1, 'Changed'));
    expect(() => toChanges(source, target, [])).toThrow('DISPLAY_REPLAY_MISMATCH');
    expect(() => toChanges(source, target, [{ op: 'set', at: { id: id(1), field: 'text' }, before: [], after: [{ t: 'Changed' }] }])).toThrow('DISPLAY_SET_PRECONDITION');
    expect(() => toChanges(source, source, [{ op: 'insert', parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null, node: { id: 'tmp_new', type: 'paragraph', text: [] } }])).toThrow('DISPLAY_REQUIRES_PERMANENT_IDS');
  });
  it('does not mutate documents or operation payloads', () => {
    const source = document(paragraph(1)); const target = document(paragraph(2), paragraph(1, 'Changed'));
    const operations = snapshotToOperations(source, target).ops; const original = canonicalJson({ source, target, operations });
    const changes = toChanges(source, target, operations);
    changes[0]!.moduleTitle = 'Mutated display';
    const insertion = changes.find(change => change.kind === 'insert')!; (insertion.nodeAfter as { text: Inline }).text.push({ t: 'display-only' });
    expect(canonicalJson({ source, target, operations })).toBe(original);
  });
});

describe('candidate net change presentation', () => {
  it('preserves final IDs across inserted subtrees and structural moves', () => {
    const source = document(paragraph(1), paragraph(2)); const target = document(paragraph(2), paragraph(3), paragraph(1));
    const result = compareDocumentChanges(source, target);
    expect(result.unavailable).toBeUndefined();
    expect(result.changes.find(change => change.kind === 'insert')?.targetId).toBe(id(3));
    expect(JSON.stringify(result)).not.toContain('tmp_');
  });
  it('displays more than 500 operations without increasing the submission limit', () => {
    const source = document(); const target = document(...Array.from({ length: 501 }, (_, n) => paragraph(n + 1)));
    expect(() => snapshotToOperations(source, target)).toThrow('TOO_MANY_OPERATIONS');
    const result = compareDocumentChanges(source, target);
    expect(result.unavailable).toBeUndefined(); expect(result.changes).toHaveLength(501);
    expect(result.changes[500]!.opIndex).toBe(500);
  });
  it('reports unavailable for unrepresentable fields rather than claiming an empty diff', () => {
    const target = structuredClone(base); target.theme.version = 2;
    expect(compareDocumentChanges(base, target)).toEqual({ changes: [], unavailable: 'IMMUTABLE_THEME_REFERENCE' });
    expect(compareDocumentChanges(base, { ...base, id: 'd_bbbbbbbb' })).toEqual({ changes: [], unavailable: 'DISPLAY_DOCUMENT_ID_MISMATCH' });
  });
  it('bounds repeated structural snapshots without returning a partial change list', () => {
    const source = document(paragraph(1, 'A'.repeat(20_000)), paragraph(2));
    const operations: Op[] = [];
    for (let n = 0; n < 220; n++) operations.push({ op: 'move', target: id(1), parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: n % 2 === 0 ? id(2) : null });
    expect(() => toChanges(source, source, operations)).toThrow('DISPLAY_TOO_LARGE');
  });
  it('round-trips randomized insertion, deletion, reordering and cross-module moves', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { maxLength: 20 }), fc.uniqueArray(fc.integer({ min: 1, max: 25 }), { maxLength: 20 }), fc.integer({ min: 0, max: 20 }), (before, after, split) => {
      const source = document(...before.map(n => paragraph(n))); source.modules.push({ id: 'm_bbbbbbbb', title: 'Second', blocks: [] });
      const target = structuredClone(source); target.modules[0]!.blocks = after.slice(0, split).map(n => paragraph(n, `New ${n}`)); target.modules[1]!.blocks = after.slice(split).map(n => paragraph(n));
      const result = compareDocumentChanges(source, target);
      expect(result.unavailable).toBeUndefined();
      expect(result.changes.map(change => change.opIndex)).toEqual(result.changes.map((_, index) => index));
    }), { numRuns: 100, seed: 20261025 });
  });
});
