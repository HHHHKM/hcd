import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { issueInvitation } from '../src/accounts';
import type { NotificationMail } from '../src/outbox';

const origin = 'http://localhost:5173';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });

describe('B3/B6/B7 account authentication fixes', () => {
  let app: FastifyInstance;
  let db: HcdDatabase;
  let sent: NotificationMail[];
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'hcd-b-auth-'));
    databasePath = join(directory, 'hcd.sqlite');
    db = openDatabase(databasePath);
    sent = [];
    app = createApp({
      db,
      seed: true,
      secretKey: 'b-auth-test-secret',
      appUrl: origin,
      mailDelivery: { async send(mail) { sent.push(mail); } },
      exports: { autoStart: false },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  const login = async (email = 'a@example.com', password = 'hcd-demo-2026') => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password } });
    return { response, cookie: String(response.headers['set-cookie'] ?? '').split(';')[0]! };
  };

  it('B3 persists a three-per-hour email reset limit across app instances', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let index = 0; index < 3; index++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: headers(), payload: { email: 'a@example.com' } });
      expect(response.statusCode).toBe(204);
      now += 61000;
    }
    expect(db.prepare("SELECT count(*) n FROM security_mail WHERE kind='reset'").get()).toEqual({ n: 3 });
    const storedAttempts = db.prepare('SELECT * FROM password_reset_attempts').all();
    expect(storedAttempts).toHaveLength(3);
    expect(JSON.stringify(storedAttempts)).not.toContain('a@example.com');
    const fourth = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: headers(), payload: { email: 'a@example.com' } });
    expect(fourth.statusCode).toBe(204);
    expect(db.prepare("SELECT count(*) n FROM security_mail WHERE kind='reset'").get()).toEqual({ n: 3 });
    await app.close();
    db.close();
    db = openDatabase(databasePath);
    app = createApp({ db, secretKey: 'b-auth-test-secret', appUrl: origin, mailDelivery: { async send(mail) { sent.push(mail); } }, exports: { autoStart: false } });
    await app.ready();
    const afterRestart = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: headers(), payload: { email: 'a@example.com' } });
    expect(afterRestart.statusCode).toBe(204);
    expect(db.prepare("SELECT count(*) n FROM security_mail WHERE kind='reset'").get()).toEqual({ n: 3 });
    now += 3600000;
    const afterWindow = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot', headers: headers(), payload: { email: 'a@example.com' } });
    expect(afterWindow.statusCode).toBe(204);
    expect(db.prepare("SELECT count(*) n FROM security_mail WHERE kind='reset'").get()).toEqual({ n: 4 });
  });

  it('B3 adds durable reset counters to an old database without losing accounts or content', async () => {
    const users = db.prepare('SELECT id,email,name,password_hash FROM users ORDER BY id').all();
    const versions = db.prepare('SELECT * FROM versions ORDER BY doc_id,version').all();
    await app.close();
    db.exec('DROP TABLE IF EXISTS password_reset_attempts');
    db.close();
    db = openDatabase(databasePath);
    app = createApp({ db, secretKey: 'b-auth-test-secret', appUrl: origin, exports: { autoStart: false } });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='password_reset_attempts'").get()).toEqual({ name: 'password_reset_attempts' });
    expect(db.prepare('SELECT id,email,name,password_hash FROM users ORDER BY id').all()).toEqual(users);
    expect(db.prepare('SELECT * FROM versions ORDER BY doc_id,version').all()).toEqual(versions);
  });

  it('B6 logs out every browser session while leaving personal tokens usable', async () => {
    const first = await login();
    const second = await login();
    const tokenResponse = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(first.cookie), payload: { scopes: ['read'] } });
    expect(tokenResponse.statusCode).toBe(201);
    const token = tokenResponse.json().token as string;
    const logoutAll = await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: headers(first.cookie), payload: {} });
    expect(logoutAll.statusCode).toBe(204);
    expect(String(logoutAll.headers['set-cookie'])).toContain('hcd_session=;');
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: first.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: second.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
  });

  it('AT-11 B6 rejects bearer tokens for logout-all and enforces the write request guard', async () => {
    const first = await login();
    const tokenResponse = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(first.cookie), payload: { scopes: ['read'] } });
    const token = tokenResponse.json().token as string;
    const missingGuard = await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: { cookie: first.cookie }, payload: {} });
    expect(missingGuard.statusCode).toBe(403);
    const foreignOrigin = await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: { ...headers(first.cookie), origin: 'https://other.invalid' }, payload: {} });
    expect(foreignOrigin.statusCode).toBe(403);
    const bearer = await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: { authorization: `Bearer ${token}`, origin, 'x-hcd-request': '1' }, payload: {} });
    expect(bearer.statusCode).toBe(403);
    expect(bearer.json().error.code).toBe('TOKEN_SCOPE');
  });

  it('B7 rejects an incorrect current password without changing credentials', async () => {
    const current = await login();
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: headers(current.cookie), payload: { currentPassword: 'wrong-password', newPassword: 'new-long-password-1' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
    expect((await login('a@example.com', 'hcd-demo-2026')).response.statusCode).toBe(200);
    expect((await login('a@example.com', 'new-long-password-1')).response.statusCode).toBe(401);
  });

  it('B7 counts wrong current passwords toward the existing login failure limit', async () => {
    const current = await login();
    for (let index = 0; index < 5; index++) {
      const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: headers(current.cookie), payload: { currentPassword: 'wrong-password', newPassword: 'new-long-password-1' } });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: headers(current.cookie), payload: { currentPassword: 'wrong-password', newPassword: 'new-long-password-1' } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect((await login()).response.statusCode).toBe(429);
  });

  it('B7 keeps the current session, removes other sessions, and invalidates reset links after success', async () => {
    const first = await login();
    const second = await login();
    const reset = issueInvitation(db, 'u_editor00000', 'reset', 'self', { secretKey: 'b-auth-test-secret', appUrl: origin });
    const changed = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: headers(first.cookie), payload: { currentPassword: 'hcd-demo-2026', newPassword: 'new-long-password-1' } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: first.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: second.cookie } })).statusCode).toBe(401);
    expect((await login('a@example.com', 'hcd-demo-2026')).response.statusCode).toBe(401);
    expect((await login('a@example.com', 'new-long-password-1')).response.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/invites/${reset.token}` })).statusCode).toBe(410);
  });
});
