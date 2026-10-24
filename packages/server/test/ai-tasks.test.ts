import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { expireAiTasks } from '../src/ai-tasks';
import type { Document } from '../../core/src/model';

const origin = 'http://localhost:5173'; const docId = 'd_aaaaaaab';
const human = (cookie: string) => ({ cookie, origin, 'x-hcd-request': '1' });
const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'x-hcd-request': '1' });
describe('AI task leases, submissions and read-only previews', () => {
  let app: FastifyInstance; let db: HcdDatabase; let owner: string; let editor: string; let commenter: string;
  let token: string; let secondToken: string; let content: Document;
  const login = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: human(''), payload: { email, password: 'hcd-demo-2026' } })).headers['set-cookie']).split(';')[0]!;
  async function issue(scopes = ['read', 'submit', 'ai_tasks', 'preview'], cookie = editor) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: human(cookie), payload: { scopes } });
    expect(response.statusCode).toBe(201); return response.json().token as string;
  }
  async function request(cookie = owner) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/comments`, headers: human(cookie), payload: { body: '@[AI](ai) Improve this module', anchor: { moduleId: content.modules[0]!.id } } });
    expect(response.statusCode).toBe(201); return response.json().aiTask ?? response.json().task;
  }
  const act = (taskId: string, action: string, payload = {}, credential = token) => app.inject({ method: 'POST', url: `/api/v1/ai-tasks/${taskId}/${action}`, headers: bearer(credential), payload });
  async function claim() { const task = await request(); const response = await act(task.id, 'claim'); expect(response.statusCode).toBe(200); return response.json() as { task: { id: string; baseVersion: number }; claimId: string }; }
  function submit(taskId?: string, claimId?: string, next = structuredClone(content), credential = token, key: string = crypto.randomUUID(), baseVersion = 1) {
    return app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { ...bearer(credential), 'idempotency-key': key }, payload: { baseVersion, content: next, message: 'AI edit', ...(taskId ? { aiTaskId: taskId, claimId } : {}) } });
  }
  beforeEach(async () => {
    db = openDatabase(':memory:'); app = createApp({ db, secretKey: 'ai-task-test-secret', appUrl: origin, seed: true }); await app.ready();
    owner = await login('d@example.com'); editor = await login('a@example.com'); commenter = await login('f@example.com');
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    content = (await app.inject({ url: `/api/v1/docs/${docId}`, headers: human(owner) })).json().content;
    token = await issue(); secondToken = await issue();
  });
  afterEach(async () => { await app.close(); db.close(); });

  it('AT-25 auto-approves human editor requests, while commenter and token requests require human ' +
     'approval', async () => {
    expect((await request(editor)).status).toBe('approved');
    const pending = await request(commenter); expect(pending.status).toBe('requested');
    const notifications = db.prepare("SELECT user_id FROM notifications WHERE kind='ai_task_requested' AND json_extract(payload,'$.taskId')=?").all(pending.id);
    expect(notifications).toEqual(expect.arrayContaining([{ user_id: 'u_editor00000' }, { user_id: 'u_owner000000' }]));
    expect((await app.inject({ method: 'POST', url: `/api/v1/ai-tasks/${pending.id}/approve`, headers: human(editor) })).statusCode).toBe(200);
    const madeByToken = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/comments`, headers: bearer(token), payload: { body: '@[AI](ai) Proposal', anchor: { moduleId: content.modules[0]!.id } } });
    expect(madeByToken.json().aiTask.status).toBe('requested');
    expect((await act(madeByToken.json().aiTask.id, 'approve')).statusCode).toBe(403);
  });
  it('AT-26 records AI-disabled requests as a system reply without creating a task', async () => {
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId);
    expect(await request()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) count FROM ai_tasks').get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT body FROM comments WHERE user_id IS NULL AND guest_id IS NULL").get()).toEqual({ body: expect.stringContaining('AI is disabled') });
  });
  it('allows only one concurrent claim and conceals credentials from task readers', async () => {
    const task = await request();
    const responses = await Promise.all([act(task.id, 'claim'), act(task.id, 'claim', {}, secondToken)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(db.prepare('SELECT attempts FROM ai_tasks WHERE id=?').get(task.id)).toEqual({ attempts: 1 });
    const listed = await app.inject({ url: `/api/v1/ai-tasks/${task.id}`, headers: bearer(token) });
    expect(listed.json().task).not.toHaveProperty('claimId'); expect(listed.json().task).not.toHaveProperty('claimedToken');
    const winner = responses[0]!.statusCode === 200 ? token : secondToken; const loser = winner === token ? secondToken : token;
    const claimId = responses.find((r) => r.statusCode === 200)!.json().claimId;
    expect((await act(task.id, 'fail', { claimId, reason: 'Not mine' }, loser)).json().error.code).toBe('TASK_CLAIM_MISMATCH');
  });
  it('requires a linked submission and completes idempotently with one system reply and notification', async () => {
    const c = await claim();
    expect((await act(c.task.id, 'complete', { claimId: c.claimId, result: { anything: true } })).json().error.code).toBe('SUBMISSION_REQUIRED');
    const unrelated = (await submit()).json().submission;
    expect((await act(c.task.id, 'complete', { claimId: c.claimId, submissionId: unrelated.id })).json().error.code).toBe('TASK_SUBMISSION_MISMATCH');
    const next = structuredClone(content); next.modules[0]!.title = 'Improved title';
    const created = await submit(c.task.id, c.claimId, next); expect(created.statusCode).toBe(201);
    expect(created.json().submission.aiTaskId).toBe(c.task.id);
    const payload = { claimId: c.claimId, submissionId: created.json().submission.id };
    expect((await act(c.task.id, 'complete', payload, secondToken)).json().error.code).toBe('TASK_CLAIM_MISMATCH');
    for (let i = 0; i < 2; i++) expect((await act(c.task.id, 'complete', payload)).json().task.status).toBe('done');
    expect(db.prepare("SELECT COUNT(*) count FROM notifications WHERE kind='ai_task_done'").get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT related_submission FROM comments WHERE parent_id IS NOT NULL AND user_id IS NULL AND guest_id IS NULL').all()).toEqual([{ related_submission: created.json().submission.id }]);
    expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId)).toEqual({ current_version: 1 });
  });
  it.each(['metadata', 'unrelated module', 'module reorder', 'module deletion', 'module insertion', 'document ID'])('AT-23 rejects task changes outside the ' +
                                                                                                                    'approved scope: %s', async (kind) => {
    const c = await claim(); const next = structuredClone(content);
    if (kind === 'metadata') next.title = 'Changed';
    if (kind === 'unrelated module') next.modules[1]!.title = 'Changed';
    if (kind === 'module reorder') next.modules.reverse();
    if (kind === 'module deletion') next.modules.pop();
    if (kind === 'module insertion') next.modules.push({ id: 'm_zzzzzzzz', title: 'New', blocks: [] });
    if (kind === 'document ID') next.id = 'd_zzzzzzzz';
    const response = await submit(c.task.id, c.claimId, next);
    expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe('TOKEN_SCOPE');
    expect(db.prepare('SELECT COUNT(*) count FROM submissions WHERE ai_task_id IS NOT NULL').get()).toEqual({ count: 0 });
  });
  it('retains the claimed baseline after publication and refuses a caller-selected newer base', async () => {
    const c = await claim(); const published = structuredClone(content); published.modules[1]!.title = 'Human updated';
    db.prepare("INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,?,'publish',?,?,?)").run(docId, 2, JSON.stringify(published), 'u_owner000000', new Date().toISOString());
    db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    const next = structuredClone(content); next.modules[0]!.title = 'AI updated';
    expect((await submit(c.task.id, c.claimId, next, token, 'new-base', 2)).json().error.code).toBe('TASK_BASE_MISMATCH');
    const accepted = await submit(c.task.id, c.claimId, next); expect(accepted.statusCode).toBe(201);
    const preview = (await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews/prepare`, headers: bearer(token), payload: {} })).json().preview;
    expect(preview.candidate.modules[0].title).toBe('AI updated'); expect(preview.candidate.modules[1].title).toBe('Human updated');
  });
  it('AT-24 expires leases, fences every late write, and stops after three attempts with durable ' +
     'audit history', async () => {
    const first = await claim();
    db.prepare('UPDATE ai_tasks SET claim_expires_at=? WHERE id=?').run(new Date(Date.now() - 1).toISOString(), first.task.id);
    expect(expireAiTasks(db)).toBe(1); expect(expireAiTasks(db)).toBe(0);
    const second = (await act(first.task.id, 'claim', {}, secondToken)).json(); expect(second.claimId).not.toBe(first.claimId);
    expect((await submit(first.task.id, first.claimId)).statusCode).toBe(409);
    expect((await act(first.task.id, 'complete', { claimId: first.claimId, submissionId: 'sub_missing' })).statusCode).toBe(409);
    expect((await act(first.task.id, 'fail', { claimId: first.claimId, reason: 'Late' })).statusCode).toBe(409);
    expect((await act(first.task.id, 'fail', { claimId: second.claimId, reason: 'Unavailable' }, secondToken)).json().task.status).toBe('approved');
    const third = (await act(first.task.id, 'claim')).json();
    db.prepare('UPDATE ai_tasks SET claim_expires_at=? WHERE id=?').run(new Date(Date.now() - 1).toISOString(), first.task.id);
    expect((await act(first.task.id, 'complete', { claimId: third.claimId, submissionId: 'sub_missing' })).statusCode).toBe(409);
    expect((await act(first.task.id, 'claim')).statusCode).toBe(409);
    expect(db.prepare('SELECT status,attempts FROM ai_tasks WHERE id=?').get(first.task.id)).toEqual({ status: 'failed', attempts: 3 });
    expect(db.prepare('SELECT status FROM ai_task_attempts WHERE task_id=? ORDER BY attempt').all(first.task.id)).toEqual([{ status: 'expired' }, { status: 'failed' }, { status: 'expired' }]);
  });
  it('rechecks AI, membership, scope and revocation on worker writes', async () => {
    const c = await claim(); const noSubmit = await issue(['read', 'ai_tasks']);
    expect((await act(c.task.id, 'fail', { claimId: c.claimId, reason: 'x' }, noSubmit)).statusCode).toBe(403);
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId); expect((await submit(c.task.id, c.claimId)).json().error.code).toBe('AI_DISABLED');
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    db.prepare("UPDATE space_members SET role='viewer' WHERE user_id='u_editor00000'").run(); db.prepare("UPDATE document_members SET role='viewer' WHERE user_id='u_editor00000'").run();
    expect((await act(c.task.id, 'fail', { claimId: c.claimId, reason: 'x' })).statusCode).toBe(403);
    db.prepare("UPDATE api_tokens SET revoked_at=? WHERE user_id='u_editor00000'").run(new Date().toISOString());
    expect((await act(c.task.id, 'complete', { claimId: c.claimId, submissionId: 'sub_missing' })).statusCode).toBe(401);
  });

  it('prevents personal tokens from reading, replacing or deleting private browser drafts', async () => {
    const draft = { ...content, title: 'Private draft' };
    expect((await app.inject({ method: 'PUT', url: `/api/v1/docs/${docId}/draft`, headers: human(editor), payload: { baseVersion: 1, content: draft } })).statusCode).toBe(200);
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({ method, url: `/api/v1/docs/${docId}/draft`, headers: bearer(token), ...(method === 'PUT' ? { payload: { baseVersion: 1, content } } : {}) });
      expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe('TOKEN_SCOPE');
    }
    expect((await app.inject({ url: `/api/v1/docs/${docId}/draft`, headers: human(editor) })).json().draft.content.title).toBe('Private draft');
  });
  it('validates task linkage on retries and rejects withdrawn work on completion', async () => {
    const c = await claim(); const response = await submit(c.task.id, c.claimId, content, token, 'task-retry'); const sub = response.json().submission;
    expect(response.statusCode).toBe(201);
    expect((await submit(c.task.id, c.claimId, content, secondToken, 'task-retry')).statusCode).toBe(409);
    expect((await submit(c.task.id, c.claimId, content, token, 'task-retry')).json().submission.id).toBe(sub.id);
    expect((await submit(undefined, undefined, content, token, 'task-retry')).json().error.code).toBe('IDEMPOTENCY_MISMATCH');
    db.prepare("UPDATE submissions SET status='withdrawn' WHERE id=?").run(sub.id);
    expect((await act(c.task.id, 'complete', { claimId: c.claimId, submissionId: sub.id })).json().error.code).toBe('TASK_SUBMISSION_MISMATCH');
  });
  it('AT-22 computes and reads previews without changing stored reviews and denies mutation with ' +
     'preview scope', async () => {
    const sub = (await submit()).json().submission;
    const saved = (await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: human(owner), payload: { submissionIds: [sub.id] } })).json().preview;
    const before = db.prepare('SELECT * FROM previews').all(); const previewToken = await issue(['preview']);
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews/prepare`, headers: bearer(previewToken), payload: { submissionIds: [sub.id] } });
    expect(response.statusCode).toBe(200); expect(response.json().preview.readOnly).toBe(true); expect(response.json().preview.id).toBeUndefined();
    expect((await app.inject({ url: `/api/v1/previews/${saved.id}`, headers: bearer(previewToken) })).statusCode).toBe(200);
    expect(db.prepare('SELECT * FROM previews').all()).toEqual(before);
    for (const path of [`/docs/${docId}/previews`, `/previews/${saved.id}/publish`, `/previews/${saved.id}/resolutions`]) expect((await app.inject({ method: 'POST', url: `/api/v1${path}`, headers: bearer(previewToken), payload: {} })).statusCode).toBe(403);
    const readToken = await issue(['read']); expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews/prepare`, headers: bearer(readToken), payload: {} })).statusCode).toBe(403);
    for (const ids of [[sub.id, sub.id], ['sub_missing']]) expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews/prepare`, headers: bearer(previewToken), payload: { submissionIds: ids } })).statusCode).toBeGreaterThanOrEqual(400);
    db.prepare("UPDATE submissions SET status='withdrawn' WHERE id=?").run(sub.id);
    const stale = await app.inject({ url: `/api/v1/previews/${saved.id}`, headers: bearer(previewToken) }); expect(stale.json().preview.status).toBe('stale'); expect(stale.json().preview.publishable).toBe(false);
    expect(db.prepare('SELECT * FROM previews').all()).toEqual(before);
  });
  async function conflictTask() {
    const a = structuredClone(content); a.modules[0]!.title = 'Option A';
    const b = structuredClone(content); b.modules[0]!.title = 'Option B';
    const ids = [(await submit(undefined, undefined, a)).json().submission.id, (await submit(undefined, undefined, b)).json().submission.id];
    const preview = (await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: human(owner), payload: { submissionIds: ids } })).json().preview;
    expect(preview.conflicts.length).toBeGreaterThan(0);
    const conflictId = preview.conflicts[0].id;
    const requested = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/conflicts/${encodeURIComponent(conflictId)}/ai-suggest`, headers: human(owner), payload: { revision: preview.revision } });
    expect(requested.statusCode, requested.body).toBe(200);
    const task = requested.json().task;
    const claimed = await act(task.id, 'claim'); expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().conflict.id).toBe(conflictId);
    return { task, preview, conflictId, claimId: claimed.json().claimId as string, ids };
  }
  it('AT-29 requires a suggestion before resolve completion and human adoption never publishes', async () => {
    const c = await conflictTask();
    expect((await act(c.task.id, 'complete', { claimId: c.claimId })).json().error.code).toBe('SUGGESTION_REQUIRED');
    const limited = await issue(['read', 'submit', 'ai_tasks']);
    expect((await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'Combined title', rationale: 'Preserves both intentions' }, limited)).statusCode).toBe(403);
    const suggested = await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'Combined title', rationale: 'Preserves both intentions' });
    expect(suggested.statusCode, suggested.body).toBe(200);
    const payload = { revision: c.preview.revision, conflictId: c.conflictId, choice: 'ai', taskId: c.task.id };
    expect((await app.inject({ method: 'POST', url: `/api/v1/previews/${c.preview.id}/resolutions`, headers: human(owner), payload })).statusCode).toBe(409);
    expect((await act(c.task.id, 'complete', { claimId: c.claimId })).json().task.status).toBe('done');
    expect((await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'Overwrite', rationale: 'Late' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/v1/previews/${c.preview.id}/resolutions`, headers: bearer(token), payload })).statusCode).toBe(403);
    const adopted = await app.inject({ method: 'POST', url: `/api/v1/previews/${c.preview.id}/resolutions`, headers: human(owner), payload });
    expect(adopted.statusCode, adopted.body).toBe(200); expect(adopted.json().preview.candidate.modules[0].title).toBe('Combined title');
    expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId)).toEqual({ current_version: 1 });
    const resolutions = (db.prepare('SELECT resolutions FROM previews WHERE id=?').get(c.preview.id) as { resolutions: string }).resolutions;
    expect(JSON.parse(resolutions)[c.conflictId].aiTaskId).toBe(c.task.id);
  });
  it.each(['revision', 'withdrawal', 'version', 'replacement preview'])('AT-29 rejects a stale suggestion after %s ' +
                                                                        'changes', async (change) => {
    const c = await conflictTask();
    expect((await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'Suggested', rationale: 'Reason' })).statusCode).toBe(200);
    expect((await act(c.task.id, 'complete', { claimId: c.claimId })).statusCode).toBe(200);
    if (change === 'revision') db.prepare('UPDATE previews SET revision=revision+2 WHERE id=?').run(c.preview.id);
    if (change === 'withdrawal') db.prepare("UPDATE submissions SET status='withdrawn' WHERE id=?").run(c.ids[0]);
    if (change === 'version') db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    if (change === 'replacement preview') await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: human(owner), payload: { submissionIds: c.ids } });
    const revision = (db.prepare('SELECT revision FROM previews WHERE id=?').get(c.preview.id) as { revision: number }).revision;
    const response = await app.inject({ method: 'POST', url: `/api/v1/previews/${c.preview.id}/resolutions`, headers: human(owner), payload: { revision, conflictId: c.conflictId, choice: 'ai', taskId: c.task.id } });
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('PREVIEW_STALE');
    expect(JSON.parse((db.prepare('SELECT resolutions FROM previews WHERE id=?').get(c.preview.id) as { resolutions: string }).resolutions)).toEqual({});
  });

  it('AT-29 does not hide invalid AI values behind other unresolved conflicts', async () => {
    const a = structuredClone(content); const b = structuredClone(content);
    for (let index = 0; index < 2; index++) { a.modules[index]!.title = 'Alpha'; b.modules[index]!.title = 'Beta'; }
    const ids = [(await submit(undefined, undefined, a)).json().submission.id, (await submit(undefined, undefined, b)).json().submission.id];
    const preview = (await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: human(owner), payload: { submissionIds: ids } })).json().preview;
    expect(preview.conflicts).toHaveLength(2);
    const task = (await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/conflicts/${encodeURIComponent(preview.conflicts[0].id)}/ai-suggest`, headers: human(owner), payload: { revision: preview.revision } })).json().task;
    const claimed = (await act(task.id, 'claim')).json();
    const rejected = await act(task.id, 'suggest-resolution', { claimId: claimed.claimId, value: 'x'.repeat(300), rationale: 'Invalid title' });
    expect(rejected.statusCode).toBe(422); expect(rejected.json().error.code).toBe('INVALID_SUGGESTION');
    expect(db.prepare('SELECT result FROM ai_tasks WHERE id=?').get(task.id)).toEqual({ result: null });
  });
  it('limits cross-document task discovery to current AI scope and membership', async () => {
    const task = await request();
    const tasks = (await app.inject({ url: '/api/v1/ai-tasks', headers: bearer(token) })).json().tasks;
    expect(tasks.some((item: { id: string }) => item.id === task.id)).toBe(true);
    const limited = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: human(editor), payload: { scopes: ['ai_tasks'], docIds: [] } });
    expect((await app.inject({ url: '/api/v1/ai-tasks', headers: bearer(limited.json().token) })).json().tasks).toEqual([]);
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId);
    expect((await app.inject({ url: '/api/v1/ai-tasks', headers: bearer(token) })).json().tasks).toEqual([]);
  });
  it('AT-29 cannot reuse a suggestion after claim expiry and rejects invalid candidate values', async () => {
    const c = await conflictTask();
    const before = db.prepare('SELECT * FROM previews WHERE id=?').get(c.preview.id);
    expect((await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'x'.repeat(300), rationale: 'Invalid title length' })).json().error.code).toBe('INVALID_SUGGESTION');
    expect(db.prepare('SELECT * FROM previews WHERE id=?').get(c.preview.id)).toEqual(before);
    expect((await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'Ready', rationale: 'Explanation' })).statusCode).toBe(200);
    db.prepare('UPDATE ai_tasks SET claim_expires_at=? WHERE id=?').run(new Date(Date.now() - 1).toISOString(), c.task.id);
    const next = (await act(c.task.id, 'claim')).json();
    expect((await act(c.task.id, 'complete', { claimId: next.claimId })).json().error.code).toBe('SUGGESTION_REQUIRED');
    expect((await act(c.task.id, 'suggest-resolution', { claimId: c.claimId, value: 'Old', rationale: 'Old worker' })).statusCode).toBe(409);
    db.prepare('UPDATE previews SET revision=revision+1 WHERE id=?').run(c.preview.id);
    expect((await act(c.task.id, 'suggest-resolution', { claimId: next.claimId, value: 'Late', rationale: 'Changed preview' })).json().error.code).toBe('PREVIEW_STALE');
  });

});
