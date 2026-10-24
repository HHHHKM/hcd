import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { submitWithReceipt, requestFingerprint, type SubmissionBody } from '../../cli/src/submission-receipts';
import type { Document } from '../../core/src/model';
const origin = 'http://localhost:5173'; const docId = 'd_aaaaaaab';
const base: Document = { schemaVersion: 1, id: docId, title: 'Review', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Original text' }] }] }] };
describe('complete JSON submission compatibility', () => {
  let app: FastifyInstance; let db: HcdDatabase; let cookie: string; let order: number;
  const headers = () => ({ cookie, origin, 'x-hcd-request': '1' });
  const request = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1' + url, headers: headers(), payload });
  const send = (content: Document, key: string) => app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { ...headers(), 'idempotency-key': key }, payload: { baseVersion: 1, content } });
  beforeEach(async () => {
    db = openDatabase(':memory:'); app = createApp({ db, seed: true, appUrl: origin, renderUrl: 'https://render.test', exports: { autoStart: false } }); await app.ready(); order = 0; cookie = '';
    cookie = String((await request('/auth/login', { email: 'd@example.com', password: 'hcd-demo-2026' })).headers['set-cookie']).split(';')[0]!;
    db.prepare('DELETE FROM submissions').run(); db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base), docId);
  });
  afterEach(async () => { await app.close(); db.close(); });
  async function submit(content: Document, key: string = crypto.randomUUID()) {
    const response = await send(content, key); expect(response.statusCode, response.body).toBe(201);
    const value = response.json(); db.prepare('UPDATE submissions SET created_at=? WHERE id=?').run(`2026-10-23T00:00:${String(order++).padStart(2, '0')}Z`, value.submissionId); return value;
  }
  async function preview(ids: string[]) { const response = await request(`/docs/${docId}/previews`, { submissionIds: ids }); expect(response.statusCode, response.body).toBe(200); return response.json().preview; }
  function edit(text: string) { const content = structuredClone(base); content.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: text }] }; return content; }
  it('AT-05 stores permanent operations and preserves nested IDs and content through publication ' +
     'and retries', async () => {
    const content = structuredClone(base); content.modules[0]!.blocks.push({ id: 'n_bbbbbbbb', type: 'table', caption: '', columns: [{ id: 'n_cccccccc', header: [], align: 'left' }], rows: [{ id: 'n_dddddddd', cells: { n_cccccccc: [{ t: 'Preserved' }] } }] });
    const submitted = await submit(content, 'frozen-receipt'); expect(submitted.opCount).toBe(1); expect(submitted.idMap).toEqual({}); expect(submitted.submission.content).toEqual(content);
    const row = db.prepare('SELECT content,operations,request_hash,payload_hash FROM submissions WHERE id=?').get(submitted.submissionId) as { content: string; operations: string };
    expect(JSON.parse(row.operations)[0].node).toEqual(content.modules[0]!.blocks[1]); expect(row.operations).not.toContain('tmp_');
    const view = await preview([submitted.submissionId]); expect(view.items[0].ops).toHaveLength(1);
    const result = await request(`/previews/${view.id}/publish`, { revision: view.revision }); expect(result.statusCode, result.body).toBe(200); expect(result.json().version.content).toEqual(content);
    const retried = await send(content, 'frozen-receipt'); expect(retried.statusCode).toBe(200); expect(retried.json().submissionId).toBe(submitted.submissionId); expect(retried.json().submission.content).toEqual(content);
    expect(db.prepare('SELECT content,operations,request_hash,payload_hash FROM submissions WHERE id=?').get(submitted.submissionId)).toEqual(row);
    expect((await send(edit('Changed request'), 'frozen-receipt')).statusCode).toBe(409);
  });
  it('AT-05 replays an existing frozen CLI receipt after a lost response without assigning new IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hcd-json-receipt-'));
    const body: SubmissionBody = { baseVersion: 1, content: edit('Frozen request'), message: 'CLI' };
    const options = { root: directory, server: origin, documentId: docId, actorId: (await app.inject({ url: '/api/v1/me', headers: headers() })).json().user.id as string, fingerprint: requestFingerprint(body), body };
    let first = true;
    const sendReceipt = async (payload: SubmissionBody, key: string) => {
      const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { ...headers(), 'idempotency-key': key }, payload });
      expect([200, 201]).toContain(response.statusCode);
      if (first) { first = false; throw new Error('Response lost after server commit'); }
      return response.json();
    };
    try {
      await expect(submitWithReceipt({ ...options, send: sendReceipt })).rejects.toThrow('Response lost');
      const before = JSON.parse(await readFile(join(directory, '.mdoc/submissions.json'), 'utf8')).entries[0];
      db.prepare('UPDATE submissions SET operations=NULL,request_hash=NULL').run();
      const id = await submitWithReceipt({ ...options, retry: true, body: { ...body, content: edit('Later local work') }, send: sendReceipt });
      const after = JSON.parse(await readFile(join(directory, '.mdoc/submissions.json'), 'utf8')).entries[0];
      expect(after.body).toEqual(before.body); expect(after.key).toBe(before.key); expect(after.state).toBe('submitted');
      expect(db.prepare('SELECT count(*) count FROM submissions').get()).toEqual({ count: 1 });
      const view = await preview([id]); expect(view.candidate).toEqual(body.content); expect(view.items[0].ops).toHaveLength(1);
      expect(db.prepare('SELECT operations,request_hash FROM submissions WHERE id=?').get(id)).toEqual({ operations: null, request_hash: null });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('merges same-anchor JSON insertions in creation order, including legacy stored snapshots', async () => {
    const content = structuredClone(base); content.modules[0]!.blocks.push({ id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'First' }] }); const first = await submit(content);
    db.prepare('UPDATE submissions SET operations=NULL,request_hash=NULL WHERE id=?').run(first.submissionId);
    const saved = db.prepare('SELECT * FROM submissions WHERE id=?').get(first.submissionId);
    content.modules[0]!.blocks[1] = { id: 'n_cccccccc', type: 'paragraph', text: [{ t: 'Second' }] }; const second = await submit(content);
    const view = await preview([second.submissionId, first.submissionId]); expect(view.publishable).toBe(true);
    expect(view.candidate.modules[0].blocks.map((block: { id: string }) => block.id)).toEqual(['n_aaaaaaaa', 'n_bbbbbbbb', 'n_cccccccc']); expect(view.items.every((item: { ops: unknown[] }) => item.ops.length === 1)).toBe(true);
    expect(db.prepare('SELECT * FROM submissions WHERE id=?').get(first.submissionId)).toEqual(saved);
  });
  it('AT-03 returns operation conflicts for JSON edits and validates owner resolutions before ' +
     'publishing', async () => {
    const first = await submit(edit('First changed text')); const second = await submit(edit('Second changed text'));
    let view = await preview([first.submissionId, second.submissionId]); expect(view.publishable).toBe(false); const conflict = view.conflicts[0]; expect(conflict.id).toBe(`${second.submissionId}:0`); expect(conflict.fingerprint).toBeTruthy();
    const response = await request(`/previews/${view.id}/resolutions`, { revision: view.revision, conflictId: conflict.id, choice: 'take_incoming' }); expect(response.statusCode, response.body).toBe(200); view = response.json().preview; expect(view.publishable).toBe(true);
    const published = await request(`/previews/${view.id}/publish`, { revision: view.revision }); expect(published.statusCode, published.body).toBe(200); expect(published.json().version.content).toEqual(edit('Second changed text'));
  });
  it('rejects invalid references, duplicate IDs and unsupported changes without changing drafts or submissions', async () => {
    await app.inject({ method: 'PUT', url: `/api/v1/docs/${docId}/draft`, headers: headers(), payload: { baseVersion: 1, content: edit('Private draft') } });
    const draft = db.prepare('SELECT * FROM drafts').all();
    const invalid = structuredClone(base); invalid.modules[0]!.blocks.push({ id: 'n_bbbbbbbb', type: 'table', caption: '', columns: [], rows: [{ id: 'n_cccccccc', cells: { n_dddddddd: [{ t: 'Invalid' }] } }] });
    expect((await send(invalid, 'invalid')).statusCode).toBe(400);
    const duplicate = structuredClone(base); duplicate.modules[0]!.blocks.push(duplicate.modules[0]!.blocks[0]!); expect((await send(duplicate, 'duplicate')).statusCode).toBe(400);
    const unsupported = structuredClone(base); unsupported.theme.version = 2; const response = await send(unsupported, 'unsupported'); expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('SNAPSHOT_NOT_REPRESENTABLE');
    expect(db.prepare('SELECT * FROM drafts').all()).toEqual(draft); expect(db.prepare('SELECT count(*) count FROM submissions').get()).toEqual({ count: 0 });
  });
  it('AT-27 keeps incompatible legacy snapshots intact, excludes them from exports and requires ' +
     'explicit discard', async () => {
    const old = await submit(edit('Legacy edit')); const content = edit('Legacy edit'); content.theme.version = 2;
    db.prepare('UPDATE submissions SET operations=NULL,content=? WHERE id=?').run(JSON.stringify(content), old.submissionId);
    const saved = db.prepare('SELECT * FROM submissions WHERE id=?').get(old.submissionId); const valid = await submit(edit('Valid edit'));
    let view = await preview([old.submissionId, valid.submissionId]); expect(view.publishable).toBe(false); expect(view.candidate).toEqual(edit('Valid edit')); expect(view.conflicts[0]).toMatchObject({ kind: 'invalid_structure', incoming: { code: 'SNAPSHOT_NOT_REPRESENTABLE' }, allowed: ['drop'] });
    const exported = await request(`/docs/${docId}/exports`, { format: 'html', includePending: true }); expect(exported.statusCode, exported.body).toBe(202); const job = db.prepare('SELECT excluded_ids FROM exports WHERE id=?').get(exported.json().export.id) as { excluded_ids: string }; expect(JSON.parse(job.excluded_ids)).toEqual([old.submissionId]);
    const response = await request(`/previews/${view.id}/resolutions`, { revision: view.revision, conflictId: view.conflicts[0].id, choice: 'drop' }); expect(response.statusCode, response.body).toBe(200); view = response.json().preview; expect(view.publishable).toBe(true); expect(view.candidate).toEqual(edit('Valid edit'));
    expect(db.prepare('SELECT * FROM submissions WHERE id=?').get(old.submissionId)).toEqual(saved);
  });
  it('invalidates prior merge previews once during migration while preserving restores and immutable records', async () => {
    const old = await submit(edit('Legacy edit')); db.prepare('UPDATE submissions SET operations=NULL WHERE id=?').run(old.submissionId); const view = await preview([old.submissionId]);
    db.prepare("INSERT INTO previews(id,doc_id,base_version,revision,submission_ids,resolutions,candidate,conflicts,publishable,status,created_by,created_at,kind) SELECT 'restore_fixture',doc_id,base_version,revision,submission_ids,resolutions,candidate,conflicts,publishable,status,created_by,created_at,'restore' FROM previews WHERE id=?").run(view.id);
    const saved = db.prepare('SELECT * FROM submissions WHERE id=?').get(old.submissionId); db.prepare("DELETE FROM schema_migrations WHERE id='snapshot-operation-previews-v1'").run();
    const directory = await mkdtemp(join(tmpdir(), 'hcd-snapshot-migration-')); const file = join(directory, 'old.sqlite');
    try {
      await db.backup(file); let reopened = openDatabase(file);
      try { expect(reopened.prepare('SELECT status,candidate FROM previews WHERE id=?').get(view.id)).toEqual({ status: 'stale', candidate: JSON.stringify(view.candidate) }); expect(reopened.prepare("SELECT status FROM previews WHERE id='restore_fixture'").get()).toEqual({ status: 'open' }); expect(reopened.prepare('SELECT * FROM submissions WHERE id=?').get(old.submissionId)).toEqual(saved); reopened.prepare("UPDATE previews SET status='open' WHERE id=?").run(view.id); } finally { reopened.close(); }
      reopened = openDatabase(file); try { expect(reopened.prepare('SELECT status FROM previews WHERE id=?').get(view.id)).toEqual({ status: 'open' }); } finally { reopened.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
