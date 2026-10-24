import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';
import { issueInvitation } from '../src/accounts';
import { enqueueSecurityMail } from '../src/security-mail';

const secretKey = 'security-mail-test-secret'; const origin = 'http://localhost:5173';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
describe('account security emails', () => {
  let db: HcdDatabase; let app: FastifyInstance; let sent: NotificationMail[]; let admin: string;
  beforeEach(async () => {
    db = openDatabase(':memory:'); sent = [];
    app = createApp({ db, seed: true, secretKey, appUrl: origin, mailDelivery: { async send(mail) { sent.push(mail); } } });
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'admin@example.com', password: 'hcd-demo-2026' } });
    admin = String(result.headers['set-cookie']).split(';')[0]!;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const tokenFrom = (url: string) => new URL(url).pathname.split('/').pop()!;
  async function tick() { return createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick(); }
  it('AT-34 queues encrypted invitation secrets atomically, prioritizes them over notification ' +
     'backlogs and erases them after delivery', async () => {
    for (let index = 0; index < 32; index++) db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(`nt_backlog_${index}`, 'u_owner000000', 'd_aaaaaaab', 'mention', '{}', '2020-01-01T00:00:00.000Z');
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: headers(admin), payload: { email: 'reader@example.com', name: '<Reader>' } });
    expect(response.statusCode).toBe(201);
    const token = tokenFrom(response.json().inviteUrl);
    const mail = db.prepare('SELECT * FROM security_mail WHERE recipient=?').get('reader@example.com') as { id: string; sealed: string };
    expect(mail.sealed).toMatch(/^1\./); expect(JSON.stringify(mail)).not.toContain(token);
    expect(db.prepare('SELECT security_mail_id FROM outbox WHERE security_mail_id=?').get(mail.id)).toBeTruthy();
    await tick(); const delivered = sent.find((item) => item.to === 'reader@example.com')!;
    expect(delivered.text).toContain(response.json().inviteUrl);
    expect((db.prepare('SELECT sealed FROM security_mail WHERE id=?').get(mail.id) as { sealed: null }).sealed).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${token}/accept`, headers: headers(), payload: { name: 'Reader', password: 'a-new-long-password' } })).statusCode).toBe(200);
    await tick(); expect(sent.filter((item) => item.to === 'reader@example.com')).toHaveLength(1);
  });
  it('uses the same public reset response for unknown, active, disabled and pending accounts with rate limits', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json().selfResetEnabled).toBe(true);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'a@example.com', password: 'hcd-demo-2026' } });
    const oldCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const pat = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(oldCookie), payload: { name: 'old access', scopes: ['read'] } });
    const oldReset = issueInvitation(db, 'u_editor00000', 'reset', 'u_editor00000', { secretKey, appUrl: origin });
    db.prepare('UPDATE users SET disabled_at=? WHERE email=?').run(new Date().toISOString(), 'b@example.com');
    await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: headers(admin), payload: { email: 'pending@example.com', name: 'Pending' } });
    for (const email of ['absent@example.com', 'a@example.com', 'b@example.com', 'pending@example.com', 'a@example.com']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: headers(), payload: { email } });
      expect(response.statusCode).toBe(204); expect(response.body).toBe('');
    }
    expect(db.prepare("SELECT count(*) n FROM security_mail WHERE kind='reset'").get()).toEqual({ n: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: { ...headers(), origin: 'https://evil.example' }, payload: { email: 'a@example.com' } })).statusCode).toBe(403);
    await tick(); const mail = sent.find((item) => item.to === 'a@example.com' && item.text.includes('/reset/'))!;
    const token = tokenFrom(mail.text.match(/http:\/\/localhost:5173\/reset\/\S+/)![0]);
    const accept = (value: string) => app.inject({ method: 'POST', url: `/api/v1/auth/invites/${value}/accept`, headers: headers(), payload: { password: 'replacement-password' } });
    expect((await accept(oldReset.token)).statusCode).toBe(410);
    const results = await Promise.all([accept(token), accept(token)]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 410]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: oldCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs', headers: { authorization: `Bearer ${pat.json().token}` } })).statusCode).toBe(401);
  });
  it('AT-34 cancels expired or replaced credentials and retries tampered encrypted payloads ' +
     'without leaking secrets', async () => {
    const queue = () => {
      const invite = issueInvitation(db, 'u_editor00000', 'reset', 'u_editor00000', { secretKey, appUrl: origin });
      const id = enqueueSecurityMail(db, secretKey, { kind: 'reset', refId: invite.id, recipient: 'a@example.com', locale: 'en', value: invite.token, expiresAt: invite.expiresAt });
      return { ...invite, mailId: id };
    };
    const replaced = queue(); const expired = queue();
    db.prepare('UPDATE security_mail SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.mailId);
    const tampered = queue();
    db.prepare("UPDATE security_mail SET sealed=substr(sealed,1,length(sealed)-2)||'AA' WHERE id=?").run(tampered.mailId);
    await tick();
    expect(sent.some((mail) => mail.text.includes('/reset/'))).toBe(false);
    for (const item of [replaced, expired]) {
      expect(db.prepare('SELECT status FROM outbox WHERE security_mail_id=?').get(item.mailId)).toEqual({ status: 'cancelled' });
      expect(db.prepare('SELECT sealed FROM security_mail WHERE id=?').get(item.mailId)).toEqual({ sealed: null });
    }
    expect(db.prepare('SELECT status,last_error FROM outbox WHERE security_mail_id=?').get(tampered.mailId)).toEqual({ status: 'pending', last_error: 'SMTP_DELIVERY_FAILED' });
    expect(JSON.stringify(db.prepare('SELECT * FROM outbox').all())).not.toContain(tampered.token);
  });
});

it('AT-34 migrates an existing notification outbox without losing delivery state or the ' +
   'transactional trigger', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hcd-outbox-migration-')); const path = join(directory, 'old.sqlite');
  let db = new Database(path);
  try {
    db.exec(`CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,doc_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE outbox(id TEXT PRIMARY KEY,notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id),dedupe_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,lease_token TEXT,lease_until TEXT,last_error TEXT,created_at TEXT NOT NULL,sent_at TEXT);
      INSERT INTO notifications VALUES('old','u_old','d_old','mention','{}',NULL,'2026-01-01');
      INSERT INTO outbox(id,notification_id,dedupe_key,attempts,next_attempt_at,created_at) VALUES('mail_old','old','notification:old',2,'2026-01-02','2026-01-01');`);
    db.close(); db = openDatabase(path);
    expect(db.prepare('SELECT notification_id,security_mail_id,attempts,next_attempt_at FROM outbox').get()).toEqual({ notification_id: 'old', security_mail_id: null, attempts: 2, next_attempt_at: '2026-01-02' });
    db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)').run('new', 'u_old', 'd_old', 'reply', '{}', null, '2026-02-01');
    expect(db.prepare('SELECT count(*) n FROM outbox').get()).toEqual({ n: 2 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
