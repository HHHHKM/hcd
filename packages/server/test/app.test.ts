import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';

const origin = 'http://localhost:5173';
const writeHeaders = (cookie: string) => ({ cookie, origin, 'x-hcd-request': '1' });

describe('HCD service', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createApp({ databasePath: ':memory:', secretKey: 'integration-test-secret', appUrl: origin, seed: true });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('AT-19 does not create demo accounts unless seeding is explicitly enabled', async () => {
    const unseeded = createApp({ databasePath: ':memory:', secretKey: 'integration-test-secret', appUrl: origin });
    await unseeded.ready();
    try {
      const response = await unseeded.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
      expect(response.statusCode).toBe(401);
    } finally {
      await unseeded.close();
    }
  });

  async function login(email: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-hcd-request': '1' }, payload: { email, password: 'hcd-demo-2026' } });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    return String(setCookie).split(';')[0]!;
  }

  async function readDoc(cookie: string) {
    const response = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    return response.json() as { content: { id: string; title: string; modules: Array<{ id: string; title: string; blocks: Array<Record<string, unknown>> }> }; doc: { currentVersion: number } };
  }

  it('AT-11 requires a same-origin request marker for cookie mutations', async () => {
    const owner = await login('d@example.com');
    const missingMarker = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: { cookie: owner, origin }, payload: { name: 'Blocked' } });
    expect(missingMarker.statusCode).toBe(403);
    expect(missingMarker.json().error.code).toBe('CSRF_REQUIRED');
    const foreignOrigin = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: { ...writeHeaders(owner), origin: 'https://attacker.example' }, payload: { name: 'Blocked' } });
    expect(foreignOrigin.statusCode).toBe(403);
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: writeHeaders(owner), payload: { name: 'Research' } });
    expect(accepted.statusCode).toBe(201);
  });

  it('AT-11 responds with 404 when submission, preview, task, or comment records do not exist', async () => {
    const owner = await login('d@example.com');
    const routes = [
      ['GET', '/submissions/missing'],
      ['POST', '/submissions/missing/withdraw'],
      ['POST', '/submissions/missing/reject'],
      ['GET', '/previews/missing'],
      ['POST', '/previews/missing/resolutions'],
      ['POST', '/previews/missing/publish'],
      ['POST', '/ai-tasks/missing/approve'],
      ['POST', '/ai-tasks/missing/reject'],
      ['POST', '/ai-tasks/missing/cancel'],
      ['POST', '/comments/missing/resolve'],
      ['POST', '/comments/missing/reopen'],
      ['PATCH', '/comments/missing'],
      ['DELETE', '/comments/missing'],
    ] as const;
    const responses = await Promise.all(routes.map(([method, url]) => app.inject({ method, url: `/api/v1${url}`, headers: writeHeaders(owner) })));
    responses.forEach((response, index) => {
      expect(response.statusCode, routes[index]!.join(' ')).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });
  });

  it('AT-11 requires submission author, current editor role, and PAT submit scope within the ' +
     'subject document for withdrawal', async () => {
    const editor = await login('a@example.com');
    const owner = await login('d@example.com');
    const { content } = await readDoc(editor);
    const submission = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...writeHeaders(editor), 'idempotency-key': 'withdraw-scope' }, payload: { baseVersion: 1, content } });
    expect(submission.statusCode).toBe(201);
    const submissionId = submission.json().submission.id as string;
    const otherDoc = await app.inject({ method: 'POST', url: '/api/v1/docs', headers: writeHeaders(owner), payload: { spaceId: 'sp_demo000000', title: 'Other PAT document' } });
    expect(otherDoc.statusCode).toBe(201);
    const issue = async (cookie: string, scopes: string[], docIds: string[]) => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: writeHeaders(cookie), payload: { scopes, docIds } });
      expect(response.statusCode).toBe(201);
      return response.json().token as string;
    };
    const withdraw = (token: string) => app.inject({ method: 'POST', url: `/api/v1/submissions/${submissionId}/withdraw`, headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' } });
    const readOnly = await issue(editor, ['read'], ['d_aaaaaaab']);
    const wrongDoc = await issue(editor, ['submit'], [otherDoc.json().doc.id]);
    const valid = await issue(editor, ['submit'], ['d_aaaaaaab']);
    const otherAuthor = await issue(owner, ['submit'], ['d_aaaaaaab']);
    expect((await withdraw(readOnly)).statusCode).toBe(403);
    expect((await withdraw(wrongDoc)).statusCode).toBe(404);
    expect((await withdraw(otherAuthor)).statusCode).toBe(404);
    const spaceRole = (role: string) => app.inject({ method: 'PUT', url: '/api/v1/spaces/sp_demo000000/members/u_editor00000', headers: writeHeaders(owner), payload: { role } });
    const docRole = (role: string) => app.inject({ method: 'PUT', url: '/api/v1/docs/d_aaaaaaab/members/u_editor00000', headers: writeHeaders(owner), payload: { role } });
    expect((await spaceRole('viewer')).statusCode).toBe(204);
    expect((await docRole('viewer')).statusCode).toBe(204);
    expect((await withdraw(valid)).statusCode).toBe(403);
    const pending = await app.inject({ method: 'GET', url: `/api/v1/submissions/${submissionId}`, headers: { cookie: owner } });
    expect(pending.json().submission.status).toBe('pending');
    expect((await spaceRole('editor')).statusCode).toBe(204);
    const accepted = await withdraw(valid);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().submission.status).toBe('withdrawn');
  });

  it('AT-05 stores drafts and makes idempotent submissions that publish once', async () => {
    const editor = await login('a@example.com');
    const owner = await login('d@example.com');
    const { content } = await readDoc(editor);
    const changed = structuredClone(content);
    changed.modules[0]!.title = '背景与增长机会';
    const draft = await app.inject({ method: 'PUT', url: '/api/v1/docs/d_aaaaaaab/draft', headers: writeHeaders(editor), payload: { baseVersion: 1, content: changed } });
    expect(draft.statusCode).toBe(200);
    const submit = () => app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...writeHeaders(editor), 'idempotency-key': 'test-key-1' }, payload: { baseVersion: 1, content: changed, message: 'Rename the section' } });
    const first = await submit();
    expect(first.statusCode).toBe(201);
    const second = await submit();
    expect(second.statusCode).toBe(200);
    expect(second.json().submission.id).toBe(first.json().submission.id);
    const mismatch = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...writeHeaders(editor), 'idempotency-key': 'test-key-1' }, payload: { baseVersion: 1, content, message: 'Different body' } });
    expect(mismatch.statusCode).toBe(409);
    const previewResponse = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: writeHeaders(owner), payload: { submissionIds: [first.json().submission.id] } });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json().preview;
    expect(preview.publishable).toBe(true);
    const publish = () => app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/publish`, headers: writeHeaders(owner), payload: { revision: preview.revision } });
    const published = await publish();
    expect(published.statusCode).toBe(200);
    expect(published.json().version.version).toBe(2);
    expect(published.json().version.content.modules[0].title).toBe('背景与增长机会');
    const duplicate = await publish();
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().version.version).toBe(2);
    const head = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/head', headers: { cookie: owner } });
    expect(head.json().currentVersion).toBe(2);
  });

  it('AT-03 detects overlapping submissions and requires a revisioned resolution', async () => {
    const owner = await login('d@example.com');
    const editorA = await login('a@example.com');
    const editorB = await login('b@example.com');
    const { content } = await readDoc(editorA);
    const changedA = structuredClone(content); changedA.modules[0]!.title = 'A version';
    const changedB = structuredClone(content); changedB.modules[0]!.title = 'B version';
    const submit = (cookie: string, content: typeof changedA, key: string) => app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...writeHeaders(cookie), 'idempotency-key': key }, payload: { baseVersion: 1, content } });
    const a = await submit(editorA, changedA, 'overlap-a');
    const b = await submit(editorB, changedB, 'overlap-b');
    const previewResponse = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: writeHeaders(owner), payload: { submissionIds: [a.json().submission.id, b.json().submission.id] } });
    const preview = previewResponse.json().preview;
    expect(preview.publishable).toBe(false);
    expect(preview.conflicts).toHaveLength(1);
    const conflict = preview.conflicts[0];
    const staleResolution = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/resolutions`, headers: writeHeaders(owner), payload: { revision: preview.revision - 1, conflictId: conflict.id, choice: 'keep_current' } });
    expect(staleResolution.statusCode).toBe(409);
    const resolved = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/resolutions`, headers: writeHeaders(owner), payload: { revision: preview.revision, conflictId: conflict.id, choice: 'keep_current' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().preview.publishable).toBe(true);
    const published = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/publish`, headers: writeHeaders(owner), payload: { revision: resolved.json().preview.revision } });
    expect(published.statusCode).toBe(200);
    expect(published.json().version.content.modules[0].title).toBe('A version');
  });

  it('AT-09 sanitizes HTML imports and confirms them as an immutable import version', async () => {
    const owner = await login('d@example.com');
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: writeHeaders(owner), payload: { spaceId: 'sp_demo000000', filename: 'unsafe.html', html: '<script>alert(1)</script><h1>Plan</h1><p onclick="x()">Read <strong>this</strong></p><a href="javascript:alert(2)">bad link</a>' } });
    expect(imported.statusCode).toBe(201);
    const { import: item } = imported.json();
    expect(item.report.removed).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(item.content)).not.toContain('alert(');
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/imports/${item.id}/confirm`, headers: writeHeaders(owner), payload: { title: 'Imported plan' } });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().doc.title).toBe('Imported plan');
    const repeated = await app.inject({ method: 'POST', url: `/api/v1/imports/${item.id}/confirm`, headers: writeHeaders(owner), payload: { title: 'Ignored retry' } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().doc.id).toBe(confirmed.json().doc.id);
    const versions = await app.inject({ method: 'GET', url: `/api/v1/docs/${item.content.id}/versions`, headers: { cookie: owner } });
    expect(versions.json().versions[0].kind).toBe('import');
    const exported = await app.inject({ method: 'GET', url: `/api/v1/docs/${item.content.id}/export?format=html`, headers: { cookie: owner } });
    expect(exported.headers['content-type']).toContain('text/html');
    expect(exported.body).not.toContain('<script>');
    expect(exported.body).toContain('Read');
  });

  it('AT-21 limits personal tokens to their read, comment, or submit scope', async () => {
    const owner = await login('d@example.com');
    const issued = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: writeHeaders(owner), payload: { name: 'read only', scopes: ['read'] } });
    expect(issued.statusCode).toBe(201);
    const token = issued.json().token as string;
    const read = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { authorization: `Bearer ${token}` } });
    expect(read.statusCode).toBe(200);
    const forbiddenComment = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/comments', headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' }, payload: { body: 'no comment scope' } });
    expect(forbiddenComment.statusCode).toBe(403);
    const forbiddenSettings = await app.inject({ method: 'PATCH', url: '/api/v1/docs/d_aaaaaaab', headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' }, payload: { aiEnabled: true } });
    expect(forbiddenSettings.statusCode).toBe(403);
    const forbiddenSpace = await app.inject({ method: 'POST', url: '/api/v1/spaces', headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' }, payload: { name: 'Nope' } });
    expect(forbiddenSpace.statusCode).toBe(403);
  });

  it('AT-26 keeps AI off by default and routes requested tasks through owner approval', async () => {
    const owner = await login('d@example.com');
    const commenter = await login('f@example.com');
    const created = await app.inject({ method: 'POST', url: '/api/v1/docs', headers: writeHeaders(owner), payload: { spaceId: 'sp_demo000000', title: 'AI request test' } });
    expect(created.statusCode).toBe(201);
    const docId = created.json().doc.id as string;
    expect(created.json().doc.aiEnabled).toBe(false);
    const comment = (body: string) => app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/comments`, headers: writeHeaders(commenter), payload: { body } });
    const blockedRequest = await comment('Please help me @[AI](ai)');
    expect(blockedRequest.statusCode).toBe(201);
    expect(blockedRequest.json().aiTask).toBeUndefined();
    const enabled = await app.inject({ method: 'PATCH', url: `/api/v1/docs/${docId}`, headers: writeHeaders(owner), payload: { aiEnabled: true } });
    expect(enabled.statusCode).toBe(200);
    const taskRequest = await comment('Please help me @[AI](ai)');
    expect(taskRequest.json().aiTask.status).toBe('requested');
    const approved = await app.inject({ method: 'POST', url: `/api/v1/ai-tasks/${taskRequest.json().aiTask.id}/approve`, headers: writeHeaders(owner) });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().task.status).toBe('approved');
    const tasks = await app.inject({ method: 'GET', url: `/api/v1/docs/${docId}/ai-tasks`, headers: { cookie: owner } });
    expect(tasks.json().tasks).toHaveLength(1);
    expect(tasks.json().tasks[0].status).toBe('approved');
  });

  it('AT-04 marks superseded previews stale and restores a historical snapshot through publish', async () => {
    const owner = await login('d@example.com');
    const editor = await login('a@example.com');
    const { content } = await readDoc(editor);
    const changed = structuredClone(content);
    changed.modules[1]!.title = 'Quarterly goals';
    const submission = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...writeHeaders(editor), 'idempotency-key': 'restore-flow' }, payload: { baseVersion: 1, content: changed } });
    const firstPreviewResponse = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: writeHeaders(owner), payload: { submissionIds: [submission.json().submission.id] } });
    const firstPreview = firstPreviewResponse.json().preview;
    const secondPreviewResponse = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: writeHeaders(owner), payload: { submissionIds: [submission.json().submission.id] } });
    const secondPreview = secondPreviewResponse.json().preview;
    expect(secondPreview.status).toBe('open');
    const secondPublish = await app.inject({ method: 'POST', url: `/api/v1/previews/${secondPreview.id}/publish`, headers: writeHeaders(owner), payload: { revision: secondPreview.revision } });
    expect(secondPublish.statusCode).toBe(200);
    const stale = await app.inject({ method: 'GET', url: `/api/v1/previews/${firstPreview.id}`, headers: { cookie: owner } });
    expect(stale.json().preview.status).toBe('stale');
    const stalePublish = await app.inject({ method: 'POST', url: `/api/v1/previews/${firstPreview.id}/publish`, headers: writeHeaders(owner), payload: { revision: firstPreview.revision } });
    expect(stalePublish.statusCode).toBe(409);
    const restore = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/restore', headers: writeHeaders(owner), payload: { version: 1 } });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().preview.kind).toBe('restore');
    const restorePreview = restore.json().preview;
    const restored = await app.inject({ method: 'POST', url: `/api/v1/previews/${restorePreview.id}/publish`, headers: writeHeaders(owner), payload: { revision: restorePreview.revision } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().version.version).toBe(3);
    expect(restored.json().version.content.modules[1].title).toBe('季度目标');
    const oldVersion = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/versions/1', headers: { cookie: owner } });
    expect(oldVersion.json().version.content.modules[1].title).toBe('季度目标');
  });
});
