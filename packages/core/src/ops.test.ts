import { describe, expect, it } from 'vitest';
import { applyOpsStrict, createCounterIdSource, hashOf, subtreeHash, type Document, type Op } from './index';

const base: Document = {
  schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Plan', theme: { id: 'default', version: 1, overrides: {} },
  modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [
    { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Before' }] },
    { id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'After' }] },
  ] }],
};

describe('strict operations', () => {
  it('maps temporary IDs and applies sequential changes against the updated document', () => {
    const ops: Op[] = [
      { op: 'insert', parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null,
        node: { id: 'tmp_room_1', type: 'paragraph', text: [] } },
      { op: 'set', at: { id: 'tmp_room_1', field: 'text' }, before: [], after: [{ t: 'Added' }] },
    ];
    const result = applyOpsStrict(base, ops, createCounterIdSource());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.idMap).toEqual({ tmp_room_1: 'n_aaaaaaab' });
    expect(result.value.doc.modules[0]?.blocks[0]).toEqual({ id: 'n_aaaaaaab', type: 'paragraph', text: [{ t: 'Added' }] });
  });

  it('rejects stale field values with a precondition error', () => {
    const result = applyOpsStrict(base, [{ op: 'set', at: { id: 'n_aaaaaaaa', field: 'text' }, before: [{ t: 'stale' }], after: [{ t: 'new' }] }], createCounterIdSource());
    expect(result).toMatchObject({ ok: false, error: { index: 0, code: 'PRECONDITION_FAILED' } });
  });

  it('moves nodes and records the source location', () => {
    const result = applyOpsStrict(base, [{ op: 'move', target: 'n_bbbbbbbb', parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null }], createCounterIdSource());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc.modules[0]?.blocks.map((block) => block.id)).toEqual(['n_bbbbbbbb', 'n_aaaaaaaa']);
    expect(result.value.ops[0]).toMatchObject({ from: { parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: 'n_aaaaaaaa' } });
  });

  it('uses coupled table data when hashing and deleting a column', () => {
    const tableDoc: Document = { ...base, modules: [{ ...base.modules[0]!, blocks: [{
      id: 'n_cccccccc', type: 'table', caption: '',
      columns: [{ id: 'n_dddddddd', header: [{ t: 'A' }], align: 'left' }],
      rows: [{ id: 'n_eeeeeeee', cells: { n_dddddddd: [{ t: 'x' }] } }],
    }] }] };
    expect(subtreeHash(tableDoc, 'n_dddddddd')).toBe(hashOf({
      column: tableDoc.modules[0]?.blocks[0]?.type === 'table' ? tableDoc.modules[0].blocks[0].columns[0] : undefined,
      cells: [['n_eeeeeeee', [{ t: 'x' }]]],
    }));
    const hash = subtreeHash(tableDoc, 'n_dddddddd')!;
    const result = applyOpsStrict(tableDoc, [{ op: 'delete', target: 'n_dddddddd', beforeHash: hash }], createCounterIdSource());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.doc.modules[0]?.blocks[0]).toMatchObject({ type: 'table', columns: [], rows: [{ cells: {} }] });
  });
  it('rejects unknown column references before normalization can erase cell data', () => {
    const doc:Document={...base,modules:[{...base.modules[0]!,blocks:[{id:'n_cccccccc',type:'table',caption:'',columns:[],rows:[]}]}]};
    const result=applyOpsStrict(doc,[{op:'insert',parent:{id:'n_cccccccc',list:'rows'},after:null,node:{id:'tmp_row',cells:{n_dddddddd:[{t:'Must not disappear'}]}}}],createCounterIdSource());
    expect(result).toMatchObject({ok:false,error:{code:'VALIDATION_FAILED'}});
  });
  it('preserves references to a new column inserted later in the same transaction', () => {
    const doc:Document={...base,modules:[{...base.modules[0]!,blocks:[{id:'n_cccccccc',type:'table',caption:'',columns:[],rows:[]}]}]};
    const result=applyOpsStrict(doc,[{op:'insert',parent:{id:'n_cccccccc',list:'rows'},after:null,node:{id:'tmp_row',cells:{tmp_column:[{t:'Keep this cell'}]}}},{op:'insert',parent:{id:'n_cccccccc',list:'columns'},after:null,node:{id:'tmp_column',header:[],align:'left'}}],createCounterIdSource());
    expect(result.ok).toBe(true);if(!result.ok)return;expect(result.value.doc.modules[0]!.blocks[0]).toMatchObject({rows:[{cells:{[result.value.idMap.tmp_column!]:[{t:'Keep this cell'}]}}]});
  });
});
