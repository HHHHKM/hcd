import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import type { Document } from '../../core/src/model';
import type { ReviewPresentation } from '../../core/src/review-types';
import { subtreeHash } from '../../core/src/ops';
const origin = 'http://localhost:5173'; const docId = 'd_aaaaaaab';
const base: Document = { schemaVersion: 1, id: docId, title: 'Review', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'One two three four five' }] }] }, { id: 'm_bbbbbbbb', title: 'Other', blocks: [] }] };
describe('saved change presentation', () => {
  let app: FastifyInstance; let db: HcdDatabase; let cookie: string; let order: number;
  const headers = () => ({ cookie, origin, 'x-hcd-request': '1' });
  const request = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1' + url, headers: headers(), payload });
  beforeEach(async () => {
    db = openDatabase(':memory:'); app = createApp({ db, seed: true, appUrl: origin, renderUrl: 'https://render.test', exports: { autoStart: false } }); await app.ready(); order = 0; cookie = '';
    cookie = String((await request('/auth/login', { email: 'd@example.com', password: 'hcd-demo-2026' })).headers['set-cookie']).split(';')[0]!;
    db.prepare('DELETE FROM submissions').run(); db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base), docId);
  });
  afterEach(async () => { await app.close(); db.close(); });
  async function submit(input: Record<string, unknown>) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { ...headers(), 'idempotency-key': crypto.randomUUID() }, payload: { baseVersion: 1, ...input } }); expect(response.statusCode, response.body).toBe(201);
    const value = response.json(); db.prepare('UPDATE submissions SET created_at=? WHERE id=?').run(`2026-10-23T00:00:${String(order++).padStart(2, '0')}Z`, value.submissionId); return value;
  }
  async function preview(ids: string[]) { const response = await request(`/docs/${docId}/previews`, { submissionIds: ids }); expect(response.statusCode, response.body).toBe(200); return response.json().preview; }
  const edit = (text: string) => ({ op: 'set', at: { id: 'n_aaaaaaaa', field: 'text' }, before: [{ t: 'One two three four five' }], after: [{ t: text }] });
  it('shows ordered original operations even when the final submission snapshot is unchanged', async () => {
    const changed = structuredClone(base); changed.title = 'Intermediate';
    const made = await submit({ ops: [{ op: 'set', at: { id: docId, field: 'title' }, before: base.title, after: changed.title }, { op: 'set', at: { id: docId, field: 'title' }, before: changed.title, after: base.title }] });
    const response = await app.inject({ url: `/api/v1/submissions/${made.submissionId}`, headers: headers() }); expect(response.statusCode).toBe(200);
    expect(response.json().submission.changes).toEqual([]); expect(response.json().submission.changeSet.changes.map((change: any) => [change.opIndex, change.before, change.after])).toEqual([[0, 'Review', 'Intermediate'], [1, 'Intermediate', 'Review']]);
    const view = await preview([made.submissionId]); expect(view.presentation.proposed[0].changeSet.changes).toHaveLength(2); expect(view.presentation.candidate.changes).toEqual([]);
  });
  it('distinguishes original proposals and outcomes from actual candidate changes after whole-submission rollback', async () => {
    const first = await submit({ ops: [edit('First two three four five')] });
    const second = await submit({ ops: [{ op: 'insert', parent: { id: 'm_bbbbbbbb', list: 'blocks' }, after: null, node: { id: 'tmp_new', type: 'paragraph', text: [{ t: 'Should be excluded' }] } }, edit('Conflict two three four five')] });
    const ids = [second.submissionId, first.submissionId]; const view = await preview(ids); const display = view.presentation as ReviewPresentation;
    expect(display.proposed.map(item => item.submissionId)).toEqual([first.submissionId, second.submissionId]); const proposal = display.proposed[1]!;
    expect(proposal.operations[0]!.outcome).toBe('applied'); expect(proposal.candidateEffect).toBe('excluded_unresolved'); expect(proposal.changeSet.changes).toHaveLength(2);
    expect(display.candidate.changes).toHaveLength(1); expect(display.candidate.changes[0]!.after).toEqual([{ t: 'First two three four five' }]); expect(display.candidate.changes[0]!.sources).toBeUndefined(); expect(proposal.changeSet.changes[0]!.sources).toEqual([second.submissionId]);
    const readonly = await request(`/docs/${docId}/previews/prepare`, { submissionIds: ids }); expect(readonly.statusCode).toBe(200); expect(readonly.json().preview.presentation).toEqual(display);
  });
  it('records manual candidate text and preserves the saved comparison after publication changes the current version', async () => {
    const first = await submit({ ops: [edit('First two three four five')] }); const second = await submit({ ops: [edit('Second two three four five')] }); let view = await preview([first.submissionId, second.submissionId]);
    const result = await request(`/previews/${view.id}/resolutions`, { revision: view.revision, conflictId: view.conflicts[0].id, choice: 'manual', value: [{ t: 'Human reviewed', b: true }] }); expect(result.statusCode, result.body).toBe(200); view = result.json().preview;
    expect(view.presentation.candidate.changes[0].after).toEqual([{ t: 'Human reviewed', b: true }]); expect(view.presentation.proposed[1].changeSet.changes[0].after).toEqual([{ t: 'Second two three four five' }]);
    const persisted = db.prepare('SELECT presentation FROM previews WHERE id=?').get(view.id) as { presentation: string }; expect(JSON.parse(persisted.presentation)).toEqual(view.presentation);
    expect((await request(`/previews/${view.id}/publish`, { revision: view.revision })).statusCode).toBe(200);
    const read = await app.inject({ url: `/api/v1/previews/${view.id}`, headers: headers() }); expect(read.statusCode).toBe(200); expect(read.json().preview.presentation).toEqual(view.presentation); expect(read.json().preview.presentation.baseVersion).toBe(1);
  });
  it('shows exclusion after a synthetic document-level drop even if earlier operation outcomes say applied', async () => {
    const tableDoc = structuredClone(base); tableDoc.modules[0]!.blocks = [{ id: 'n_cccccccc', type: 'table', caption: '', columns: [{ id: 'n_dddddddd', header: [], align: 'left' }], rows: [] }];
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(tableDoc), docId);
    const first = await submit({ ops: [{ op: 'delete', target: 'n_dddddddd', beforeHash: subtreeHash(tableDoc, 'n_dddddddd') }] });
    const second = await submit({ ops: [{ op: 'insert', parent: { id: 'n_cccccccc', list: 'rows' }, after: null, node: { id: 'tmp_row', cells: { n_dddddddd: [{ t: 'Depends on deleted column' }] } } }] });
    let view = await preview([first.submissionId, second.submissionId]); const conflict = view.conflicts.find((item: any) => item.id.endsWith(':document')); expect(conflict).toBeTruthy();
    const result = await request(`/previews/${view.id}/resolutions`, { revision: view.revision, conflictId: conflict.id, choice: 'drop' }); expect(result.statusCode, result.body).toBe(200); view = result.json().preview;
    expect(view.presentation.proposed[1].candidateEffect).toBe('excluded_document_drop'); expect(view.presentation.proposed[1].changeSet.changes).toHaveLength(1); expect(view.presentation.proposed[1].operations).toHaveLength(2);
    expect(view.presentation.candidate.changes.some((item: any) => item.kind === 'insert')).toBe(false);
  });
  it('handles legacy details, incompatible historical snapshots, and absent old preview presentation explicitly', async () => {
    const created = await submit({ ops: [edit('Legacy text')] }); db.prepare('UPDATE submissions SET operations=NULL WHERE id=?').run(created.submissionId);
    const detail = (await app.inject({ url: `/api/v1/submissions/${created.submissionId}`, headers: headers() })).json().submission; expect(detail.changeSet.changes).toHaveLength(1);
    const view = await preview([created.submissionId]); db.prepare('UPDATE previews SET presentation=NULL WHERE id=?').run(view.id);
    expect((await app.inject({ url: `/api/v1/previews/${view.id}`, headers: headers() })).json().preview.presentation).toBeNull();
    const invalid = structuredClone(base); invalid.theme.version = 2; db.prepare('UPDATE submissions SET content=? WHERE id=?').run(JSON.stringify(invalid), created.submissionId);
    const incompatible = (await app.inject({ url: `/api/v1/submissions/${created.submissionId}`, headers: headers() })).json().submission;
    expect(incompatible.changeSet).toEqual({ changes: [], unavailable: 'SNAPSHOT_NOT_REPRESENTABLE' }); expect(incompatible.content.theme.version).toBe(2);
  });
  it('creates restore and historical comparisons from the chosen immutable snapshots', async () => {
    const created = await submit({ ops: [edit('Published text')] }); const view = await preview([created.submissionId]); expect((await request(`/previews/${view.id}/publish`, { revision: view.revision })).statusCode).toBe(200);
    const restore = await request(`/docs/${docId}/restore`, { version: 1 }); expect(restore.statusCode, restore.body).toBe(200); const restored = restore.json().preview.presentation;
    expect(restored.baseVersion).toBe(2); expect(restored.proposed).toEqual([]); expect(restored.candidate.changes[0].before).toEqual([{ t: 'Published text' }]); expect(restored.candidate.changes[0].after).toEqual([{ t: 'One two three four five' }]);
    const comparison = await app.inject({ url: `/api/v1/docs/${docId}/compare?from=1&to=2`, headers: headers() }); expect(comparison.statusCode).toBe(200); expect(comparison.json().changeSet.changes[0].after).toEqual([{ t: 'Published text' }]);
  });
  it('does not reveal proposal detail to viewers or revoked token readers', async () => {
    const created = await submit({ ops: [edit('Private proposal')] }); const view = await preview([created.submissionId]);
    const token = (await request('/me/tokens', { scopes: ['read', 'preview'] })).json().token;
    db.prepare("UPDATE documents SET ai_enabled=0 WHERE id=?").run(docId);
    for (const url of [`/submissions/${created.submissionId}`, `/previews/${view.id}`]) expect((await app.inject({ url: '/api/v1' + url, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    const viewer = String((await request('/auth/login', { email: 'f@example.com', password: 'hcd-demo-2026' })).headers['set-cookie']).split(';')[0]!;
    db.prepare("UPDATE space_members SET role='viewer' WHERE user_id='u_comment000'").run(); db.prepare("UPDATE document_members SET role='viewer' WHERE user_id='u_comment000'").run();
    for (const url of [`/submissions/${created.submissionId}`, `/previews/${view.id}`]) expect((await app.inject({ url: '/api/v1' + url, headers: { cookie: viewer } })).statusCode).toBe(403);
  });
});
