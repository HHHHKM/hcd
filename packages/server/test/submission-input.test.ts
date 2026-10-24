import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { serializeModule } from '../../core/src/spec-html';
import type { Document } from '../../core/src/model';
const origin='http://localhost:5173'; const docId='d_aaaaaaab';
describe('operation and module HTML submissions', () => {
  let app: FastifyInstance; let db: HcdDatabase; let cookie: string; let token: string; let content: Document;
  const human=()=>({cookie,origin,'x-hcd-request':'1'}); const bearer=()=>({authorization:`Bearer ${token}`,'x-hcd-request':'1'});
  const submit=(body: Record<string,unknown>,key:string=crypto.randomUUID())=>app.inject({method:'POST',url:`/api/v1/docs/${docId}/submissions`,headers:{...bearer(),'idempotency-key':key},payload:{baseVersion:1,...body}});
  beforeEach(async()=>{ db=openDatabase(':memory:'); app=createApp({db,secretKey:'submission-input-test',appUrl:origin,renderUrl:'https://render.test',exports:{autoStart:false},seed:true}); await app.ready();
    cookie=String((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin,'x-hcd-request':'1'},payload:{email:'d@example.com',password:'hcd-demo-2026'}})).headers['set-cookie']).split(';')[0]!;
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    token=(await app.inject({method:'POST',url:'/api/v1/me/tokens',headers:human(),payload:{scopes:['read','submit','preview','ai_tasks']}})).json().token;
    content=(await app.inject({url:`/api/v1/docs/${docId}`,headers:human()})).json().content;
  });
  afterEach(async()=>{await app.close();db.close();});
  it('AT-05 strictly applies operations and returns identical generated IDs after retries and ' +
     'concurrent requests',async()=>{
    const ops=[{op:'set',at:{id:content.modules[0]!.id,field:'title'},before:content.modules[0]!.title,after:'Updated'}, {op:'insert',parent:{id:content.modules[0]!.id,list:'blocks'},after:null,node:{id:'tmp_new',type:'paragraph',text:[{t:'New paragraph'}]}}, {op:'set',at:{id:'tmp_new',field:'text'},before:[{t:'New paragraph'}],after:[{t:'New content'}]}];
    const responses=await Promise.all([submit({ops},'repeat'),submit({ops},'repeat')]); expect(responses.map(r=>r.statusCode).sort()).toEqual([200,201]);
    const first=responses[0]!.json(); expect(responses[1]!.json()).toEqual(first); expect(first.idMap.tmp_new).toMatch(/^n_[a-z2-7]{8}$/); expect(first.opCount).toBe(3); expect(first.submission.content.modules[0].blocks[0].text).toEqual([{t:'New content'}]);
    db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    expect((await submit({ops},'repeat')).json()).toEqual(first);
    expect((await submit({ops,message:'Changed'},'repeat')).statusCode).toBe(409);
    expect(db.prepare("SELECT COUNT(*) count FROM submissions WHERE idempotency_key='repeat'").get()).toEqual({count:1});
  });
  it('AT-05 preserves the original full-JSON normalized-hash retry contract for pre-migration ' +
     'submissions',async()=>{
    const next=structuredClone(content);next.title='Legacy';const first=await submit({content:next},'legacy');expect(first.statusCode).toBe(201);
    db.prepare("UPDATE submissions SET request_hash=NULL WHERE idempotency_key='legacy'").run();
    expect((await submit({content:next},'legacy')).json().submissionId).toBe(first.json().submissionId);
    expect((await submit({ops:[]},'legacy')).statusCode).toBe(409);
  });
  it('AT-27 rejects invalid before values, duplicate temporary IDs, mixed inputs and uncertain ' +
     'caller labels atomically',async()=>{
    const before=db.prepare('SELECT COUNT(*) count FROM submissions').get();
    const bad=[{ops:[{op:'set',at:{id:content.modules[0]!.id,field:'title'},before:'Wrong',after:'New'}]}, {content,ops:[]}, {moduleHtml:[],ops:[]}, {ops:[{op:'set',at:{id:content.modules[0]!.id,field:'title'},before:content.modules[0]!.title,after:'New',uncertain:true}]}, {ops:[0,1].map(()=>({op:'insert',parent:{id:content.modules[0]!.id,list:'blocks'},after:null,node:{id:'tmp_same',type:'paragraph',text:[]}}))}];
    for(const payload of bad) expect((await submit(payload)).statusCode).toBeGreaterThanOrEqual(400);
    expect(db.prepare('SELECT COUNT(*) count FROM submissions').get()).toEqual(before);
  });
  it('AT-27 updates a single HTML module while retaining other modules and recovering a missing ' +
     'block ID',async()=>{
    const module=structuredClone(content.modules[0]!); module.title+=' revised';const paragraph=module.blocks.find(block=>block.type==='paragraph');expect(paragraph).toBeTruthy();
    const html=serializeModule(module).replace(`data-id="${paragraph!.id}"`,'');
    const result=await submit({moduleHtml:[{moduleId:module.id,html}]});expect(result.statusCode,result.body).toBe(201);
    expect(result.json().submission.content.modules[0]).toEqual(module);expect(result.json().submission.content.modules.slice(1)).toEqual(content.modules.slice(1));expect(result.json().uncertainCount).toBe(0);
  });
  it('AT-27 inserts new HTML modules in request order after a common anchor and deletes only ' +
     'explicit modules',async()=>{
    const html=(title:string)=>`<section data-module><h2 data-role="module-title">${title}</h2><p>Fresh ${title}</p></section>`;
    const body={moduleHtml:[{html:html('First'),after:content.modules[0]!.id},{html:html('Second'),after:content.modules[0]!.id}],deleteModules:[content.modules.at(-1)!.id]};
    const created=await submit(body,'html-retry');expect(created.statusCode,created.body).toBe(201);
    expect(created.json().submission.content.modules.slice(0,3).map((module:{title:string})=>module.title)).toEqual([content.modules[0]!.title,'First','Second']);
    expect(created.json().submission.content.modules.some((module:{id:string})=>module.id===content.modules.at(-1)!.id)).toBe(false);
    expect((await submit(body,'html-retry')).json()).toEqual(created.json());expect(Object.keys(created.json().idMap).length).toBeGreaterThanOrEqual(4);
  });
  it('AT-27 rejects ambiguous module identity, foreign/duplicate nodes, multiple roots, scripts ' +
     'and unknown HTML',async()=>{
    const module=content.modules[0]!;const html=serializeModule(module);
    const bad=[{moduleHtml:[{moduleId:'m_zzzzzzzz',html}]},{moduleHtml:[{moduleId:content.modules[1]!.id,html}]},{moduleHtml:[{moduleId:module.id,html},{moduleId:module.id,html}]},{moduleHtml:[{moduleId:module.id,html}],deleteModules:[module.id]},{moduleHtml:[{html:html+html}]},{moduleHtml:[{html:html.replace('</section>','<script>alert(1)</script></section>')}]},{moduleHtml:[{html:'<section data-module><h2 data-role="module-title">X</h2><button>unknown</button></section>'}]},{moduleHtml:[{html:html.replace('</section>',`<p data-id="${module.blocks[0]!.id}">duplicate</p></section>`)}]},{moduleHtml:[{html:html.replace('</section>',`<p data-id="${content.modules[1]!.blocks[0]!.id}">borrowed</p></section>`)}]}];
    for(const body of bad) {const response=await submit(body);expect(response.statusCode,response.body).toBeGreaterThanOrEqual(400);}
  });
  it('AT-27 requires human confirmation of uncertain identity recovery before preview/export or ' +
     'publication',async()=>{
    // Isolate one known ten-character paragraph to make the confidence threshold explicit.
    const base=structuredClone(content);base.modules[0]!.blocks=[{id:'n_zzzzzzzz',type:'paragraph',text:[{t:'abcdefghij'}]}];
    db.prepare("UPDATE submissions SET status='withdrawn' WHERE doc_id=?").run(docId);
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base),docId);
    const html=`<section data-module data-id="${base.modules[0]!.id}"><h2 data-role="module-title">${base.modules[0]!.title}</h2><p>abcdezzzzz</p></section>`;
    const submitted=await submit({moduleHtml:[{html}]});expect(submitted.statusCode,submitted.body).toBe(201);expect(submitted.json().uncertainCount).toBe(1);
    const ids=[submitted.json().submissionId];
    const exported=await app.inject({method:'POST',url:`/api/v1/docs/${docId}/exports`,headers:human(),payload:{format:'html',version:1,includePending:true}});expect(exported.statusCode,exported.body).toBe(202);
    const job=db.prepare('SELECT snapshot,excluded_ids FROM exports WHERE id=?').get(exported.json().export.id) as {snapshot:string;excluded_ids:string};expect(JSON.parse(job.excluded_ids)).toContain(ids[0]);expect(JSON.parse(job.snapshot).modules[0].blocks).toEqual(base.modules[0]!.blocks);
    const readonly=await app.inject({method:'POST',url:`/api/v1/docs/${docId}/previews/prepare`,headers:bearer(),payload:{submissionIds:ids}});
    expect(readonly.json().preview.publishable).toBe(false);expect(readonly.json().preview.candidate).toEqual(base);
    const preview=(await app.inject({method:'POST',url:`/api/v1/docs/${docId}/previews`,headers:human(),payload:{submissionIds:ids}})).json().preview;
    expect((await app.inject({method:'POST',url:`/api/v1/previews/${preview.id}/publish`,headers:human(),payload:{revision:preview.revision}})).statusCode).toBe(409);
    const conflict=preview.conflicts[0];expect(conflict.kind).toBe('uncertain');
    expect((await app.inject({method:'POST',url:`/api/v1/previews/${preview.id}/conflicts/${encodeURIComponent(conflict.id)}/ai-suggest`,headers:human(),payload:{revision:preview.revision}})).statusCode).toBe(409);
    const resolved=await app.inject({method:'POST',url:`/api/v1/previews/${preview.id}/resolutions`,headers:human(),payload:{revision:preview.revision,conflictId:conflict.id,choice:'accept'}});expect(resolved.statusCode,resolved.body).toBe(200);expect(resolved.json().preview.publishable).toBe(true);
    expect((await app.inject({method:'POST',url:`/api/v1/previews/${preview.id}/publish`,headers:human(),payload:{revision:resolved.json().preview.revision}})).statusCode).toBe(200);
  });
  it('AT-23 enforces AI task scope for operations even when an out-of-scope change is reverted in ' +
     'the same request',async()=>{
    const task=(await app.inject({method:'POST',url:`/api/v1/docs/${docId}/comments`,headers:human(),payload:{body:'@[AI](ai) edit',anchor:{moduleId:content.modules[0]!.id}}})).json().aiTask;
    const claim=(await app.inject({method:'POST',url:`/api/v1/ai-tasks/${task.id}/claim`,headers:bearer(),payload:{}})).json();
    const unrelated=content.modules[1]!;
    const body={aiTaskId:task.id,claimId:claim.claimId,ops:[{op:'set',at:{id:unrelated.id,field:'title'},before:unrelated.title,after:'Changed'},{op:'set',at:{id:unrelated.id,field:'title'},before:'Changed',after:unrelated.title}]};
    const denied=await submit(body);expect(denied.statusCode).toBe(403);expect(denied.json().error.details.paths).toContain('/ops/0');
    const next=structuredClone(content.modules[0]!);next.title+=' valid';const accepted=await submit({aiTaskId:task.id,claimId:claim.claimId,moduleHtml:[{moduleId:next.id,html:serializeModule(next)}]});expect(accepted.statusCode,accepted.body).toBe(201);
  });
});
