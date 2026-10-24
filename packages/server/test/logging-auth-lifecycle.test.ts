import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { issueInvitation } from '../src/accounts';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';

const origin = 'http://localhost:5173';
const secretKey = 'logging-auth-lifecycle-fixture';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
let directory: string;
let db: HcdDatabase;
let app: FastifyInstance;
let output: string;
let stream: Writable;
let sent: NotificationMail[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hcd-log-auth-'));
  db = openDatabase(join(directory, 'hcd.sqlite'));
  output = '';
  sent = [];
  stream = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback(); } });
  app = createApp({ db, secretKey, seed: true, appUrl: origin, logger: { level: 'info' }, logStream: stream, mailDelivery: { async send(mail) { sent.push(mail); } }, exports: { autoStart: false } });
});

afterEach(async () => {
  await app.close(); db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
});

const entries = () => output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
async function login() {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
}

it('B5 records the cookie actor before logout deletes the session', async () => {
  const cookie = await login();
  output = '';
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: headers(cookie), payload: {} });
  expect(response.statusCode).toBe(204);
  expect(entries()).toHaveLength(1);
  expect(entries()[0]).toMatchObject({ route: '/api/v1/auth/logout', actorId: 'u_owner000000', status: 204 });
  expect(output).not.toContain(cookie);
});

it('B5 records the new session actor after accepting an invitation or reset link', async () => {
  const invite = issueInvitation(db, 'u_owner000000', 'reset', 'self', { secretKey, appUrl: origin });
  const response = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${invite.token}/accept`, headers: headers(), payload: { password: 'new-private-password' } });
  expect(response.statusCode).toBe(200);
  expect(entries()).toHaveLength(1);
  expect(entries()[0]).toMatchObject({ route: '/api/v1/auth/invites/:token/accept', actorId: 'u_owner000000', status: 200 });
  expect(output).not.toContain(invite.token);
  expect(output).not.toContain('new-private-password');
});

it('B5 records the guest actor on first successful verification before a guest cookie exists', async () => {
  const owner = await login();
  const created = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/share-links', headers: headers(owner), payload: { role: 'commenter' } });
  expect(created.statusCode).toBe(201);
  const token = new URL(created.json().link.url).pathname.split('/').pop()!;
  const started = await app.inject({ method: 'POST', url: `/api/v1/s/${token}/verify/start`, headers: headers(), payload: { email: 'guest@example.test', name: 'Guest', locale: 'en' } });
  expect(started.statusCode).toBe(202);
  await createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick();
  const code = sent.find(mail => mail.to === 'guest@example.test')!.text.match(/\b\d{6}\b/)![0];
  output = '';
  const verified = await app.inject({ method: 'POST', url: `/api/v1/s/${token}/verify/finish`, headers: headers(), payload: { challengeId: started.json().challengeId, code } });
  expect(verified.statusCode).toBe(200);
  expect(entries()).toHaveLength(1);
  expect(entries()[0]).toMatchObject({ route: '/api/v1/s/:token/verify/finish', actorId: verified.json().guest.id, status: 200 });
  expect(output).not.toContain(token);
  expect(output).not.toContain(code);
  expect(output).not.toContain('guest@example.test');
  const oldCookie = String((verified.headers['set-cookie'] as string[])[0]).split(';')[0]!;
  const nextStart = await app.inject({ method: 'POST', url: `/api/v1/s/${token}/verify/start`, headers: headers(oldCookie), payload: { email: 'another@example.test', name: 'Another guest', locale: 'en' } });
  expect(nextStart.statusCode).toBe(202);
  await createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick();
  const nextCode = sent.find(mail => mail.to === 'another@example.test')!.text.match(/\b\d{6}\b/)![0];
  output = '';
  const next = await app.inject({ method: 'POST', url: `/api/v1/s/${token}/verify/finish`, headers: headers(oldCookie), payload: { challengeId: nextStart.json().challengeId, code: nextCode } });
  expect(next.statusCode).toBe(200);
  expect(next.json().guest.id).not.toBe(verified.json().guest.id);
  expect(entries()[0]).toMatchObject({ actorId: next.json().guest.id });
});

it('B5 uses LOG_LEVEL when explicitly configured and is silent by default in tests', async () => {
  await app.close();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LOG_LEVEL', 'info');
  app = createApp({ db, secretKey, logStream: stream, exports: { autoStart: false } });
  expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
  expect(entries()).toHaveLength(1);
  expect(entries()[0]).toMatchObject({ route: '/healthz', status: 200 });
  await app.close();
  output = '';
  vi.stubEnv('LOG_LEVEL', undefined);
  app = createApp({ db, secretKey, logStream: stream, exports: { autoStart: false } });
  expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
  expect(output).toBe('');
});
