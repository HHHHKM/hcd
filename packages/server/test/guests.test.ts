import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Document } from '../../core/src/model';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';

const origin = 'https://app.test'; const secretKey = 'guest-verification-integration-secret';
const headers = (cookie = '') => ({ cookie, host: 'app.test', origin, 'x-hcd-request': '1' });
type Link = { id: string; token: string };
describe('verified guest sharing', () => {
  let app: FastifyInstance; let db: HcdDatabase; let owner: string; let sent: NotificationMail[]; let dataDir: string;
  function makeApp(seed = false) { return createApp({ db, dataDir, seed, secretKey, appUrl: origin, renderUrl: 'https://render.test', mailDelivery: { async send(mail) { sent.push(mail); } } }); }
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hcd-guests-')); db = openDatabase(join(dataDir, 'hcd.sqlite')); sent = []; app = makeApp(true);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    owner = String(login.headers['set-cookie']).split(';')[0]!;
  });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function createLink(docId = 'd_aaaaaaab', extra: Record<string, unknown> = {}): Promise<Link> {
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/share-links`, headers: headers(owner), payload: { role: 'commenter', ...extra } });
    expect(response.statusCode, response.body).toBe(201); return { id: response.json().link.id, token: new URL(response.json().link.url).pathname.split('/').pop()! };
  }
  const path = (link: Link, suffix: string) => `/api/v1/s/${link.token}/${suffix}`;
  async function start(link: Link, email = 'guest@example.com') {
    return app.inject({ method: 'POST', url: path(link, 'verify/start'), headers: headers(), payload: { email, name: '<Guest>', locale: 'en' } });
  }
  async function tick() { await createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick(); }
  function codeFor(email: string) { return sent.filter((mail) => mail.to === email).at(-1)!.text.match(/\b\d{6}\b/)![0]; }
  const finish = (link: Link, challengeId: string, code: string) => app.inject({ method: 'POST', url: path(link, 'verify/finish'), headers: headers(), payload: { challengeId, code } });
  async function verified(link: Link, email = 'guest@example.com') {
    const challenge = await start(link, email); expect(challenge.statusCode, challenge.body).toBe(202); await tick();
    const result = await finish(link, challenge.json().challengeId, codeFor(email)); expect(result.statusCode, result.body).toBe(200);
    return { cookie: (result.headers['set-cookie'] as string[])[0]!.split(';')[0]!, guest: result.json().guest, result };
  }
  it('AT-33 requires verification on every commenter resource and binds single-use codes and ' +
     'sessions to the exact link', async () => {
    const first = await createLink(); const second = await createLink();
    for (const suffix of ['doc', 'comments', 'assets/as_aaaaaaaaaaaa', 'assets/as_aaaaaaaaaaaa/url']) {
      const result = await app.inject({ method: 'GET', url: path(first, suffix), headers: headers(owner) });
      expect(result.statusCode).toBe(401); expect(result.json().error.code).toBe('GUEST_VERIFICATION_REQUIRED'); expect(result.body).not.toContain('Q4');
    }
    const started = await start(first); const challenge = started.json().challengeId; await tick(); const code = codeFor('guest@example.com');
    const record = db.prepare('SELECT code_hash FROM guest_challenges WHERE id=?').get(challenge) as { code_hash: string };
    expect(record.code_hash).not.toBe(code); expect(started.body).not.toContain(code);
    expect((await finish(second, challenge, code)).statusCode).toBe(400);
    const pair = await Promise.all([finish(first, challenge, code), finish(first, challenge, code)]);
    expect(pair.map((result) => result.statusCode).sort()).toEqual([200, 400]);
    const accepted = pair.find((response) => response.statusCode === 200)!;
    const cookies = accepted.headers['set-cookie'] as string[]; expect(cookies).toHaveLength(2);
    for (const cookie of cookies) { expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Max-Age=604800'); expect(cookie).not.toContain('Domain='); }
    expect(cookies[0]).toContain(`Path=/s/${first.token}`); expect(cookies[1]).toContain(`Path=/api/v1/s/${first.token}`);
    const cookie = cookies[0]!.split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: path(first, 'doc'), headers: headers(cookie) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: path(second, 'doc'), headers: headers(cookie) })).statusCode).toBe(401);
    for (const url of ['/api/v1/docs', '/api/v1/docs/d_aaaaaaab/submissions', '/api/v1/docs/d_aaaaaaab/members', '/api/v1/docs/d_zzzzzzzz']) expect((await app.inject({ method: 'GET', url, headers: headers(cookie) })).statusCode).toBe(401);
    expect(db.prepare("SELECT 1 FROM users WHERE email='guest@example.com'").get()).toBeUndefined();
    db.prepare("UPDATE guest_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await app.inject({ method: 'GET', url: path(first, 'doc'), headers: headers(cookie) })).statusCode).toBe(401);
  });
  it('AT-33 keeps failure counts through resends and process restarts and locks the email across ' +
     'links after five failures', async () => {
    const link = await createLink(); const other = await createLink(); const initial = await start(link); await tick(); const oldCode = codeFor('guest@example.com');
    const wrong = oldCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 3; i++) expect((await finish(link, initial.json().challengeId, wrong)).json().error.code).toBe('GUEST_CODE_INVALID');
    expect((await start(link)).statusCode).toBe(429);
    db.prepare('UPDATE guest_verification_limits SET last_sent=0').run();
    const resent = await start(link); expect(resent.statusCode).toBe(202);
    expect((await finish(link, initial.json().challengeId, oldCode)).statusCode).toBe(400);
    await tick(); const currentCode = codeFor('guest@example.com');
    await app.close(); db.close(); db = openDatabase(join(dataDir, 'hcd.sqlite')); app = makeApp();
    const nextWrong = currentCode === '000000' ? '000001' : '000000';
    expect((await finish(link, resent.json().challengeId, nextWrong)).json().error.code).toBe('GUEST_CODE_INVALID');
    expect((await finish(link, resent.json().challengeId, nextWrong)).json().error.code).toBe('GUEST_LOCKED');
    expect((await start(other)).json().error.code).toBe('GUEST_LOCKED');
    expect((await finish(link, resent.json().challengeId, currentCode)).statusCode).not.toBe(200);
    expect(db.prepare('SELECT count(*) n FROM guest_sessions').get()).toEqual({ n: 0 });
  });
  it('AT-25 creates external comments and replies, strips member mentions and requires approval ' +
     'for guest AI requests', async () => {
    const link = await createLink(); const { cookie, guest } = await verified(link);
    const before = db.prepare("SELECT count(*) n FROM notifications WHERE kind='mention'").get();
    db.prepare("UPDATE documents SET ai_enabled=1 WHERE id='d_aaaaaaab'").run();
    const result = await app.inject({ method: 'POST', url: path(link, 'comments'), headers: headers(cookie), payload: { body: 'Hello @[Member](u_editor00000) @[AI](ai) improve this' } });
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json().comment).toMatchObject({ external: true, authorId: guest.id, author: { name: '<Guest>', external: true }, body: 'Hello @Member @[AI](ai) improve this' });
    expect(result.json().aiTask).toMatchObject({ status: 'requested', requestedBy: guest.id });
    expect(db.prepare("SELECT count(*) n FROM notifications WHERE kind='mention'").get()).toEqual(before);
    const taskId = result.json().aiTask.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/ai-tasks/${taskId}/approve`, headers: headers(cookie), payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/v1/ai-tasks/${taskId}/reject`, headers: headers(owner), payload: { reason: 'Owner decision' } })).statusCode).toBe(200);
    const internal = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/comments', headers: headers(owner), payload: { body: 'Owner question' } });
    const reply = await app.inject({ method: 'POST', url: path(link, 'comments'), headers: headers(cookie), payload: { body: 'Guest reply', parentId: internal.json().comment.id } });
    expect(reply.statusCode).toBe(201);
    expect(db.prepare("SELECT 1 FROM notifications WHERE kind='reply' AND payload LIKE ?").get(`%${reply.json().comment.id}%`)).toBeTruthy();
    const threads = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/comments', headers: headers(owner) });
    expect(threads.json().threads.some((thread: { root: { authorId: string } }) => thread.root.authorId === guest.id)).toBe(true);
    expect(threads.body).not.toContain('guest@example.com');
    expect((await app.inject({ method: 'POST', url: path(link, 'comments'), headers: { ...headers(cookie), origin: 'https://evil.test' }, payload: { body: 'CSRF' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: path(link, 'comments'), headers: headers(cookie), payload: { body: 'x', parentId: 'missing' } })).statusCode).toBe(404);
    const viewer = await createLink('d_aaaaaaab', { role: 'viewer' });
    expect((await app.inject({ method: 'POST', url: path(viewer, 'comments'), headers: headers(cookie), payload: { body: 'x' } })).statusCode).toBe(403);
  });
  it('AT-33 invalidates challenges and sessions immediately when links expire or are revoked', async () => {
    const link = await createLink(); const { cookie } = await verified(link); const pending = await start(link, 'pending@example.com');
    expect(pending.statusCode).toBe(202);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/docs/d_aaaaaaab/share-links/${link.id}`, headers: headers(owner) })).statusCode).toBe(204);
    for (const suffix of ['doc', 'comments', 'assets/as_aaaaaaaaaaaa/url']) expect((await app.inject({ method: 'GET', url: path(link, suffix), headers: headers(cookie) })).statusCode).toBe(404);
    await tick(); expect(sent.some((mail) => mail.to === 'pending@example.com')).toBe(false);
    expect((await finish(link, pending.json().challengeId, '123456')).statusCode).toBe(404);
    expect(db.prepare('SELECT count(*) n FROM guest_sessions WHERE link_id=?').get(link.id)).toEqual({ n: 0 });
    const expiring = await createLink(); const valid = await verified(expiring, 'expires@example.com');
    db.prepare("UPDATE share_links SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(expiring.id);
    expect((await app.inject({ method: 'GET', url: path(expiring, 'doc'), headers: headers(valid.cookie) })).statusCode).toBe(404);
  });
  it('AT-32 protects raw signed URLs with the guest session and rechecks session and link ' +
     'revocation at render time', async () => {
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'raw.html', html: '<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>' } });
    expect(imported.statusCode).toBe(201); const content = imported.json().import.content as Document; const raw = content.modules.flatMap((module) => module.blocks).find((block) => block.type === 'raw')!;
    await app.inject({ method: 'POST', url: `/api/v1/imports/${imported.json().import.id}/confirm`, headers: headers(owner), payload: {} });
    const link = await createLink(content.id); const { cookie } = await verified(link);
    const result = await app.inject({ method: 'GET', url: path(link, `assets/${raw.asset}/url`), headers: headers(cookie) }); expect(result.statusCode, result.body).toBe(200);
    const url = new URL(result.json().url); expect(url.searchParams.get('c')).toMatch(/^gs_/);
    const render = () => app.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: 'render.test' } });
    expect((await render()).statusCode).toBe(200);
    db.prepare("UPDATE guest_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run(); expect((await render()).statusCode).toBe(404);
    db.prepare('UPDATE guest_sessions SET expires_at=?').run(new Date(Date.now() + 60000).toISOString());
    await app.inject({ method: 'DELETE', url: `/api/v1/docs/${content.id}/share-links/${link.id}`, headers: headers(owner) }); expect((await render()).statusCode).toBe(404);
  });
  it('AT-33 does not expose hidden comments, accepts only valid identity fields and expires ' +
     'challenges', async () => {
    const link = await createLink('d_aaaaaaab', { showComments: false });
    expect((await app.inject({ method: 'POST', url: path(link, 'verify/start'), headers: headers(), payload: { email: 'bad', name: 'Guest' } })).statusCode).toBe(400);
    const first = await start(link); expect(first.statusCode).toBe(202); await tick(); const code = codeFor('guest@example.com');
    db.prepare("UPDATE guest_challenges SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await finish(link, first.json().challengeId, code)).statusCode).toBe(400);
    const { cookie } = await verified(link, 'hidden@example.com');
    expect((await app.inject({ method: 'GET', url: path(link, 'comments'), headers: headers(cookie) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: path(link, 'comments'), headers: headers(cookie), payload: { body: 'Hidden' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: path(link, 'doc'), headers: headers(cookie) })).json().doc.showComments).toBe(false);
  });
});

