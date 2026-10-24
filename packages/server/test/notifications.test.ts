import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
describe('discussion notifications', () => {
  let app: FastifyInstance; let db: HcdDatabase;
  beforeEach(async () => { db = openDatabase(':memory:'); app = createApp({ db, seed: true, secretKey: 'notification-test-secret', appUrl: 'http://localhost:5173' }); await app.ready(); db.prepare('DELETE FROM notifications').run(); });
  afterEach(async () => { await app.close(); db.close(); });
  async function login(email: string) { const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(result.statusCode).toBe(200); return String(result.headers['set-cookie']).split(';')[0]!; }
  async function comment(cookie: string, body: string, parentId?: string) { const result = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/comments', headers: headers(cookie), payload: { body, parentId } }); expect(result.statusCode).toBe(201); return result.json().comment.id as string; }
  async function list(cookie: string) { const result = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie } }); expect(result.statusCode).toBe(200); return result.json().notifications as Array<{ id: string; kind: string; docTitle: string; read_at: string | null; payload: { commentId: string; actor: { id: string } } }>; }

  it('AT-34 deduplicates mentions, excludes self and outsiders, and notifies active thread ' +
     'participants', async () => {
    const owner = await login('d@example.com'); const editor = await login('a@example.com'); const commenter = await login('f@example.com');
    const id = await comment(owner, '@[Editor](u_editor00000) @[Again](u_editor00000) @[Me](u_owner000000) @[Unknown](u_missing)');
    expect(await list(owner)).toHaveLength(0);
    expect(await list(editor)).toMatchObject([{ kind: 'mention', docTitle: 'Q4 增长方案', payload: { commentId: id, actor: { id: 'u_owner000000' } } }]);
    const reply = await comment(editor, 'First reply', id);
    expect(await list(owner)).toMatchObject([{ kind: 'reply', payload: { commentId: reply } }]);
    const last = await comment(commenter, '@[Owner](u_owner000000) thanks', id);
    expect((await list(owner)).filter((item) => item.payload.commentId === last)).toMatchObject([{ kind: 'mention' }]);
    expect((await list(editor)).filter((item) => item.payload.commentId === last)).toMatchObject([{ kind: 'reply' }]);
    expect(await list(commenter)).toHaveLength(0);
    db.prepare('DELETE FROM space_members WHERE user_id=?').run('u_editor00000');
    db.prepare('DELETE FROM document_members WHERE user_id=?').run('u_editor00000');
    expect(await list(editor)).toHaveLength(0);
    const before = (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get('u_editor00000') as { n: number }).n;
    await comment(owner, '@[Editor](u_editor00000) removed access', id);
    expect((db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get('u_editor00000') as { n: number }).n).toBe(before);
  });

  it('AT-34 isolates read state by user, validates requests, and denies PAT access to the inbox', async () => {
    const owner = await login('d@example.com'); const editor = await login('a@example.com');
    await comment(owner, '@[Editor](u_editor00000)');
    const [item] = await list(editor);
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count', headers: { cookie: editor } })).json()).toEqual({ count: 1 });
    const mark = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/notifications/read', headers: headers(cookie), payload });
    expect((await mark(owner, { ids: [item!.id] })).statusCode).toBe(204);
    expect((await list(editor))[0]!.read_at).toBeNull();
    expect((await mark(editor, { all: 'yes' })).statusCode).toBe(400);
    expect((await mark(editor, { ids: [3] })).statusCode).toBe(400);
    expect((await mark(editor, { ids: [item!.id] })).statusCode).toBe(204);
    const first = (await list(editor))[0]!.read_at;
    expect(first).toBeTruthy(); expect((await mark(editor, { ids: [item!.id] })).statusCode).toBe(204);
    expect((await list(editor))[0]!.read_at).toBe(first);
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications?unread=1', headers: { cookie: editor } })).json().notifications).toEqual([]);
    const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(editor), payload: { scopes: ['read'], docIds: ['d_aaaaaaab'] } });
    for (const url of ['/api/v1/notifications', '/api/v1/notifications/unread-count']) expect((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token.json().token}` } })).statusCode).toBe(403);
  });

  it('AT-34 requires current comment permission for deleting a prior comment and preserves a ' +
     'tombstone', async () => {
    const editor = await login('a@example.com');
    const id = await comment(editor, 'To delete');
    db.prepare("UPDATE space_members SET role='viewer' WHERE user_id=?").run('u_editor00000');
    db.prepare("UPDATE document_members SET role='viewer' WHERE user_id=?").run('u_editor00000');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/comments/${id}`, headers: headers(editor) })).statusCode).toBe(403);
    db.prepare("UPDATE space_members SET role='editor' WHERE user_id=?").run('u_editor00000');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/comments/${id}`, headers: headers(editor) })).statusCode).toBe(204);
    const response = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/comments', headers: { cookie: editor } });
    const deleted = response.json().threads.find((thread: { root: { id: string } }) => thread.root.id === id).root;
    expect(deleted.body).toBe(''); expect(deleted.deletedAt).toBeTruthy();
  });
});
