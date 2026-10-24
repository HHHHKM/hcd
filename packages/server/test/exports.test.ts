import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Document } from '../../core/src/model';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { createExportWorker, type ExportJob, type ExportOptions } from '../src/exports';
import { inspectArchive } from '../src/archive';
const docId = 'd_aaaaaaab';
const headers = (cookie = '') => ({ cookie, host: 'app.test', origin: 'https://app.test', 'x-hcd-request': '1' });
describe('durable document exports', () => {
  let app: FastifyInstance; let db: HcdDatabase; let dataDir: string; let owner: string; let clock: number;
  const workers: ReturnType<typeof createExportWorker>[] = [];
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'hcd-export-')); db = openDatabase(':memory:'); clock = Date.now();
    app = createApp({ db, dataDir, seed: true, appUrl: 'https://app.test', renderUrl: 'https://render.test', exports: { autoStart: false } });
    owner = await login('d@example.com'); db.prepare('DELETE FROM submissions').run();
  });
  afterEach(async () => { for (const worker of workers.splice(0)) await worker.stop(); await app.close(); db.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function login(email: string) { const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(response.statusCode).toBe(200); return String(response.headers['set-cookie']).split(';')[0]!; }
  function worker(options: ExportOptions = {}) { const value = createExportWorker(db, dataDir, { now: () => clock, ...options }); workers.push(value); return value; }
  function snapshot() { return JSON.parse((db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(docId) as { content: string }).content) as Document; }
  async function enqueue(format = 'html', extra: Record<string, unknown> = {}, cookie = owner) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: headers(cookie), payload: { format, ...extra } });
    expect(response.statusCode, response.body).toBe(202); expect(response.body).not.toContain('snapshot'); return response.json().export.id as string;
  }
  async function status(id: string, cookie = owner) { return app.inject({ method: 'GET', url: `/api/v1/exports/${id}`, headers: headers(cookie) }); }
  async function download(url: string, host = 'render.test') { const parsed = new URL(url); return app.inject({ method: 'GET', url: parsed.pathname + parsed.search, headers: { host } }); }
  function row(id: string) { return db.prepare('SELECT * FROM exports WHERE id=?').get(id) as ExportJob; }
  function submit(id: string, content: Document) { db.prepare("INSERT INTO submissions(id,doc_id,author_id,base_version,message,content,status,idempotency_key,payload_hash,created_at) VALUES(?,?,?,1,'',?,'pending',?,?,?)").run(id, docId, 'u_editor00000', JSON.stringify(content), id, id, new Date(clock).toISOString()); }
  it('AT-36 freezes a published snapshot and serves only signed attachment URLs on the render ' +
     'domain', async () => {
    const base = snapshot(); const id = await enqueue(); const updated = { ...base, title: 'Later publication' };
    db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)').run(docId, 2, 'publish', JSON.stringify(updated), 'u_owner000000', new Date(clock).toISOString()); db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    expect(await worker().tick()).toBe(1);
    const result = await status(id); expect(result.json().export).toMatchObject({ status: 'done', version: 1 });
    const url = result.json().export.downloadUrl; const file = await download(url); expect(file.statusCode).toBe(200); expect(file.headers['content-disposition']).toContain('attachment'); expect(file.body).toContain(base.title); expect(file.body).not.toContain('Later publication'); expect(file.body).toContain('<footer'); expect(row(id).snapshot).toBeNull();
    expect((await download(url, 'app.test')).statusCode).toBe(404);
    const swapped = new URL(url); swapped.searchParams.set('c', 'u_editor00000'); expect((await download(swapped.href)).statusCode).toBe(403);
    expect((await status(id, await login('a@example.com'))).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: { ...headers(owner), 'x-hcd-request': '' }, payload: { format: 'html' } })).statusCode).toBe(403);
  });
  it('AT-36 freezes clean pending changes, excludes an entire conflicting submission and enforces ' +
     'view-pending permission', async () => {
    const base = snapshot(); submit('sub_first', { ...base, title: 'Accepted pending title' });
    const conflict = structuredClone(base); conflict.title = 'Conflicting title'; conflict.modules[1]!.title = 'Must not leak from conflict'; submit('sub_second', conflict);
    const clean = structuredClone(base); clean.modules[0]!.title = 'Independent pending module'; submit('sub_third', clean);
    const commenter = await login('f@example.com'); const id = await enqueue('html', { includePending: true }, commenter);
    db.prepare("UPDATE submissions SET content=? WHERE id='sub_first'").run(JSON.stringify({ ...base, title: 'Changed after enqueue' }));
    expect(await worker().tick()).toBe(1); const result = await status(id, commenter); expect(result.json().export.excludedSubmissionIds).toEqual(['sub_second']);
    const file = await download(result.json().export.downloadUrl); expect(file.body).toContain('Accepted pending title'); expect(file.body).toContain('Independent pending module'); expect(file.body).not.toContain('Must not leak from conflict'); expect(file.body).not.toContain('Changed after enqueue'); expect(file.body).toContain('包含未审核的修改');
    db.prepare("UPDATE space_members SET role='viewer' WHERE user_id='u_comment000'").run(); db.prepare("UPDATE document_members SET role='viewer' WHERE user_id='u_comment000'").run();
    expect((await status(id, commenter)).statusCode).toBe(404); expect((await download(result.json().export.downloadUrl)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: headers(commenter), payload: { format: 'html', includePending: true } })).statusCode).toBe(403);
  });
  it('AT-36 exports a reimportable ZIP and rejects obsolete pending-version combinations', async () => {
    const id = await enqueue('zip'); expect(await worker().tick()).toBe(1);
    const result = await status(id); const file = await download(result.json().export.downloadUrl); const archive = inspectArchive(file.rawPayload);
    expect(JSON.parse(Buffer.from(archive['document.json']!).toString())).toEqual(snapshot());
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/archive', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'queued.zip', archiveBase64: file.rawPayload.toString('base64') } }); expect(imported.statusCode, imported.body).toBe(201);
    db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    const wrongVersion = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: headers(owner), payload: { format: 'html', version: 1, includePending: true } }); expect(wrongVersion.json().error.code).toBe('PENDING_REQUIRES_CURRENT_VERSION');
  });
  it('AT-36 rechecks account, membership and originating PAT revocation before serving or ' +
     'processing', async () => {
    const id = await enqueue(); const service = worker(); expect(await service.tick()).toBe(1); const url = (await status(id)).json().export.downloadUrl;
    db.prepare("UPDATE users SET disabled_at=? WHERE id='u_owner000000'").run(new Date(clock).toISOString()); expect((await download(url)).statusCode).toBe(404); db.prepare("UPDATE users SET disabled_at=NULL WHERE id='u_owner000000'").run();
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId);
    const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { scopes: ['read'], docIds: [docId] } });
    const patHeaders = { host: 'app.test', 'x-hcd-request': '1', authorization: `Bearer ${token.json().token}` };
    expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: patHeaders, payload: { format: 'html' } })).json().error.code).toBe('AI_DISABLED');
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    const created = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: patHeaders, payload: { format: 'html' } }); expect(created.statusCode).toBe(202); const patJob = created.json().export.id; expect(await service.tick()).toBe(1); const patUrl = (await status(patJob)).json().export.downloadUrl;
    db.prepare('UPDATE api_tokens SET revoked_at=?').run(new Date(clock).toISOString()); expect((await download(patUrl)).statusCode).toBe(404);
    const pending = await enqueue(); db.prepare("DELETE FROM document_members WHERE user_id='u_owner000000'").run(); db.prepare("DELETE FROM space_members WHERE user_id='u_owner000000'").run(); expect(await service.tick()).toBe(0); expect(row(pending).error).toBe('EXPORT_ACCESS_REVOKED'); expect((await download(url)).statusCode).toBe(404);
  });
  it('AT-36 bounds queue size, recovers an interrupted job and expires files and frozen content', async () => {
    const ids = [await enqueue(), await enqueue()];
    const competing = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: headers(owner), payload: { format: 'html' } })));
    expect(competing.map((response) => response.statusCode).sort()).toEqual([202, 429]); ids.push(competing.find((response) => response.statusCode === 202)!.json().export.id);
    db.prepare("UPDATE exports SET status='running',attempts=1,lease_token='lost',lease_until=? WHERE id=?").run(new Date(clock - 1).toISOString(), ids[0]);
    const service = worker(); expect(await service.tick()).toBe(3); expect(row(ids[0]!).attempts).toBe(2); expect(await readdir(join(dataDir, 'exports'))).toHaveLength(3);
    clock = Date.now() + 86400001; await service.cleanup(); expect(await readdir(join(dataDir, 'exports'))).toEqual([]); expect(row(ids[0]!)).toMatchObject({ status: 'expired', snapshot: null, filename: null, error: 'EXPORT_EXPIRED' });
  });
  it('AT-36 treats PDF responses as bounded binary artifacts and fails clearly without a ' +
     'configured exporter', async () => {
    const missing = await enqueue('pdf'); expect(await worker().tick()).toBe(0); expect(row(missing).error).toBe('EXPORTER_NOT_CONFIGURED');
    const bodies: string[] = []; let response = new Response('%PDF-1.4\nfixture\n%%EOF', { headers: { 'content-type': 'application/pdf' } });
    const service = worker({ exporterUrl: 'http://127.0.0.1:4000', request: async (url, options) => { expect(String(url)).toBe('http://127.0.0.1:4000/pdf'); expect(options?.redirect).toBe('error'); expect(options?.signal).toBeTruthy(); bodies.push(Buffer.from(options!.body as Uint8Array).toString()); return response; } });
    const id = await enqueue('pdf'); expect(await service.tick()).toBe(1); expect(row(id).mime).toBe('application/pdf'); expect(bodies[0]).toContain("default-src 'none'");
    for (const bad of [new Response(null, { status: 302, headers: { location: 'https://external.test' } }), new Response('<html>error</html>', { headers: { 'content-type': 'application/pdf' } }), new Response('secret error', { status: 500 })]) {
      response = bad; const failed = await enqueue('pdf'); expect(await service.tick()).toBe(0); expect(row(failed).error).toBe('EXPORTER_RESPONSE_INVALID'); expect(JSON.stringify(row(failed))).not.toContain('secret error');
    }
  });
  it('AT-36 keeps only the current worker result when an expired PDF lease is reclaimed', async () => {
    let release!: () => void; let entered!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
    const id = await enqueue('pdf'); let first = true;
    const request: typeof fetch = async () => { if (first) { first = false; entered(); await blocked; } return new Response('%PDF-1.4\nfixture\n%%EOF', { headers: { 'content-type': 'application/pdf' } }); };
    const one = worker({ exporterUrl: 'http://127.0.0.1:4000', request }); const two = worker({ exporterUrl: 'http://127.0.0.1:4000', request });
    const old = one.tick(); await started;
    try { expect(await two.tick()).toBe(0); clock += 90001; expect(await two.tick()).toBe(1); const filename = row(id).filename; release(); expect(await old).toBe(0); expect(row(id)).toMatchObject({ status: 'done', filename, attempts: 2 }); expect(await readdir(join(dataDir, 'exports'))).toEqual([filename]); }
    finally { release(); await old; }
  });
  it('AT-36 rejects cross-document assets and oversized PDF output, and cancels revoked access ' +
     'during rendering', async () => {
    const base = snapshot(); const foreign = structuredClone(base); foreign.modules[0]!.blocks.push({ id: 'n_zzzzzzzz', type: 'image', asset: 'as_zzzzzzzzzzzz', alt: '', caption: '', width: 'normal' });
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(foreign), docId);
    const denied = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/exports`, headers: headers(owner), payload: { format: 'html' } }); expect(denied.json().error.code).toBe('ASSET_NOT_FOUND');
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base), docId);
    let mode = 'large'; let cancelled = false;
    const service = worker({ exporterUrl: 'http://127.0.0.1:4000', request: async () => {
      if (mode === 'large') { return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/pdf' } }); }
      if (mode === 'timeout') throw new DOMException('fixture timeout', 'TimeoutError');
      db.prepare("UPDATE users SET disabled_at=? WHERE id='u_owner000000'").run(new Date(clock).toISOString()); return new Response('%PDF-1.4\nfixture\n%%EOF', { headers: { 'content-type': 'application/pdf' } });
    } });
    const large = await enqueue('pdf'); expect(await service.tick()).toBe(0); expect(row(large).error).toBe('EXPORT_TOO_LARGE'); expect(cancelled).toBe(true);
    mode = 'timeout'; const timed = await enqueue('pdf'); expect(await service.tick()).toBe(0); expect(row(timed).error).toBe('EXPORT_TIMEOUT');
    mode = 'revoke'; const revoked = await enqueue('pdf'); expect(await service.tick()).toBe(0); expect(row(revoked)).toMatchObject({ error: 'EXPORT_ACCESS_REVOKED', filename: null, snapshot: null });
  });
});