it('AT-32 migrates legacy comment and AI authors without losing discussion state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hcd-guest-migration-')); const path = join(directory, 'hcd.sqlite');
  let db = openDatabase(path); let app: FastifyInstance | undefined;
  try {
    app = createApp({ db, seed: true }); await app.ready(); await app.close(); app = undefined;
    db.prepare('INSERT INTO ai_tasks(id,doc_id,requested_by,kind,status,instruction,module_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('at_old', 'd_aaaaaaab', 'u_owner000000', 'edit', 'requested', 'Retain this request', '[]', '2026-01-01', '2026-01-01');
    const comments = db.prepare('SELECT id,body,anchor,status,anchor_state FROM comments ORDER BY id').all(); expect(comments.length).toBeGreaterThan(0);
    db.exec(`CREATE TABLE comments_legacy (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id), thread_id TEXT NOT NULL, parent_id TEXT,
      user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, anchor TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT, anchor_state TEXT NOT NULL DEFAULT 'ok', anchor_range TEXT
    );
    INSERT INTO comments_legacy SELECT id,doc_id,thread_id,parent_id,user_id,body,anchor,status,created_at,edited_at,deleted_at,anchor_state,anchor_range FROM comments;
    DROP TABLE comments; ALTER TABLE comments_legacy RENAME TO comments;
    CREATE TABLE ai_tasks_legacy (
      id TEXT PRIMARY KEY,doc_id TEXT NOT NULL REFERENCES documents(id),requested_by TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,status TEXT NOT NULL,instruction TEXT NOT NULL,module_ids TEXT NOT NULL,result TEXT,claimed_by TEXT,approved_by TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    INSERT INTO ai_tasks_legacy SELECT id,doc_id,requested_by,kind,status,instruction,module_ids,result,claimed_by,approved_by,attempts,created_at,updated_at FROM ai_tasks;
    DROP TABLE ai_tasks; ALTER TABLE ai_tasks_legacy RENAME TO ai_tasks;`);
    db.close(); db = openDatabase(path);
    expect(db.prepare('SELECT id,body,anchor,status,anchor_state FROM comments ORDER BY id').all()).toEqual(comments);
    expect(db.prepare('SELECT requested_by,guest_id,instruction FROM ai_tasks WHERE id=?').get('at_old')).toEqual({ requested_by: 'u_owner000000', guest_id: null, instruction: 'Retain this request' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close(); db = openDatabase(path); expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { if (app) await app.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
