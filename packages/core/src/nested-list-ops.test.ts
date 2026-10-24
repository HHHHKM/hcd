import { describe, expect, it } from 'vitest';
import { canonicalizeDocument, createCounterIdSource, createCounterTmpIdSource, type Document, type ListBlock } from './model';
import { applyOpsStrict, type Op } from './ops';
import { diffDocuments } from './diff';
import { computePreview } from './merge';

const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Nested list', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [{ id: 'n_aaaaaaaa', type: 'list', ordered: false, items: [
  { id: 'n_bbbbbbbb', text: [{ t: 'First parent' }], items: [{ id: 'n_cccccccc', text: [{ t: 'Child' }], items: [] }] },
  { id: 'n_dddddddd', text: [{ t: 'Second parent' }], items: [{ id: 'n_eeeeeeee', text: [{ t: 'Other child' }], items: [] }] },
] }] }] };
const list = (doc: Document) => doc.modules[0]!.blocks[0] as ListBlock;

describe('second-level list operations', () => {
  it('inserts a temporary child under an existing first-level item and changes it in the same request', () => {
    const original = structuredClone(base);
    const ops: Op[] = [
      { op: 'insert', parent: { id: 'n_bbbbbbbb', list: 'items' }, after: 'n_cccccccc', node: { id: 'tmp_child', text: [], items: [] } },
      { op: 'set', at: { id: 'tmp_child', field: 'text' }, before: [], after: [{ t: 'New nested child' }] },
    ];
    const result = applyOpsStrict(base, ops, createCounterIdSource());
    expect(result.ok).toBe(true);
    if (result.ok) expect(list(result.value.doc).items[0]!.items).toEqual([
      list(base).items[0]!.items[0], { id: result.value.idMap.tmp_child, text: [{ t: 'New nested child' }], items: [] },
    ]);
    expect(base).toEqual(original);
  });

  it('diffs and replays a child moved between first-level items, preserving concurrent parent text during review', () => {
    const target = structuredClone(base); const targetList = list(target);
    targetList.items[1]!.items.push(targetList.items[0]!.items.shift()!);
    const ops = diffDocuments(base, target, createCounterTmpIdSource('nested'));
    expect(ops).toEqual([{ op: 'move', target: 'n_cccccccc', parent: { id: 'n_dddddddd', list: 'items' }, after: 'n_eeeeeeee' }]);
    const applied = applyOpsStrict(base, ops, createCounterIdSource());
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.value.doc).toEqual(canonicalizeDocument(target));
    const current = structuredClone(base); list(current).items[1]!.text = [{ t: 'Concurrent parent edit' }];
    const preview = computePreview({ current, snapshotAt: () => base, submissions: [{ id: 'nested', createdAt: '2026-10-23T00:00:00Z', baseVersion: 1, ops }] });
    expect(preview.publishable).toBe(true); expect(preview.conflicts).toEqual([]);
    expect(list(preview.candidate).items[1]).toEqual({ ...targetList.items[1], text: [{ t: 'Concurrent parent edit' }] });
  });

  it('still rejects third-level targets, cycles and inserted subtrees that would exceed two levels', () => {
    const original = structuredClone(base);
    const rejected: Op[][] = [
      [{ op: 'insert', parent: { id: 'n_cccccccc', list: 'items' }, after: null, node: { id: 'tmp_too_deep', text: [], items: [] } }],
      [{ op: 'move', target: 'n_bbbbbbbb', parent: { id: 'n_bbbbbbbb', list: 'items' }, after: null }],
      [{ op: 'insert', parent: { id: 'n_bbbbbbbb', list: 'items' }, after: null, node: { id: 'tmp_parent', text: [], items: [{ id: 'tmp_grandchild', text: [], items: [] }] } }],
    ];
    for (const ops of rejected) expect(applyOpsStrict(base, ops, createCounterIdSource())).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(base).toEqual(original);
  });
});
