import { mkdir, mkdtemp, readFile, rm, writeFile, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelWithReceipt, inspectSubmissionReceipts, submitWithReceipt, requestFingerprint, type SubmissionBody, type SubmissionStatus } from './submission-receipts';
import { createCounterIdSource, validateDocument, type Document } from '../../core/src/model';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const body={baseVersion:1,message:'Edit',content:{schemaVersion:1,id:'d_aaaaaaaa',title:'Doc',theme:{id:'default',version:1,overrides:{}},modules:[]}} satisfies SubmissionBody;
async function setup(){const root=await mkdtemp(join(tmpdir(),'hcd-receipt-'));roots.push(root);return{root,server:'http://localhost:3000',documentId:body.content.id,actorId:'u_original',fingerprint:requestFingerprint({html:'source'}),body};}
describe('durable CLI submission receipts',()=>{
  it('persists before sending and retries a lost response with identical payload and key',async()=>{
    const options=await setup();let firstKey='';let calls=0;
    const send=async(request:SubmissionBody,key:string)=>{calls++;const ledger=JSON.parse(await readFile(join(options.root,'.mdoc','submissions.json'),'utf8'));expect(ledger.entries[0].state).toBe('pending');expect(ledger.entries[0].authorId).toBe(options.actorId);expect(ledger.entries[0].body).toEqual(request);if(!firstKey){firstKey=key;throw new Error('Response lost after commit');}expect(key).toBe(firstKey);expect(request).toEqual(body);return{submission:{id:'sub_abcdefgh',docId:body.content.id,authorId:'u_original'}};};
    await expect(submitWithReceipt({...options,send})).rejects.toThrow('Response lost');
    expect(await submitWithReceipt({...options,body:{...body,content:{...body.content,title:'regenerated ID equivalent'}},send})).toBe('sub_abcdefgh');
    expect(await submitWithReceipt({...options,send})).toBe('sub_abcdefgh');expect(calls).toBe(2);
  });
  it('blocks newer work after an uncertain outcome and explicit retry sends only the frozen request',async()=>{
    const options=await setup();await expect(submitWithReceipt({...options,send:async()=>{throw new Error('offline');}})).rejects.toThrow('offline');
    const changed={...options,fingerprint:requestFingerprint({html:'newer source'}),body:{...body,message:'Newer'}};
    let sent=false;const send=async(request:SubmissionBody)=>{sent=true;expect(request).toEqual(body);return{submission:{id:'sub_abcdefgh',docId:body.content.id,authorId:'u_original'}};};
    await expect(submitWithReceipt({...changed,send})).rejects.toThrow('unknown outcome');expect(sent).toBe(false);
    expect(await submitWithReceipt({...changed,retry:true,send})).toBe('sub_abcdefgh');
    await expect(submitWithReceipt({...changed,retry:true,send})).rejects.toThrow('no pending submission');
  });
  it('serializes concurrent writers and keeps a corrupted receipt from silently causing duplicates',async()=>{
    const options=await setup();let release:()=>void=()=>{};let ready:()=>void=()=>{};const entered=new Promise<void>(resolve=>{ready=resolve;});
    const blocked=new Promise<void>(resolve=>{release=resolve;});const first=submitWithReceipt({...options,send:async()=>{ready();await blocked;return{submission:{id:'sub_abcdefgh',docId:body.content.id,authorId:'u_original'}};}});await entered;
    await expect(submitWithReceipt({...options,send:async()=>({submission:{id:'sub_otherone',docId:body.content.id,authorId:'u_original'}})})).rejects.toThrow('Another submit');release();await first;
    await writeFile(join(options.root,'.mdoc','submissions.json'),'broken');await expect(submitWithReceipt({...options,send:async()=>({submission:{id:'sub_otherone',docId:body.content.id,authorId:'u_original'}})})).rejects.toThrow('unreadable');
  });
  it('releases the process lock after SIGKILL and replays the durable request across processes',async()=>{
    const options=await setup();
    const script=`import { submitWithReceipt } from ${JSON.stringify(new URL('./submission-receipts.ts',import.meta.url).href)};
      await submitWithReceipt({...${JSON.stringify(options)},send:async()=>{process.send('locked');await new Promise(()=>{setInterval(()=>{},1000);});}});`;
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe','ipc']});
    let stderr='';child.stderr!.on('data',chunk=>{stderr+=String(chunk);});
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    try {
      await new Promise<void>((resolve,reject)=>{child.once('message',()=>resolve());child.once('error',reject);child.once('exit',()=>reject(new Error(`Submit worker exited early: ${stderr}`)));});
      await expect(submitWithReceipt({...options,send:async()=>({submission:{id:'sub_otherone',docId:body.content.id,authorId:'u_original'}})})).rejects.toThrow('Another submit');
      const saved=JSON.parse(await readFile(join(options.root,'.mdoc','submissions.json'),'utf8')).entries[0];
      child.kill('SIGKILL');await exited;
      expect(await submitWithReceipt({...options,send:async(request,key)=>{expect(request).toEqual(saved.body);expect(key).toBe(saved.key);return{submission:{id:'sub_abcdefgh',docId:body.content.id,authorId:'u_original'}};}})).toBe('sub_abcdefgh');
    } finally { if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');await exited; }
  },20_000);
  it('refuses symlinked ledgers and preserves legacy receipts when creating the new format',async()=>{
    const options=await setup();await expect(submitWithReceipt({...options,send:async()=>{throw new Error('offline');}})).rejects.toThrow();
    const file=join(options.root,'.mdoc','submissions.json');await writeFile(file,JSON.stringify([{id:'sub_legacyold',message:'Old'}]));
    await submitWithReceipt({...options,send:async()=>({submission:{id:'sub_abcdefgh',docId:body.content.id,authorId:'u_original'}})});expect(JSON.parse(await readFile(file,'utf8')).legacyReceipts).toEqual([{id:'sub_legacyold',message:'Old'}]);
    await rm(file);const external=join(options.root,'user-data');await writeFile(external,'keep');await symlink(external,file);
    await expect(submitWithReceipt({...options,send:async()=>({submission:{id:'sub_otherone',docId:body.content.id,authorId:'u_original'}})})).rejects.toThrow('regular file');expect(await readFile(external,'utf8')).toBe('keep');
  });
});

async function pendingReceipt() {
  const options = await setup();
  await expect(submitWithReceipt({ ...options, send: async () => { throw new Error('unknown outcome'); } })).rejects.toThrow('unknown outcome');
  const inspection = await inspectSubmissionReceipts(options.root);
  return { ...options, key: inspection.receipts[0]!.key };
}
const response = (status: SubmissionStatus, id = 'sub_abcdefgh', docId = body.content.id, authorId = 'u_original') => ({ submission: { id, docId, authorId, status } });
const noCall = async (): Promise<never> => { throw new Error('Unexpected network call'); };

describe('explicit receipt cancellation', () => {
  it('inspects without creating metadata or changing the ledger and excludes the document payload', async () => {
    const empty = await setup();
    expect(await inspectSubmissionReceipts(empty.root)).toEqual({ receipts: [], legacyReceiptCount: 0 });
    await expect(lstat(join(empty.root, '.mdoc'))).rejects.toMatchObject({ code: 'ENOENT' });
    const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json'); const before = await readFile(path, 'utf8');
    const inspected = await inspectSubmissionReceipts(options.root);
    expect(inspected.receipts[0]).toMatchObject({ key: options.key, state: 'pending', baseVersion: 1, message: 'Edit' });
    expect(inspected.receipts[0]).not.toHaveProperty('body'); expect(inspected.receipts[0]).not.toHaveProperty('content');
    expect(await readFile(path, 'utf8')).toBe(before);
    await writeFile(path, JSON.stringify([{ id: 'sub_legacyold' }]));
    expect(await inspectSubmissionReceipts(options.root)).toEqual({ receipts: [], legacyReceiptCount: 1 });
  });

  it('persists cancellation before recovering the exact frozen request and confirms withdrawal before settling', async () => {
    const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json');
    const original = JSON.parse(await readFile(path, 'utf8')).entries[0];
    const calls: string[] = [];
    const result = await cancelWithReceipt({ ...options,
      recover: async (request, key) => {
        calls.push('recover'); const saved = JSON.parse(await readFile(path, 'utf8')).entries[0];
        expect(saved.state).toBe('cancelling'); expect(saved.cancellationRequestedAt).toBeTruthy();
        expect(request).toEqual(original.body); expect(key).toBe(original.key);
        if (!request.content) throw new Error('Expected content fixture');
        request.content.title = 'A callback cannot mutate the frozen receipt';
        return response('pending');
      },
      read: async id => { calls.push('read'); expect(id).toBe('sub_abcdefgh'); expect(JSON.parse(await readFile(path, 'utf8')).entries[0]).toMatchObject({ submissionId: id, state: 'cancelling', body: original.body }); return response('pending'); },
      withdraw: async id => { calls.push('withdraw'); expect(id).toBe('sub_abcdefgh'); return response('withdrawn'); },
    });
    expect(calls).toEqual(['recover', 'read', 'withdraw']); expect(result).toEqual({ key: options.key, submissionId: 'sub_abcdefgh', status: 'withdrawn' });
    const final = JSON.parse(await readFile(path, 'utf8')).entries[0];
    expect(final).toMatchObject({ state: 'cancelled', key: original.key, body: original.body, fingerprint: original.fingerprint, submissionId: 'sub_abcdefgh', serverStatus: 'withdrawn' }); expect(final.cancelledAt).toBeTruthy();
    expect(await cancelWithReceipt({ ...options, recover: noCall, read: noCall, withdraw: noCall })).toEqual(result);
    await expect(submitWithReceipt({ ...options, send: noCall })).rejects.toThrow('exact request was cancelled');
    expect(await submitWithReceipt({ ...options, fingerprint: requestFingerprint('new content'), body: { ...body, message: 'A new explicit request' }, send: async () => ({ submission: { id: 'sub_newoneaa', docId: body.content.id, authorId: 'u_original' } }) })).toBe('sub_newoneaa');
  });

  it('keeps an unrecoverable request unresolved and blocks normal submit and submit retry', async () => {
    const options = await pendingReceipt(); const recover = vi.fn(async () => { throw new Error('VALIDATION_FAILED'); });
    await expect(cancelWithReceipt({ ...options, recover, read: noCall, withdraw: noCall })).rejects.toThrow('VALIDATION_FAILED');
    const record = (await inspectSubmissionReceipts(options.root)).receipts[0]!;
    expect(record).toMatchObject({ key: options.key, state: 'cancelling' }); expect(record.submissionId).toBeUndefined();
    for (const retry of [false, true]) await expect(submitWithReceipt({ ...options, retry, fingerprint: requestFingerprint('new'), send: noCall })).rejects.toThrow('Cancellation has an unknown outcome');
    await expect(cancelWithReceipt({ ...options, recover, read: noCall, withdraw: noCall })).rejects.toThrow('VALIDATION_FAILED');
    expect(recover).toHaveBeenCalledTimes(2); expect(recover.mock.calls[0]).toEqual(recover.mock.calls[1]);
  });

  it('cancels an older submitted receipt without replaying it and preserves the legacy receipt list', async () => {
    const options = await setup(); await submitWithReceipt({ ...options, send: async () => response('pending') });
    const path = join(options.root, '.mdoc', 'submissions.json'); const ledger = JSON.parse(await readFile(path, 'utf8'));
    ledger.legacyReceipts = [{ id: 'sub_legacyold', message: 'Original legacy list' }]; await writeFile(path, JSON.stringify(ledger));
    const result = await cancelWithReceipt({ ...options, key: ledger.entries[0].key, recover: noCall, read: async () => response('pending'), withdraw: async () => response('withdrawn') });
    expect(result.status).toBe('withdrawn');
    expect(JSON.parse(await readFile(path, 'utf8')).legacyReceipts).toEqual(ledger.legacyReceipts);
    expect((await inspectSubmissionReceipts(options.root)).legacyReceiptCount).toBe(1);
  });

  it('never treats an inaccessible or missing submission as successful cancellation', async () => {
    for (const status of [403, 404]) {
      const options = await pendingReceipt(); const read = vi.fn(async () => { throw new Error(`HTTP ${status}`); });
      await expect(cancelWithReceipt({ ...options, recover: async () => response('pending'), read, withdraw: noCall })).rejects.toThrow(`HTTP ${status}`);
      expect((await inspectSubmissionReceipts(options.root)).receipts[0]).toMatchObject({ state: 'cancelling', submissionId: 'sub_abcdefgh' });
      await expect(cancelWithReceipt({ ...options, recover: noCall, read, withdraw: noCall })).rejects.toThrow(`HTTP ${status}`);
    }
  });

  it('recovers a lost withdrawal response by reading the same submission and does not withdraw twice', async () => {
    const options = await pendingReceipt(); let status: SubmissionStatus = 'pending'; const withdraw = vi.fn(async () => { status = 'withdrawn'; throw new Error('Response lost'); });
    expect(await cancelWithReceipt({ ...options, recover: async () => response('pending'), read: async () => response(status), withdraw })).toMatchObject({ status: 'withdrawn' });
    expect(withdraw).toHaveBeenCalledTimes(1); expect((await inspectSubmissionReceipts(options.root)).receipts[0]!.state).toBe('cancelled');
  });

  it('returns published or rejected without falsely recording a cancellation, including a publication race', async () => {
    for (const status of ['published', 'rejected'] as const) {
      const options = await pendingReceipt();
      expect(await cancelWithReceipt({ ...options, recover: async () => response(status), read: async () => response(status), withdraw: noCall })).toMatchObject({ status });
      expect((await inspectSubmissionReceipts(options.root)).receipts[0]).toMatchObject({ state: 'submitted', serverStatus: status });
      expect(await submitWithReceipt({ ...options, send: noCall })).toBe('sub_abcdefgh');
    }
    const raced = await pendingReceipt(); let status: SubmissionStatus = 'pending';
    expect(await cancelWithReceipt({ ...raced, recover: async () => response('pending'), read: async () => response(status), withdraw: async () => { status = 'published'; throw new Error('SUBMISSION_STATE_CONFLICT'); } })).toMatchObject({ status: 'published' });
    expect((await inspectSubmissionReceipts(raced.root)).receipts[0]!.state).toBe('submitted');
  });

  it('validates document and submission identities at recovery, read, and withdrawal boundaries', async () => {
    for (const phase of ['recover', 'read', 'withdraw'] as const) {
      const options = await pendingReceipt();
      const wrong = phase === 'recover' ? response('pending', 'sub_abcdefgh', 'd_bbbbbbbb') : phase === 'read' ? response('pending', 'sub_wrongone') : response('withdrawn', 'sub_abcdefgh', 'd_bbbbbbbb');
      await expect(cancelWithReceipt({ ...options, recover: async () => phase === 'recover' ? wrong : response('pending'), read: async () => phase === 'read' ? wrong : response('pending'), withdraw: async () => wrong })).rejects.toThrow('mismatched cancellation receipt');
      expect((await inspectSubmissionReceipts(options.root)).receipts[0]!.state).toBe('cancelling');
    }
  });

  it('uses the existing process lock and rejects a receipt from another destination before making changes', async () => {
    const options = await pendingReceipt(); const before = await readFile(join(options.root, '.mdoc', 'submissions.json'), 'utf8');
    await expect(cancelWithReceipt({ ...options, server: 'http://different.test', recover: noCall, read: noCall, withdraw: noCall })).rejects.toThrow('another document or server');
    expect(await readFile(join(options.root, '.mdoc', 'submissions.json'), 'utf8')).toBe(before);
    let release!: () => void; let entered!: () => void; const ready = new Promise<void>(done => { entered = done; }); const block = new Promise<void>(done => { release = done; });
    const first = cancelWithReceipt({ ...options, recover: async () => { entered(); await block; return response('pending'); }, read: async () => response('pending'), withdraw: async () => response('withdrawn') });
    await ready;
    await expect(cancelWithReceipt({ ...options, recover: noCall, read: noCall, withdraw: noCall })).rejects.toThrow('Another submit');
    await expect(submitWithReceipt({ ...options, send: noCall })).rejects.toThrow('Another submit');
    release(); await first;
  });

  it('rejects contradictory or duplicated receipt states instead of silently allowing another send', async () => {
    const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json'); const original = JSON.parse(await readFile(path, 'utf8'));
    const malformed = [
      { ...original.entries[0], state: 'cancelled', submissionId: 'sub_abcdefgh' },
      { ...original.entries[0], state: 'cancelling' },
      { ...original.entries[0], state: 'submitted', submissionId: 'sub_abcdefgh', serverStatus: 'withdrawn' },
      { ...original.entries[0], createdAt: 'broken' },
    ];
    for (const entry of malformed) { await writeFile(path, JSON.stringify({ version: 2, entries: [entry] })); await expect(inspectSubmissionReceipts(options.root)).rejects.toThrow('invalid'); await expect(submitWithReceipt({ ...options, send: noCall })).rejects.toThrow('invalid'); }
    await writeFile(path, JSON.stringify({ ...original, entries: [original.entries[0], original.entries[0]] })); await expect(inspectSubmissionReceipts(options.root)).rejects.toThrow('invalid');
    await writeFile(path, JSON.stringify({ ...original, entries: [original.entries[0], { ...original.entries[0], key: 'a-distinct-pending-key' }] })); await expect(inspectSubmissionReceipts(options.root)).rejects.toThrow('invalid');
  });

  it('survives process death before recovery completes and after withdrawal commits without issuing a new key', async () => {
    for (const phase of ['recover', 'withdraw'] as const) {
      const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json'); const saved = JSON.parse(await readFile(path, 'utf8')).entries[0];
      const marker = join(options.root, 'fake-server-withdrawn');
      const script = `import { cancelWithReceipt } from ${JSON.stringify(new URL('./submission-receipts.ts', import.meta.url).href)};
        import { writeFile } from 'node:fs/promises';
        const response = status => ({submission:{id:'sub_abcdefgh',docId:${JSON.stringify(options.documentId)},authorId:${JSON.stringify(options.actorId)},status}});
        const hang = async () => {process.send('locked');await new Promise(()=>{setInterval(()=>{},1000);});};
        await cancelWithReceipt({...${JSON.stringify(options)},recover:async(body,key)=>{${phase === 'recover' ? 'await hang();' : ''}return response('pending');},read:async()=>response('pending'),withdraw:async()=>{${phase === 'withdraw' ? `await writeFile(${JSON.stringify(marker)},'withdrawn');await hang();` : ''}return response('withdrawn');}});`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stderr = ''; child.stderr!.on('data', chunk => { stderr += String(chunk); }); const exited = new Promise<void>(done => child.once('exit', () => done()));
      try {
        await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error(`Cancel worker exited early: ${stderr}`))); });
        await expect(submitWithReceipt({ ...options, send: noCall })).rejects.toThrow('Another submit');
        expect(JSON.parse(await readFile(path, 'utf8')).entries[0]).toMatchObject({ state: 'cancelling', body: saved.body, key: saved.key });
        child.kill('SIGKILL'); await exited;
        const recover = vi.fn(async (request: SubmissionBody, key: string) => { expect(request).toEqual(saved.body); expect(key).toBe(saved.key); return response('pending'); });
        const result = await cancelWithReceipt({ ...options, recover, read: async () => response(phase === 'withdraw' ? await readFile(marker, 'utf8') as 'withdrawn' : 'pending'), withdraw: phase === 'withdraw' ? noCall : async () => response('withdrawn') });
        expect(result.status).toBe('withdrawn'); expect(recover).toHaveBeenCalledTimes(phase === 'recover' ? 1 : 0);
        expect(JSON.parse(await readFile(path, 'utf8')).entries[0]).toMatchObject({ state: 'cancelled', body: saved.body, key: saved.key });
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
    }
  }, 20_000);
});

