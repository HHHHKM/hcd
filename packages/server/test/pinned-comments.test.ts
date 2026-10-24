import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';

const origin = 'http://localhost:5173';
const secretKey = 'pinned-comments-test-secret';
const docId = 'd_aaaaaaab';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
type Thread = { root: { id: string; body: string }; replies: Array<{ id: string; body: string }> };
let dataDir: string;
let db: HcdDatabase;
let app: FastifyInstance;
let owner: string;
let sent: NotificationMail[];

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hcd-pinned-comments-'));
  db = openDatabase(join(dataDir, 'hcd.sqlite'));
  sent = [];
  app = makeApp(true);
  const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
  expect(result.statusCode).toBe(200);
  owner = String(result.headers['set-cookie']).split(';')[0]!;
});
afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
function makeApp(seed = false) { return createApp({ dataDir, db, seed, appUrl: origin, secretKey, mailDelivery: { async send(mail) { sent.push(mail); } } }); }
async function comment(body: string, parentId?: string) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/comments`, headers: headers(owner), payload: { body, parentId } });
  expect(response.statusCode, response.body).toBe(201); return response.json().comment.id as string;
}
async function link(versionPin?: number, role = 'viewer') {
  const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/share-links`, headers: headers(owner), payload: { role, versionPin } });
  expect(response.statusCode, response.body).toBe(201);
  return { id: response.json().link.id as string, path: `/api/v1/s/${new URL(response.json().link.url).pathname.split('/').pop()!}` };
}
async function guest(path: string) {
  const start = await app.inject({ method: 'POST', url: `${path}/verify/start`, headers: headers(), payload: { email: 'guest@example.com', name: 'Pinned guest', locale: 'en' } });
  expect(start.statusCode, start.body).toBe(202);
  await createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick();
  const code = sent.filter(mail => mail.to === 'guest@example.com').at(-1)!.text.match(/\b\d{6}\b/)![0];
  const finish = await app.inject({ method: 'POST', url: `${path}/verify/finish`, headers: headers(), payload: { challengeId: start.json().challengeId, code } });
  expect(finish.statusCode, finish.body).toBe(200);
  return (finish.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
}
async function publish() {
  const document = await app.inject({ method: 'GET', url: `/api/v1/docs/${docId}`, headers: { cookie: owner } });
  const { content, doc } = document.json(); content.title += ' updated';
  const submission = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { ...headers(owner), 'idempotency-key': `pinned-${doc.currentVersion}` }, payload: { baseVersion: doc.currentVersion, content } });
  expect(submission.statusCode, submission.body).toBe(201);
  const preview = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: headers(owner), payload: { submissionIds: [submission.json().submission.id] } });
  expect(preview.statusCode, preview.body).toBe(200);
  const published = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(owner), payload: { revision: preview.json().preview.revision } });
  expect(published.statusCode, published.body).toBe(200);
}

it('AT-32 B2 filters pinned threads and member replies by creation version while keeping every ' +
   'guest-thread reply', async () => {
  const earlyRoot = await comment('member root at v1');
  const earlyReply = await comment('member reply at v1', earlyRoot);
  const pinned = await link(1, 'commenter');
  const current = await link();
  await publish();
  const laterRoot = await comment('private future member root');
  const laterReply = await comment('private future member reply', earlyRoot);
  const guestCookie = await guest(pinned.path);
  const postGuest = (body: string, parentId?: string) => app.inject({ method: 'POST', url: `${pinned.path}/comments`, headers: headers(guestCookie), payload: { body, parentId } });
  const guestRoot = await postGuest('guest root on fixed v1');
  expect(guestRoot.statusCode, guestRoot.body).toBe(201);
  const memberGuestReply = await comment('member response to external guest', guestRoot.json().comment.id);
  const guestReply = await postGuest('guest response on fixed v1', earlyRoot);
  expect(guestReply.statusCode, guestReply.body).toBe(201);
  const read = await app.inject({ method: 'GET', url: `${pinned.path}/comments`, headers: { cookie: guestCookie } });
  expect(read.statusCode).toBe(200);
  const threads = read.json().threads as Thread[];
  expect(threads.map(thread => thread.root.id)).toContain(earlyRoot);
  expect(threads.map(thread => thread.root.id)).not.toContain(laterRoot);
  expect(threads.find(thread => thread.root.id === earlyRoot)!.replies.map(reply => reply.id)).toEqual([earlyReply, guestReply.json().comment.id]);
  expect(threads.find(thread => thread.root.id === guestRoot.json().comment.id)!.replies.map(reply => reply.id)).toEqual([memberGuestReply]);
  expect(read.body).not.toContain('private future');
  expect((await postGuest('Must not join an invisible thread', laterRoot)).statusCode).toBe(404);
  const currentThreads = (await app.inject({ method: 'GET', url: `${current.path}/comments` })).json().threads as Thread[];
  expect(currentThreads.map(thread => thread.root.id)).toContain(laterRoot);
  expect(currentThreads.find(thread => thread.root.id === earlyRoot)!.replies.map(reply => reply.id)).toContain(laterReply);
  const pinnedDoc = await app.inject({ method: 'GET', url: `${pinned.path}/doc`, headers: { cookie: guestCookie } });
  expect(pinnedDoc.json().doc).toMatchObject({ version: 1 });
  expect(pinnedDoc.json().doc).not.toHaveProperty('currentVersion');
  expect((await app.inject({ method: 'GET', url: `${current.path}/doc` })).json().doc).toMatchObject({ version: 2, currentVersion: 2 });
});

