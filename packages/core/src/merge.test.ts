import { describe, expect, it } from 'vitest';
import { computePreview, type MergeResolution, type OperationSubmission } from './merge';
import { applyOpsStrict, subtreeHash, type Op, type SetOp } from './ops';
import { createCounterIdSource, type Document } from './model';
const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Plan', theme: { id: 'default', version: 1, overrides: {} }, modules: [
  { id: 'm_aaaaaaaa', title: 'Main', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'One two three four five' }] }, { id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'Second' }] }] },
  { id: 'm_bbbbbbbb', title: 'Other', blocks: [] },
] };
const paragraph = (id: string) => ({ id, type: 'paragraph' as const, text: [{ t: 'New' }] });
const set = (after: string, id='n_aaaaaaaa', before='One two three four five'): SetOp => ({op:'set',at:{id,field:'text'},before:[{t:before}],after:[{t:after}]});
const sub = (id: string, ops: Op[]): OperationSubmission => ({id,createdAt:'2026-10-23T00:00:00Z',baseVersion:1,ops});
const run = (submissions: OperationSubmission[], resolutions: Record<string,MergeResolution>={}, current=base, source=base, excluded:string[]=[]) => computePreview({current,submissions,resolutions,excluded,snapshotAt:()=>source});
describe('operation-aware review',()=>{
  it('AT-02 merges independent modules and non-overlapping edits to the same field',()=>{
    const result=run([sub('A',[set('First two three four five')]),sub('B',[set('One two three four last'),{op:'set',at:{id:'m_bbbbbbbb',field:'title'},before:'Other',after:'Next'}])]);
    expect(result.publishable).toBe(true);expect(result.candidate.modules[0]!.blocks[0]).toMatchObject({text:[{t:'First two three four last'}]});expect(result.items[1]!.ops[0]).toMatchObject({outcome:'merged',note:'same_field_merge'});expect(result.candidate.modules[1]!.title).toBe('Next');
  });
  it('orders equal-time submissions by ID and preserves same-anchor insertion order',()=>{
    const insert=(id:string):Op=>({op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:'n_aaaaaaaa',node:paragraph(id)});
    const submissions=[sub('A',[insert('n_cccccccc')]),sub('B',[insert('n_dddddddd')])];
    const result=run(submissions);expect(result.candidate.modules[0]!.blocks.map(b=>b.id)).toEqual(['n_aaaaaaaa','n_cccccccc','n_dddddddd','n_bbbbbbbb']);expect(result.items[1]!.ops[0]!.note).toBe('same_anchor_insert');expect(run([...submissions].reverse()).candidateHash).toBe(result.candidateHash);
    expect(run(submissions,{},base,base,['A']).items[0]!.status).toBe('excluded');
  });
  it('AT-03 keeps dependent operations sequential and rolls back every operation of an unresolved ' +
     'submission',()=>{
    const a=sub('A',[set('Other two three four five')]); const b=sub('B',[{op:'insert',parent:{id:'m_bbbbbbbb',list:'blocks'},after:null,node:paragraph('n_cccccccc')},set('Conflict two three four five')]);
    const result=run([a,b,sub('C',[{op:'delete',target:'n_cccccccc',beforeHash:'0'.repeat(64)}])]);
    expect(result.publishable).toBe(false);expect(result.candidate.modules[1]!.blocks).toEqual([]);expect(result.items[2]!.ops[0]!.outcome).toBe('duplicate');expect(result.conflicts[0]!.kind).toBe('text_overlap');
    const resolved=run([a,b],{'B:1':{choice:'manual',value:[{t:'Reviewed'}]}});expect(resolved.publishable).toBe(true);expect(resolved.items[1]!.status).toBe('resolved');
  });
  it('applies insert, set and delete using the submission prefix',()=>{
    const inserted=sub('A',[{op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:null,node:paragraph('n_cccccccc')},set('Changed','n_cccccccc','New')]);
    const staged=run([inserted]).candidate; inserted.ops.push({op:'delete',target:'n_cccccccc',beforeHash:subtreeHash(staged,'n_cccccccc')!});
    expect(run([inserted]).candidate).toEqual(base);expect(run([inserted]).publishable).toBe(true);
  });
  it('AT-03 flags scalar conflicts and recognizes duplicate sets and deletes',()=>{
    const doc=structuredClone(base);doc.modules[0]!.blocks[0]={id:'n_aaaaaaaa',type:'callout',title:'',tone:'info',text:[]};
    const change=(tone:'warn'|'danger'):Op=>({op:'set',at:{id:'n_aaaaaaaa',field:'tone'},before:'info',after:tone});
    const duplicate=run([sub('A',[change('warn')]),sub('B',[change('warn')])],{},doc,doc);expect(duplicate.items[1]!.ops[0]!.outcome).toBe('duplicate');
    const conflicted=run([sub('A',[change('warn')]),sub('B',[change('danger')])],{},doc,doc);expect(conflicted.conflicts[0]!.kind).toBe('field_changed');
    const removal:Op={op:'delete',target:'n_aaaaaaaa',beforeHash:subtreeHash(doc,'n_aaaaaaaa')!};expect(run([sub('A',[removal]),sub('B',[removal])],{},doc,doc).items[1]!.ops[0]!.outcome).toBe('duplicate');
  });
  it('AT-06 detects delete-modified and restores a deleted target with its incoming change',()=>{
    const deletion:Op={op:'delete',target:'n_aaaaaaaa',beforeHash:subtreeHash(base,'n_aaaaaaaa')!};
    expect(run([sub('A',[set('Changed')]),sub('B',[deletion])]).conflicts[0]!.kind).toBe('delete_modified');
    const submissions=[sub('A',[deletion]),sub('B',[set('Restored')])];expect(run(submissions).conflicts[0]!.kind).toBe('target_deleted');
    expect(run(submissions,{'B:0':{choice:'restore_and_apply'}}).candidate.modules[0]!.blocks[0]).toMatchObject({text:[{t:'Restored'}]});
  });
  it('AT-06 restores into a deterministic recovered module when the original module is gone',()=>{
    const submissions=[sub('A',[{op:'delete',target:'m_aaaaaaaa',beforeHash:subtreeHash(base,'m_aaaaaaaa')!}]),sub('B',[set('Recovered')])];
    const resolved=run(submissions,{'B:0':{choice:'restore_and_apply'}});expect(resolved.publishable).toBe(true);expect(resolved.candidate.modules.at(-1)).toMatchObject({title:'已恢复的内容 / Restored',blocks:[{id:'n_aaaaaaaa',text:[{t:'Recovered'}]}]});expect(run(submissions,{'B:0':{choice:'restore_and_apply'}}).candidateHash).toBe(resolved.candidateHash);
  });
  it('AT-06 requires explicit placement for a missing parent and rejects invalid placement',()=>{
    const submissions=[sub('A',[{op:'delete',target:'m_bbbbbbbb',beforeHash:subtreeHash(base,'m_bbbbbbbb')!}]),sub('B',[{op:'insert',parent:{id:'m_bbbbbbbb',list:'blocks'},after:null,node:paragraph('n_cccccccc')}])];
    expect(run(submissions).conflicts[0]!.kind).toBe('parent_missing');
    expect(run(submissions,{'B:0':{choice:'place',parent:{id:'m_aaaaaaaa',list:'blocks'},after:null}}).publishable).toBe(true);
    expect(()=>run(submissions,{'B:0':{choice:'place',parent:{id:'n_aaaaaaaa',list:'blocks'},after:null}})).toThrow('Invalid destination');
  });
  it('AT-06 offers append-end or placement when an insertion anchor is lost',()=>{
    const submissions=[sub('A',[{op:'delete',target:'n_aaaaaaaa',beforeHash:subtreeHash(base,'n_aaaaaaaa')!}]),sub('B',[{op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:'n_aaaaaaaa',node:paragraph('n_cccccccc')}])];
    expect(run(submissions).conflicts[0]!.kind).toBe('anchor_lost');expect(run(submissions,{'B:0':{choice:'append_end'}}).candidate.modules[0]!.blocks.map(b=>b.id)).toEqual(['n_bbbbbbbb','n_cccccccc']);
  });
  it('AT-06 handles missing move targets, lost anchors and concurrent moves to other parents',()=>{
    const move:Op={op:'move',target:'n_aaaaaaaa',parent:{id:'m_bbbbbbbb',list:'blocks'},after:null,from:{parent:{id:'m_aaaaaaaa',list:'blocks'},after:null}};
    const targetDeleted=run([sub('A',[{op:'delete',target:'n_aaaaaaaa',beforeHash:subtreeHash(base,'n_aaaaaaaa')!}]),sub('B',[move])]);expect(targetDeleted.conflicts[0]!.allowed).toEqual(['keep_current']);
    const moveBack:Op={...move,parent:{id:'m_aaaaaaaa',list:'blocks'},after:'n_bbbbbbbb'};
    const moved=run([sub('A',[move]),sub('B',[moveBack])]);expect(moved.conflicts[0]!.kind).toBe('moved_elsewhere');expect(run([sub('A',[move]),sub('B',[moveBack])],{'B:0':{choice:'take_incoming'}}).candidate.modules[0]!.blocks.at(-1)!.id).toBe('n_aaaaaaaa');
    const lostAnchor=run([sub('A',[{op:'delete',target:'n_bbbbbbbb',beforeHash:subtreeHash(base,'n_bbbbbbbb')!}]),sub('B',[moveBack])]);expect(lostAnchor.conflicts[0]!.kind).toBe('anchor_lost');
  });
  it('AT-27 reviews uncertain operations separately and exposes a second conflict after acceptance',()=>{
    const uncertain={...set('Incoming two three four five'),uncertain:true as const};const submissions=[sub('A',[set('Current two three four five')]),sub('B',[uncertain])];
    expect(run(submissions).conflicts[0]!.kind).toBe('uncertain');
    const accepted=run(submissions,{'B:0':{choice:'accept'}});expect(accepted.conflicts.map(c=>[c.id,c.kind])).toEqual([['B:0','uncertain'],['B:0:2','text_overlap']]);expect(accepted.publishable).toBe(false);
    expect(run(submissions,{'B:0':{choice:'accept'},'B:0:2':{choice:'take_incoming'}}).publishable).toBe(true);
    expect(run(submissions,{'B:0':{choice:'drop'}}).items[1]!.ops[0]!.outcome).toBe('dropped');
  });
  it('AT-27 does not resurrect dependencies of a dropped or unresolved insertion',()=>{
    const submission=sub('A',[{op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:null,node:paragraph('n_cccccccc'),uncertain:true},set('Newer','n_cccccccc','New')]);
    expect(run([submission]).items[0]!.ops[1]!.note).toBe('dependency_unresolved');
    const dropped=run([submission],{'A:0':{choice:'drop'}});expect(dropped.candidate).toEqual(base);expect(dropped.items[0]!.ops[1]!.note).toBe('dependency_dropped');expect(dropped.publishable).toBe(true);
  });
  it('AT-03 invalidates a downstream decision when an earlier decision changes the conflict ' +
     'context',()=>{
    const submissions=[sub('A',[set('First')]),sub('B',[set('Second')]),sub('C',[set('Third')])];
    const first=run(submissions,{'B:0':{choice:'keep_current'}});const conflict=first.conflicts.find(c=>c.id==='C:0')!;
    const result=run(submissions,{'B:0':{choice:'take_incoming'},'C:0':{choice:'take_incoming',fingerprint:conflict.fingerprint}});
    expect(result.conflicts.find(c=>c.id==='C:0')!.resolution).toBeUndefined();expect(result.publishable).toBe(false);
  });
  it('AT-03 rejects invalid manual values even while other conflicts remain unresolved',()=>{
    const submissions=[sub('A',[set('First')]),sub('B',[set('Second'),{op:'set',at:{id:'m_aaaaaaaa',field:'title'},before:'Main',after:'Incoming'}])];
    expect(()=>run(submissions,{'B:0':{choice:'manual',value:[{t:42}]}})).toThrow();
    expect(()=>run(submissions,{'B:0':{choice:'manual',value:'not inline'}})).toThrow();
  });
  it('AT-06 detects coupled column changes before deletion and restores missing cells without ' +
     'overwriting other edits',()=>{
    const doc=structuredClone(base);doc.modules[0]!.blocks=[{id:'n_aaaaaaaa',type:'table',caption:'',columns:[{id:'n_cccccccc',header:[{t:'Col'}],align:'left'}],rows:[{id:'n_dddddddd',cells:{n_cccccccc:[{t:'Old'}]}}]}];
    const deletion:Op={op:'delete',target:'n_cccccccc',beforeHash:subtreeHash(doc,'n_cccccccc')!};const change:Op={op:'set',at:{id:'n_dddddddd',field:'cell:n_cccccccc'},before:[{t:'Old'}],after:[{t:'New'}]};
    expect(run([sub('A',[change]),sub('B',[deletion])],{},doc,doc).conflicts[0]!.kind).toBe('delete_modified');
    const restored=run([sub('A',[deletion]),sub('B',[change])],{'B:0':{choice:'restore_and_apply'}},doc,doc);expect(restored.publishable).toBe(true);expect(restored.candidate.modules[0]!.blocks[0]).toMatchObject({rows:[{cells:{n_cccccccc:[{t:'New'}]}}]});
  });
  it('rejects ID collisions and requires explicit discard of an invalid combined structure',()=>{
    const collision=run([sub('A',[{op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:null,node:paragraph('n_aaaaaaaa')}])]);expect(collision.conflicts[0]!.kind).toBe('invalid_structure');expect(collision.candidate).toEqual(base);
    const doc=structuredClone(base);doc.modules[0]!.blocks=[{id:'n_aaaaaaaa',type:'cards',perRow:2,items:[{id:'n_cccccccc',title:'One',blocks:[]},{id:'n_dddddddd',title:'Two',blocks:[]},{id:'n_eeeeeeee',title:'Three',blocks:[]}]}];
    const deletions=['n_cccccccc','n_dddddddd'].map((target,i)=>sub(String(i),[{op:'delete',target,beforeHash:subtreeHash(doc,target)!}]));
    const result=run(deletions,{},doc,doc);expect(result.publishable).toBe(false);expect(result.conflicts[0]!.kind).toBe('invalid_structure');expect(result.items[1]!.status).toBe('needs_resolution');
    expect(run(deletions,{[result.conflicts[0]!.id]:{choice:'drop'}},doc,doc).publishable).toBe(true);
  });
  it('accepts a valid final container even when an intermediate operation is incomplete',()=>{
    const doc=structuredClone(base);doc.modules[0]!.blocks=[];
    const raw:Op[]=[{op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:null,node:{id:'tmp_cards',type:'cards',perRow:2,items:[]}},{op:'insert',parent:{id:'tmp_cards',list:'items'},after:null,node:{id:'tmp_first',title:'A',blocks:[]}},{op:'insert',parent:{id:'tmp_cards',list:'items'},after:'tmp_first',node:{id:'tmp_second',title:'B',blocks:[]}}];
    const normalized=applyOpsStrict(doc,raw,createCounterIdSource());expect(normalized.ok).toBe(true);if(!normalized.ok)return;
    const result=run([sub('A',normalized.value.ops)],{},doc,doc);expect(result.publishable).toBe(true);expect(result.candidate).toEqual(normalized.value.doc);
  });
  it('invalidates restoration after structural context changes and never duplicates a moved descendant',()=>{
    const doc=structuredClone(base);doc.modules[0]!.blocks=[{id:'n_aaaaaaaa',type:'cards',perRow:2,items:[{id:'n_cccccccc',title:'Card',blocks:[paragraph('n_eeeeeeee')]},{id:'n_dddddddd',title:'Other',blocks:[]}]}];
    const current=structuredClone(doc);current.modules[0]!.blocks=[];
    const submission=sub('A',[{op:'set',at:{id:'n_cccccccc',field:'title'},before:'Card',after:'Edited'}]);
    const conflict=run([submission],{},current,doc).conflicts[0]!;const resolution={choice:'restore_and_apply' as const,fingerprint:conflict.fingerprint};
    const moved=structuredClone(current);moved.modules[1]!.blocks.push(paragraph('n_eeeeeeee'));
    const stale=run([submission],{'A:0':resolution},moved,doc);expect(stale.publishable).toBe(false);expect(stale.candidate).toEqual(moved);
    expect(()=>run([submission],{'A:0':{choice:'restore_and_apply'}},moved,doc)).toThrow('duplicate a moved descendant');expect(moved.modules[0]!.blocks).toEqual([]);
  });
  it('AT-06 drops inserted row references to a discarded column and preserves unrelated deletions ' +
     'during restore',()=>{
    const doc=structuredClone(base);doc.modules[0]!.blocks=[{id:'n_aaaaaaaa',type:'table',caption:'',columns:[{id:'n_cccccccc',header:[],align:'left'},{id:'n_ffffffff',header:[],align:'left'}],rows:[{id:'n_dddddddd',cells:{n_cccccccc:[{t:'Old'}],n_ffffffff:[{t:'Other'}]}}]}];
    const dependent=sub('A',[{op:'insert',parent:{id:'n_aaaaaaaa',list:'columns'},after:null,node:{id:'n_eeeeeeee',header:[],align:'left'},uncertain:true},{op:'insert',parent:{id:'n_aaaaaaaa',list:'rows'},after:null,node:{id:'n_gggggggg',cells:{n_eeeeeeee:[{t:'Value'}]}}}]);
    const dropped=run([dependent],{'A:0':{choice:'drop'}},doc,doc);expect(dropped.items[0]!.ops[1]!.note).toBe('dependency_dropped');expect(dropped.candidate).toEqual(doc);
    const deleted=structuredClone(doc);const table=deleted.modules[0]!.blocks[0]!;if(table.type!=='table')throw new Error();table.columns=[];table.rows[0]!.cells={};
    const restored=run([sub('A',[{op:'set',at:{id:'n_dddddddd',field:'cell:n_cccccccc'},before:[{t:'Old'}],after:[{t:'Edited'}]}])],{'A:0':{choice:'restore_and_apply'}},deleted,doc);
    expect(restored.publishable).toBe(true);expect(restored.candidate.modules[0]!.blocks[0]).toMatchObject({columns:[{id:'n_cccccccc'}],rows:[{cells:{n_cccccccc:[{t:'Edited'}]}}]});
  });
  it('AT-06 refuses concurrent row insertion when its referenced column was deleted instead of ' +
     'silently losing the cell',()=>{
    const doc=structuredClone(base);doc.modules[0]!.blocks=[{id:'n_aaaaaaaa',type:'table',caption:'',columns:[{id:'n_cccccccc',header:[],align:'left'}],rows:[]}];
    const submissions=[sub('A',[{op:'delete',target:'n_cccccccc',beforeHash:subtreeHash(doc,'n_cccccccc')!}]),sub('B',[{op:'insert',parent:{id:'n_aaaaaaaa',list:'rows'},after:null,node:{id:'n_dddddddd',cells:{n_cccccccc:[{t:'Preserve me'}]}}}])];
    const result=run(submissions,{},doc,doc);expect(result.publishable).toBe(false);expect(result.conflicts[0]!.kind).toBe('invalid_structure');expect(result.candidate.modules[0]!.blocks[0]).toMatchObject({rows:[]});
  });
});