describe('receipt account binding', () => {
  it('blocks a changed account before replaying, cancelling, or rewriting the original receipt', async () => {
    const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json'); const original = await readFile(path, 'utf8');
    for (const retry of [true, false]) await expect(submitWithReceipt({ ...options, actorId: 'u_other', retry, send: noCall })).rejects.toThrow('another account');
    await expect(cancelWithReceipt({ ...options, actorId: 'u_other', recover: noCall, read: noCall, withdraw: noCall })).rejects.toThrow('another account');
    expect(await readFile(path, 'utf8')).toBe(original);
    await submitWithReceipt({ ...options, send: async () => response('pending') });
    const submitted = await readFile(path, 'utf8');
    await expect(submitWithReceipt({ ...options, actorId: 'u_other', send: noCall })).rejects.toThrow('another account');
    await expect(cancelWithReceipt({ ...options, actorId: 'u_other', recover: noCall, read: noCall, withdraw: noCall })).rejects.toThrow('another account');
    expect(await readFile(path, 'utf8')).toBe(submitted);
  });

  it('never infers the author of an old unknown-outcome request from the currently signed-in account', async () => {
    for (const state of ['pending', 'cancelling'] as const) {
      const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json'); const ledger = JSON.parse(await readFile(path, 'utf8')); const entry = ledger.entries[0];
      delete entry.authorId; entry.state = state; if (state === 'cancelling') entry.cancellationRequestedAt = new Date().toISOString();
      await writeFile(path, JSON.stringify(ledger)); const before = await readFile(path, 'utf8');
      expect((await inspectSubmissionReceipts(options.root)).receipts[0]!.authorId).toBeUndefined();
      await expect(submitWithReceipt({ ...options, retry: true, send: noCall })).rejects.toThrow('no recorded author');
      await expect(cancelWithReceipt({ ...options, recover: noCall, read: noCall, withdraw: noCall })).rejects.toThrow('no recorded author');
      expect(await readFile(path, 'utf8')).toBe(before);
    }
  });

  it('binds a legacy known submission only after a read proves the original account and refuses blind normal submit', async () => {
    const options = await setup(); await submitWithReceipt({ ...options, send: async () => response('pending') });
    const path = join(options.root, '.mdoc', 'submissions.json'); const ledger = JSON.parse(await readFile(path, 'utf8')); delete ledger.entries[0].authorId; await writeFile(path, JSON.stringify(ledger));
    const before = await readFile(path, 'utf8'); const key = ledger.entries[0].key;
    await expect(submitWithReceipt({ ...options, send: noCall })).rejects.toThrow('no recorded author'); expect(await readFile(path, 'utf8')).toBe(before);
    const read = vi.fn(async () => { expect(await readFile(path, 'utf8')).toBe(before); return response('pending'); });
    const result = await cancelWithReceipt({ ...options, key, recover: noCall, read, withdraw: async () => {
      expect(JSON.parse(await readFile(path, 'utf8')).entries[0]).toMatchObject({ authorId: options.actorId, state: 'cancelling', key, body: ledger.entries[0].body }); return response('withdrawn');
    } });
    expect(result.status).toBe('withdrawn'); expect(read).toHaveBeenCalledTimes(1);
    expect((await inspectSubmissionReceipts(options.root)).receipts[0]).toMatchObject({ authorId: options.actorId, state: 'cancelled' });
  });

  it('leaves an unbound known receipt untouched when the read identifies another account or fails', async () => {
    const options = await setup(); await submitWithReceipt({ ...options, send: async () => response('pending') });
    const path = join(options.root, '.mdoc', 'submissions.json'); const ledger = JSON.parse(await readFile(path, 'utf8')); delete ledger.entries[0].authorId; await writeFile(path, JSON.stringify(ledger));
    const before = await readFile(path, 'utf8'); const key = ledger.entries[0].key;
    await expect(cancelWithReceipt({ ...options, key, actorId: 'u_other', recover: noCall, read: async () => response('pending'), withdraw: noCall })).rejects.toThrow('mismatched cancellation receipt');
    expect(await readFile(path, 'utf8')).toBe(before);
    await expect(cancelWithReceipt({ ...options, key, recover: noCall, read: async () => { throw new Error('HTTP 403'); }, withdraw: noCall })).rejects.toThrow('HTTP 403');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('checks the author on submit, recovery, read, and withdrawal responses', async () => {
    const submit = await setup();
    await expect(submitWithReceipt({ ...submit, send: async () => response('pending', 'sub_abcdefgh', body.content.id, 'u_other') })).rejects.toThrow('mismatched submission receipt');
    expect((await inspectSubmissionReceipts(submit.root)).receipts[0]).toMatchObject({ authorId: submit.actorId, state: 'pending' });
    for (const phase of ['recover', 'read', 'withdraw'] as const) {
      const options = await pendingReceipt(); const other = response(phase === 'withdraw' ? 'withdrawn' : 'pending', 'sub_abcdefgh', body.content.id, 'u_other');
      await expect(cancelWithReceipt({ ...options, recover: async () => phase === 'recover' ? other : response('pending'), read: async () => phase === 'read' ? other : response('pending'), withdraw: async () => other })).rejects.toThrow('mismatched cancellation receipt');
      expect((await inspectSubmissionReceipts(options.root)).receipts[0]).toMatchObject({ authorId: options.actorId, state: 'cancelling' });
    }
  });
});

describe('frozen native submission formats', () => {
  const operations: SubmissionBody = { baseVersion: 7, message: 'Native operation request', ops: [
    { op: 'insert', parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null, node: { id: 'tmp_note', type: 'paragraph', text: [{ t: '  preserved  ' }, { t: ' spacing ', b: true }] } },
    { op: 'set', at: { id: 'tmp_note', field: 'text' }, before: [{ t: '  preserved  ' }, { t: ' spacing ', b: true }], after: [{ t: 'Final  text ' }, { br: true }] },
  ] };
  const moduleHtml: SubmissionBody = { baseVersion: 9, message: 'Module request', moduleHtml: [
    { moduleId: 'm_aaaaaaaa', html: '<section data-module data-id="m_aaaaaaaa">\n  <h2 data-role="module-title">Title</h2>\n<p data-id="n_aaaaaaaa">  A &amp; B  </p>\n</section>' },
    { html: '<section data-module>\n<h2 data-role="module-title">New</h2>\n<p>Fresh node</p></section>', after: null },
  ], deleteModules: ['m_cccccccc', 'm_bbbbbbbb'] };

  it('freezes operations and temporary IDs without transforming inline runs, even when the next attempt uses another wire shape', async () => {
    const options = await setup(); const expected = structuredClone(operations); let key = '';
    await expect(submitWithReceipt({ ...options, body: operations, send: async (request, receiptKey) => {
      key = receiptKey;
      const saved = JSON.parse(await readFile(join(options.root, '.mdoc', 'submissions.json'), 'utf8')).entries[0];
      expect(saved.body).toEqual(expected); expect(saved.body).not.toHaveProperty('content'); expect(saved.authorId).toBe(options.actorId);
      if (!request.ops || request.ops[0]!.op !== 'insert') throw new Error('Expected operations');
      request.ops[0]!.node.id = 'tmp_callback_mutation';
      throw new Error('Response lost');
    } })).rejects.toThrow('Response lost');
    expect(await submitWithReceipt({ ...options, body: moduleHtml, retry: true, send: async (request, receiptKey) => {
      expect(request).toEqual(expected); expect(receiptKey).toBe(key); return response('pending');
    } })).toBe('sub_abcdefgh');
    expect(JSON.parse(await readFile(join(options.root, '.mdoc', 'submissions.json'), 'utf8')).entries[0].body).toEqual(expected);
  });

  it('recovers and cancels exact module HTML with original whitespace, ordering, deletion list and insertion anchors', async () => {
    const options = await setup(); const expected = structuredClone(moduleHtml);
    await expect(submitWithReceipt({ ...options, body: moduleHtml, send: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    const receipt = (await inspectSubmissionReceipts(options.root)).receipts[0]!;
    expect(receipt).toMatchObject({ baseVersion: 9, message: 'Module request' }); expect(receipt).not.toHaveProperty('moduleHtml');
    expect(await cancelWithReceipt({ ...options, key: receipt.key, recover: async (request, key) => {
      expect(request).toEqual(expected); expect(key).toBe(receipt.key); expect(JSON.stringify(request)).toBe(JSON.stringify(expected));
      if (!request.moduleHtml) throw new Error('Expected module HTML'); request.moduleHtml[0]!.html = 'Callback mutation';
      return response('pending');
    }, read: async () => response('pending'), withdraw: async () => response('withdrawn') })).toMatchObject({ status: 'withdrawn' });
    expect(JSON.parse(await readFile(join(options.root, '.mdoc', 'submissions.json'), 'utf8')).entries[0].body).toEqual(expected);
  });

  it('rejects mutually exclusive or malformed stored formats without sending or repairing them', async () => {
    const options = await pendingReceipt(); const path = join(options.root, '.mdoc', 'submissions.json'); const original = JSON.parse(await readFile(path, 'utf8'));
    const malformed: unknown[] = [
      { ...body, ops: operations.ops }, { ...body, moduleHtml: moduleHtml.moduleHtml }, { ...operations, moduleHtml: moduleHtml.moduleHtml },
      { baseVersion: 1, message: 'No format' }, { ...operations, deleteModules: [] }, { ...body, extra: 'unknown field' },
      { ...operations, ops: [{ op: 'set', at: { id: 'n_aaaaaaaa', field: 'text' }, before: [], after: [], uncertain: true }] },
      { ...operations, ops: [{ op: 'delete', target: 'n_aaaaaaaa', beforeHash: 'invalid-hash' }] },
      { ...operations, ops: Array.from({ length: 501 }, () => operations.ops![0]) },
      { ...moduleHtml, moduleHtml: [{ html: '<section/>', moduleId: 'bad-id' }] },
      { ...moduleHtml, moduleHtml: [{ html: '<section/>', after: 'bad-id' }] },
      { ...moduleHtml, moduleHtml: [{ html: '<section/>', extra: true }] },
      { ...moduleHtml, moduleHtml: [{ html: '' }] }, { ...moduleHtml, moduleHtml: [{ html: 'x'.repeat(500_001) }] },
      { ...moduleHtml, deleteModules: ['bad-id'] }, { ...moduleHtml, deleteModules: Array(101).fill('m_aaaaaaaa') },
      { ...moduleHtml, moduleHtml: Array(101).fill({ html: '<section/>' }) }, { ...body, content: { ...body.content, id: 'd_bbbbbbbb' } },
    ];
    for (const invalid of malformed) {
      const saved = JSON.stringify({ ...original, entries: [{ ...original.entries[0], body: invalid }] }); await writeFile(path, saved);
      await expect(inspectSubmissionReceipts(options.root)).rejects.toThrow('invalid');
      await expect(submitWithReceipt({ ...options, retry: true, send: noCall })).rejects.toThrow('invalid');
      expect(await readFile(path, 'utf8')).toBe(saved);
    }
  });

  it('rejects non-JSON request values before persisting a payload that would change during serialization', async () => {
    const values: unknown[] = [
      { ...moduleHtml, moduleHtml: [{ html: '<section/>', moduleId: undefined }] },
      { ...operations, ops: [{ op: 'insert', parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null, node: { id: 'tmp_bad', value: Number.NaN } }] },
      { ...operations, ops: [{ op: 'insert', parent: { id: 'm_aaaaaaaa', list: 'blocks' }, after: null, node: { id: 'tmp_bad', value: new Date('2026-10-23T00:00:00Z') } }] },
    ];
    for (const invalid of values) {
      const options = await setup();
      await expect(submitWithReceipt({ ...options, body: invalid as SubmissionBody, send: noCall })).rejects.toThrow('valid receipt');
      await expect(readFile(join(options.root, '.mdoc', 'submissions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('retains valid empty operations and deletion-only module requests accepted by the current wire schema', async () => {
    for (const request of [{ baseVersion: 1, message: '', ops: [] }, { baseVersion: 1, message: '', moduleHtml: [], deleteModules: ['m_aaaaaaaa'] }] satisfies SubmissionBody[]) {
      const options = await setup();
      await submitWithReceipt({ ...options, body: request, send: async frozen => { expect(frozen).toEqual(request); return response('pending'); } });
      expect(JSON.parse(await readFile(join(options.root, '.mdoc', 'submissions.json'), 'utf8')).entries[0].body).toEqual(request);
    }
  });

  it('reads and retries an existing large content receipt verbatim even if newer request limits would reject it', async () => {
    const options = await setup(); const ids = createCounterIdSource();
    const content: Document = { ...body.content, modules: [{ id: ids.next('m'), title: 'Large old snapshot', blocks: Array.from({ length: 1000 }, () => ({ id: ids.next('n'), type: 'paragraph' as const, text: Array.from({ length: 50 }, () => ({ br: true as const })) })) }] };
    expect(validateDocument(content).ok).toBe(true);
    const pending: unknown[] = [content]; let count = 0;
    while (pending.length) { const value = pending.pop(); count++; if (value && typeof value === 'object') pending.push(...Object.values(value)); }
    expect(count).toBeGreaterThan(100_000);
    const savedBody = { baseVersion: 1, message: 'Original long message '.repeat(40), content };
    expect(savedBody.message.length).toBeGreaterThan(500);
    const original = { version: 2, entries: [{ fingerprint: options.fingerprint, key: 'old-frozen-key', server: options.server, documentId: options.documentId, authorId: options.actorId, state: 'pending', body: savedBody, createdAt: '2026-10-23T00:00:00.000Z' }] };
    await mkdir(join(options.root, '.mdoc')); const path = join(options.root, '.mdoc', 'submissions.json');
    const bytes = JSON.stringify(original); await writeFile(path, bytes);
    expect((await inspectSubmissionReceipts(options.root)).receipts[0]).toMatchObject({ message: savedBody.message, key: 'old-frozen-key', state: 'pending' });
    expect(await readFile(path, 'utf8')).toBe(bytes);
    await expect(submitWithReceipt({ ...options, retry: true, body: operations, send: async (request, key) => {
      expect(key).toBe('old-frozen-key'); expect(JSON.stringify(request)).toBe(JSON.stringify(savedBody)); expect(request).not.toHaveProperty('ops'); throw new Error('Server rejected original request');
    } })).rejects.toThrow('Server rejected original request');
    expect(await readFile(path, 'utf8')).toBe(bytes);
    await submitWithReceipt({ ...options, retry: true, body: operations, send: async request => { expect(request).toEqual(savedBody); return response('pending'); } });
    expect(JSON.parse(await readFile(path, 'utf8')).entries[0]).toMatchObject({ body: savedBody, key: 'old-frozen-key', state: 'submitted' });

    // New requests keep current admission checks; stored compatibility must not weaken creation.
    for (const newBody of [{ ...savedBody, message: 'Within the current message limit' }, { ...body, message: savedBody.message }]) {
      const fresh = await setup();
      await expect(submitWithReceipt({ ...fresh, body: newBody, send: noCall })).rejects.toThrow('valid receipt');
      await expect(readFile(join(fresh.root, '.mdoc', 'submissions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});

it('never creates a replacement request when an inspected receipt is missing at lock acquisition', async () => {
  const options = await setup(); const send = vi.fn(noCall);
  await expect(submitWithReceipt({ ...options, existingOnly: true, send })).rejects.toThrow('no longer present');
  expect(send).not.toHaveBeenCalled();
  expect((await inspectSubmissionReceipts(options.root)).receipts).toEqual([]);
  await expect(readFile(join(options.root, '.mdoc/submissions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
