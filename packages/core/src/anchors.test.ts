import { describe, expect, it } from 'vitest';
import { relocateAnchor } from './anchors';
import type { Document } from './model';
const doc = (text: string): Document => ({ schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Anchors', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'M', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: text }] }] }] });
const anchor = { moduleId: 'm_aaaaaaaa', blockId: 'n_aaaaaaaa', field: 'text', quote: 'target', prefix: 'right ', suffix: ' end', version: 1 };
describe('comment anchor relocation', () => {
  it('AT-08 uses context to distinguish repeated quotes without mutating input', () => {
    const copy = structuredClone(anchor); const content = doc('wrong target start; right target end'); const result = relocateAnchor(anchor, content);
    expect(result.state).toBe('ok'); expect(result.range).toEqual({ start: 26, end: 32 }); expect(anchor).toEqual(copy);
  });
  it('AT-08 maps changed quote boundaries through insertions and uses a similarity threshold', () => {
    const changed = relocateAnchor(anchor, doc('right targets end'));
    expect(changed.state).toBe('ok'); expect(changed.range).toEqual({ start: 6, end: 12 });
    const typo = relocateAnchor(anchor, doc('right targat end'));
    expect(typo.state).toBe('ok'); expect(typo.anchor.quote).toBe('targat'); expect(typo.range).toEqual({ start: 6, end: 12 });
    expect(relocateAnchor(anchor, doc('completely unrelated words')).state).toBe('text_changed');
    const inserted = relocateAnchor({ ...anchor, quote: 'abcdefgh', prefix: '', suffix: '' }, doc('xx abcdZefgh yy'));
    expect(inserted.anchor.quote).toBe('abcdZefgh'); expect(inserted.range).toEqual({ start: 3, end: 12 });
  });
  it('AT-08 preserves a moved block, falls back to its module, and detects lost modules', () => {
    const moved = doc('right target end'); moved.modules[0]!.id = 'm_bbbbbbbb';
    expect(relocateAnchor(anchor, moved).anchor.moduleId).toBe('m_bbbbbbbb');
    const removed = doc(''); removed.modules[0]!.blocks = [];
    const result = relocateAnchor(anchor, removed); expect(result.state).toBe('block_deleted'); expect(result.anchor.blockId).toBeUndefined(); expect(result.anchor.field).toBeUndefined();
    expect(relocateAnchor(anchor, { ...removed, modules: [] }).state).toBe('lost');
    expect(relocateAnchor({}, removed).state).toBe('ok');
  });
  it('AT-08 finds text in nested cells and handles Unicode positions', () => {
    const content = doc(''); content.modules[0]!.blocks = [{ id: 'n_tableaaa', type: 'table', caption: '', columns: [{ id: 'n_colaaaaa', header: [], align: 'left' }], rows: [{ id: 'n_rowaaaaa', cells: { n_colaaaaa: [{ t: '你好 🌍 world' }] } }] }];
    expect(relocateAnchor({ moduleId: 'm_aaaaaaaa', blockId: 'n_rowaaaaa', field: 'cell:n_colaaaaa', quote: '🌍 world' }, content).range).toEqual({ start: 3, end: 11 });
  });
});