it('AT-32 B2 upgrades legacy comments using guest pins or their creation-time published version ' +
   'without losing data', async () => {
  const early = await comment('legacy member at v1');
  const pinned = await link(1, 'commenter');
  await publish();
  const later = await comment('legacy member at v2');
  const guestCookie = await guest(pinned.path);
  const guestRoot = await app.inject({ method: 'POST', url: `${pinned.path}/comments`, headers: headers(guestCookie), payload: { body: 'legacy guest still seeing v1' } });
  expect(guestRoot.statusCode).toBe(201);
  const guestReply = await app.inject({ method: 'POST', url: `${pinned.path}/comments`, headers: headers(guestCookie), payload: { body: 'legacy guest reply still seeing v1', parentId: early } });
  expect(guestReply.statusCode).toBe(201);
  db.prepare('UPDATE versions SET created_at=? WHERE doc_id=? AND version=1').run('2026-01-01T00:00:00.000Z', docId);
  db.prepare('UPDATE versions SET created_at=? WHERE doc_id=? AND version=2').run('2026-01-03T00:00:00.000Z', docId);
  db.prepare('UPDATE comments SET created_at=? WHERE id=?').run('2026-01-02T00:00:00.000Z', early);
  db.prepare('UPDATE comments SET created_at=? WHERE id IN (?,?,?)').run('2026-01-04T00:00:00.000Z', later, guestRoot.json().comment.id, guestReply.json().comment.id);
  // The latest head and relocated anchors cannot be used to infer creation versions.
  db.prepare('UPDATE comments SET anchor=? WHERE id=?').run('{"version":2}', early);
  const before = db.prepare('SELECT id,body,anchor,created_at FROM comments ORDER BY id').all();
  await app.close();
  const columns = db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>;
  if (columns.some(column => column.name === 'created_version')) db.exec('ALTER TABLE comments DROP COLUMN created_version');
  db.close(); db = openDatabase(join(dataDir, 'hcd.sqlite')); app = makeApp();
  expect(db.prepare('SELECT id,body,anchor,created_at FROM comments ORDER BY id').all()).toEqual(before);
  expect((db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>).map(column => column.name)).toContain('created_version');
  expect(db.prepare('SELECT created_version FROM comments WHERE id=?').get(early)).toEqual({ created_version: 1 });
  expect(db.prepare('SELECT created_version FROM comments WHERE id=?').get(later)).toEqual({ created_version: 2 });
  for (const id of [guestRoot.json().comment.id, guestReply.json().comment.id]) expect(db.prepare('SELECT created_version FROM comments WHERE id=?').get(id)).toEqual({ created_version: 1 });
  const visible = await app.inject({ method: 'GET', url: `${pinned.path}/comments`, headers: { cookie: guestCookie } });
  const threads = visible.json().threads as Thread[];
  expect(threads.map(thread => thread.root.id)).toContain(guestRoot.json().comment.id);
  expect(threads.map(thread => thread.root.id)).toContain(early);
  expect(threads.map(thread => thread.root.id)).not.toContain(later);
  expect(threads.find(thread => thread.root.id === early)!.replies.map(reply => reply.id)).toContain(guestReply.json().comment.id);
  expect(db.pragma('foreign_key_check')).toEqual([]);
});
