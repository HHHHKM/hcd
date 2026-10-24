import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import type { Document } from '../../core/src/model';
import { subtreeHash, type Op } from '../../core/src/ops';
const origin='http://localhost:5173'; const docId='d_aaaaaaab';
const base:Document={schemaVersion:1,id:docId,title:'Review',theme:{id:'default',version:1,overrides:{}},modules:[{id:'m_aaaaaaaa',title:'Main',blocks:[{id:'n_aaaaaaaa',type:'paragraph',text:[{t:'abcdefghij'}]},{id:'n_bbbbbbbb',type:'paragraph',text:[{t:'klmnopqrst'}]}]},{id:'m_bbbbbbbb',title:'Other',blocks:[]}]};
describe('operation review integration',()=>{
  let app:FastifyInstance;let db:HcdDatabase;let cookie:string;let order:number;
  const headers=()=>({cookie,origin,'x-hcd-request':'1'});
  const request=(url:string,payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/v1'+url,headers:headers(),payload});
  beforeEach(async()=>{
    db=openDatabase(':memory:');app=createApp({db,seed:true,appUrl:origin,renderUrl:'https://render.test',exports:{autoStart:false}});await app.ready();order=0;cookie='';
    cookie=String((await request('/auth/login',{email:'d@example.com',password:'hcd-demo-2026'})).headers['set-cookie']).split(';')[0]!;
    db.prepare('DELETE FROM submissions').run();db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base),docId);db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
  });
  afterEach(async()=>{await app.close();db.close();});
  async function submit(input:Record<string,unknown>){const response=await app.inject({method:'POST',url:`/api/v1/docs/${docId}/submissions`,headers:{...headers(),'idempotency-key':crypto.randomUUID()},payload:{baseVersion:1,...input}});expect(response.statusCode,response.body).toBe(201);const id=response.json().submissionId as string;db.prepare('UPDATE submissions SET created_at=? WHERE id=?').run(`2026-10-23T00:00:${String(order++).padStart(2,'0')}Z`,id);return id;}
  async function preview(ids:string[]){const response=await request(`/docs/${docId}/previews`,{submissionIds:ids});expect(response.statusCode,response.body).toBe(200);return response.json().preview;}
  async function resolve(value:any,conflictId:string,choice:string,extra:Record<string,unknown>={}){return request(`/previews/${value.id}/resolutions`,{revision:value.revision,conflictId,choice,...extra});}
  const textOp=(text:string):Op=>({op:'set',at:{id:'n_aaaaaaaa',field:'text'},before:[{t:'abcdefghij'}],after:[{t:text}]});
  const html='<section data-module data-id="m_aaaaaaaa"><h2 data-role="module-title">Main</h2><p>abcdezzzzz</p><p>klmnozzzzz</p></section>';
  it('AT-27 accepts and drops individual uncertain operations, persists outcomes and publishes ' +
     'only the chosen content',async()=>{
    const id=await submit({moduleHtml:[{html}]});let view=await preview([id]);expect(view.conflicts).toHaveLength(2);expect(view.items[0].ops).toHaveLength(2);
    expect((await request(`/previews/${view.id}/publish`,{revision:view.revision})).statusCode).toBe(409);
    const accepted=await resolve(view,`${id}:0`,'accept');expect(accepted.statusCode,accepted.body).toBe(200);view=accepted.json().preview;expect(view.publishable).toBe(false);
    expect((await request(`/previews/${view.id}/conflicts/${encodeURIComponent(`${id}:1`)}/ai-suggest`,{revision:view.revision})).statusCode).toBe(409);
    const dropped=await resolve(view,`${id}:1`,'drop');expect(dropped.statusCode,dropped.body).toBe(200);view=dropped.json().preview;expect(view.publishable).toBe(true);
    expect(view.items[0].ops.map((op:any)=>op.outcome)).toEqual(['resolved','dropped']);
    const fetched=(await app.inject({url:`/api/v1/previews/${view.id}`,headers:headers()})).json().preview;expect(fetched.items).toEqual(view.items);
    const result=await request(`/previews/${view.id}/publish`,{revision:view.revision});expect(result.statusCode,result.body).toBe(200);expect(result.json().version.content.modules[0].blocks.map((block:any)=>block.text[0].t)).toEqual(['abcdezzzzz','klmnopqrst']);
    expect(JSON.parse((db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(docId) as {content:string}).content)).toEqual(base);
  });
  it('AT-03 reveals the ordinary conflict after accepting identity, validates manual input and ' +
     'leaves unresolved submissions out of exports',async()=>{
    const first=await submit({ops:[textOp('Concurrent')]});const incoming=await submit({moduleHtml:[{html}]});let view=await preview([incoming,first]);
    const accepted=await resolve(view,`${incoming}:0`,'accept');expect(accepted.statusCode,accepted.body).toBe(200);view=accepted.json().preview;expect(view.conflicts.some((c:any)=>c.id===`${incoming}:0:2` && c.kind==='text_overlap')).toBe(true);
    const before=JSON.stringify(view.candidate);const invalid=await resolve(view,`${incoming}:0:2`,'manual',{value:[{t:42}]});expect(invalid.statusCode).toBe(422);
    expect((await app.inject({url:`/api/v1/previews/${view.id}`,headers:headers()})).json().preview.revision).toBe(view.revision);
    const exported=await request(`/docs/${docId}/exports`,{format:'html',includePending:true});expect(exported.statusCode,exported.body).toBe(202);
    const job=db.prepare('SELECT snapshot,excluded_ids FROM exports WHERE id=?').get(exported.json().export.id) as {snapshot:string;excluded_ids:string};expect(JSON.parse(job.excluded_ids)).toEqual([incoming]);expect(JSON.parse(job.snapshot).modules[0].blocks[0].text).toEqual([{t:'Concurrent'}]);
    const resolved=await resolve(view,`${incoming}:0:2`,'manual',{value:[{t:'Chosen'}]});expect(resolved.statusCode,resolved.body).toBe(200);view=resolved.json().preview;expect(JSON.stringify(view.candidate)).toBe(before);
    view=(await resolve(view,`${incoming}:1`,'drop')).json().preview;expect(view.publishable).toBe(true);expect(view.candidate.modules[0].blocks[0].text).toEqual([{t:'Chosen'}]);
  });
  it('AT-03 invalidates a prior downstream resolution when an earlier choice changes and blocks ' +
     'direct publish',async()=>{
    const ids:string[]=[];for(const text of ['First','Second','Third'])ids.push(await submit({ops:[textOp(text)]}));let view=await preview(ids);
    view=(await resolve(view,`${ids[1]}:0`,'keep_current')).json().preview;
    view=(await resolve(view,`${ids[2]}:0`,'take_incoming')).json().preview;expect(view.publishable).toBe(true);
    view=(await resolve(view,`${ids[1]}:0`,'take_incoming')).json().preview;expect(view.publishable).toBe(false);expect(view.conflicts.find((c:any)=>c.id===`${ids[2]}:0`).resolution).toBeUndefined();
    const saved=JSON.parse((db.prepare('SELECT resolutions FROM previews WHERE id=?').get(view.id) as {resolutions:string}).resolutions);expect(saved[`${ids[2]}:0`]).toBeUndefined();
    expect((await request(`/previews/${view.id}/publish`,{revision:view.revision})).statusCode).toBe(409);
    const token=(await request('/me/tokens',{scopes:['read','submit','preview','ai_tasks']})).json().token;
    expect((await app.inject({method:'POST',url:`/api/v1/previews/${view.id}/resolutions`,headers:{authorization:`Bearer ${token}`,'x-hcd-request':'1'},payload:{revision:view.revision,conflictId:`${ids[2]}:0`,choice:'take_incoming'}})).statusCode).toBe(403);
  });
  it('AT-06 validates structural placement and restores deleted content through the owner API',async()=>{
    const deleted=await submit({ops:[{op:'delete',target:'m_aaaaaaaa',beforeHash:subtreeHash(base,'m_aaaaaaaa')!}]});
    const inserted=await submit({ops:[{op:'insert',parent:{id:'m_aaaaaaaa',list:'blocks'},after:null,node:{id:'tmp_new',type:'paragraph',text:[{t:'New'}]}}]});
    const edited=await submit({ops:[textOp('Restore me')]});let view=await preview([deleted,inserted,edited]);
    expect((await resolve(view,`${inserted}:0`,'place',{parent:{id:'n_bbbbbbbb',list:'blocks'},after:null})).statusCode).toBe(422);
    let response=await resolve(view,`${inserted}:0`,'place',{parent:{id:'m_bbbbbbbb',list:'blocks'},after:null});expect(response.statusCode,response.body).toBe(200);view=response.json().preview;
    response=await resolve(view,`${edited}:0`,'restore_and_apply');expect(response.statusCode,response.body).toBe(200);view=response.json().preview;expect(view.publishable).toBe(true);expect(view.candidate.modules[0].blocks[0].text).toEqual([{t:'New'}]);expect(view.candidate.modules[1].blocks[0].text).toEqual([{t:'Restore me'}]);
    expect((await request(`/previews/${view.id}/publish`,{revision:view.revision})).statusCode).toBe(200);
  });
  it('AT-04 recomputes publication and refuses a changed saved candidate',async()=>{
    const id=await submit({ops:[textOp('Legitimate')]});const view=await preview([id]);const changed=structuredClone(view.candidate);changed.title='Not reviewed';
    db.prepare('UPDATE previews SET candidate=? WHERE id=?').run(JSON.stringify(changed),view.id);
    const response=await request(`/previews/${view.id}/publish`,{revision:view.revision});expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe('PREVIEW_STALE');
    expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId)).toEqual({current_version:1});
  });
  it('rejects duplicate, oversized and no-longer-pending review selections',async()=>{
    const id=await submit({ops:[textOp('Change')]});
    expect((await request(`/docs/${docId}/previews`,{submissionIds:[id,id]})).statusCode).toBe(400);
    expect((await request(`/docs/${docId}/previews`,{submissionIds:Array.from({length:101},(_,i)=>`sub_${i}`)})).statusCode).toBe(400);
    await request(`/submissions/${id}/withdraw`,{});
    expect((await request(`/docs/${docId}/previews`,{submissionIds:[id]})).statusCode).toBe(409);
    expect(db.prepare('SELECT count(*) count FROM previews').get()).toEqual({count:0});
  });
  it('preserves insertion order across legacy full snapshots and operation submissions',async()=>{
    const content=structuredClone(base);content.modules.splice(1,0,{id:'m_cccccccc',title:'First',blocks:[]});
    const first=await submit({content});const second=await submit({ops:[{op:'insert',parent:{id:docId,list:'modules'},after:'m_aaaaaaaa',node:{id:'tmp_second',title:'Second',blocks:[]}}]});
    const view=await preview([second,first]);expect(view.publishable).toBe(true);expect(view.candidate.modules.map((module:any)=>module.title)).toEqual(['Main','First','Second','Other']);expect(view.items[1].ops[0].note).toBe('same_anchor_insert');
  });
  it('invalidates open reviews once when upgrading from the previous merge schema',async()=>{
    const id=await submit({ops:[textOp('Reviewed')]});const view=await preview([id]);
    const directory=await mkdtemp(join(tmpdir(),'hcd-merge-migration-'));const file=join(directory,'old.sqlite');
    try {
      db.exec('ALTER TABLE previews DROP COLUMN items');await db.backup(file);
      let reopened=openDatabase(file);
      try { expect(reopened.prepare('SELECT status,candidate,items FROM previews WHERE id=?').get(view.id)).toEqual({status:'stale',candidate:JSON.stringify(view.candidate),items:'[]'});reopened.prepare("UPDATE previews SET status='open' WHERE id=?").run(view.id); }
      finally {reopened.close();}
      reopened=openDatabase(file);try {expect(reopened.prepare('SELECT status FROM previews WHERE id=?').get(view.id)).toEqual({status:'open'});}finally{reopened.close();}
    } finally {await rm(directory,{recursive:true,force:true});}
  });
});
