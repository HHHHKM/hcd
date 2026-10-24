import { describe, expect, it } from 'vitest';
import { applyOpsStrict, canonicalizeDocument, createCounterIdSource, createCounterTmpIdSource, diffDocuments, type Document } from './index';

const base: Document = {
  schemaVersion: 1,
  id: 'd_aaaaaaaa',
  title: 'Original',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [
    { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'One' }] },
    { id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'Two' }] },
  ] }],
};

describe('document diff', () => {
  it('AT-14 emits sets and applies them to a canonical target', () => {
    const target = structuredClone(base);
    target.title = 'Changed';
    target.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Updated' }] };
    const ops = diffDocuments(base, target, createCounterTmpIdSource('diff'));
    expect(ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'set', at: { id: 'd_aaaaaaaa', field: 'title' } }),
      expect.objectContaining({ op: 'set', at: { id: 'n_aaaaaaaa', field: 'text' } }),
    ]));
    const result = applyOpsStrict(base, ops, createCounterIdSource());
    expect(result.ok).toBe(true);
    if (result.ok) expect(canonicalizeDocument(result.value.doc)).toEqual(canonicalizeDocument(target));
  });

  it('AT-14 handles new, removed, and reordered nodes with temporary IDs', () => {
    const target = structuredClone(base);
    target.modules[0]!.blocks = [
      { id: 'foreign-id', type: 'paragraph', text: [{ t: 'New' }] },
      target.modules[0]!.blocks[1]!,
    ] as any;
    const ops = diffDocuments(base, target, createCounterTmpIdSource('diff'));
    expect(ops.some(op => op.op === 'insert')).toBe(true);
    expect(ops.some((op) => op.op === 'delete' && op.target === 'n_aaaaaaaa')).toBe(true);
    const result = applyOpsStrict(base, ops, createCounterIdSource());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.doc.modules[0]!.blocks).toHaveLength(2);
      expect(result.value.doc.modules[0]!.blocks[0]).toMatchObject({ type: 'paragraph', text: [{ t: 'New' }] });
    }
  });

  it('AT-14 deletes a removed parent with its children using the post-move subtree hash', () => {
    const source: Document = {
      ...base,
      modules: [
        { id: 'm_aaaaaaaa', title: 'Move from', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Keep' }] }] },
        { id: 'm_bbbbbbbb', title: 'Move to', blocks: [] },
      ],
    };
    const target: Document = {
      ...source,
      modules: [{ id: 'm_bbbbbbbb', title: 'Move to', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Keep' }] }] }],
    };
    const ops = diffDocuments(source, target, createCounterTmpIdSource('diff'));
    expect(ops.filter((op) => op.op === 'delete')).toEqual([expect.objectContaining({ target: 'm_aaaaaaaa' })]);
    const result = applyOpsStrict(source, ops, createCounterIdSource());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.doc).toEqual(target);
  });
});
