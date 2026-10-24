import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { openDatabase } from '../src/db';

it('B8 records token last-used time and IP once per minute', async () => {
  const db = openDatabase(':memory:'); const app = createApp({ db, seed: true, appUrl: 'http://localhost:5173' }); await app.ready();
  try {
    const common = { origin: 'http://localhost:5173', 'x-hcd-request': '1' };
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: common, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const created = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: { ...common, cookie }, payload: { scopes: ['read'] } });
    const token = created.json().token as string; const id = created.json().meta.id as string;
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', remoteAddress: '198.51.100.7', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    const first = db.prepare('SELECT last_used_at,last_used_ip FROM api_tokens WHERE id=?').get(id) as { last_used_at: string; last_used_ip: string }; 
    expect(first).toMatchObject({ last_used_ip: '198.51.100.7' }); expect(first.last_used_at).toEqual(expect.any(String));
    const firstTime = first.last_used_at;
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', remoteAddress: '198.51.100.8', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    const second = db.prepare('SELECT last_used_at,last_used_ip FROM api_tokens WHERE id=?').get(id) as { last_used_at: string; last_used_ip: string }; 
    expect(second.last_used_at).toBe(firstTime); expect(second.last_used_ip).toBe('198.51.100.7');
    const list = await app.inject({ method: 'GET', url: '/api/v1/me/tokens', headers: { cookie } });
    expect(list.json().tokens[0]).toMatchObject({ last_used_at: firstTime, last_used_ip: '198.51.100.7' });
  } finally { await app.close(); db.close(); }
});

it('B8 upgrades existing token rows without losing token data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hcd-token-migration-'));
  const path = join(directory, 'old.sqlite'); let db = openDatabase(path);
  const app = createApp({ db, seed: true }); await app.ready(); await app.close();
  db.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,created_at) VALUES(?,?,?,?,?,?)').run('tok_legacy', 'u_owner000000', 'Legacy', 'old-hash', '["read"]', '2026-01-01');
  db.exec('ALTER TABLE api_tokens DROP COLUMN last_used_at; ALTER TABLE api_tokens DROP COLUMN last_used_ip'); db.close();
  try {
    db = openDatabase(path);
    expect(db.prepare('SELECT id,name,token_hash,last_used_at,last_used_ip FROM api_tokens').get()).toEqual({ id: 'tok_legacy', name: 'Legacy', token_hash: 'old-hash', last_used_at: null, last_used_ip: null });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('B8 writes token usage only after sixty seconds even across a calendar minute boundary', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const startedAt = Date.parse('2026-10-24T12:00:59.999Z');
  vi.setSystemTime(startedAt);
  const directory = mkdtempSync(join(tmpdir(), 'hcd-token-interval-'));
  const db = openDatabase(join(directory, 'hcd.sqlite'));
  const app = createApp({ db, seed: true, appUrl: 'http://localhost:5173', exports: { autoStart: false } });
  try {
    const common = { origin: 'http://localhost:5173', 'x-hcd-request': '1' };
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: common, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const created = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: { ...common, cookie }, payload: { scopes: ['read'] } });
    const token = created.json().token as string;
    const id = created.json().meta.id as string;
    db.exec(`CREATE TEMP TABLE token_usage_writes(token_id TEXT, used_at TEXT, ip TEXT);
      CREATE TEMP TRIGGER audit_token_usage AFTER UPDATE OF last_used_at,last_used_ip ON api_tokens BEGIN
        INSERT INTO token_usage_writes VALUES(NEW.id,NEW.last_used_at,NEW.last_used_ip);
      END;`);
    const read = (ip: string) => app.inject({ url: '/api/v1/me', remoteAddress: ip, headers: { authorization: `Bearer ${token}` } });
    expect((await read('198.51.100.7')).statusCode).toBe(200);
    expect(db.prepare('SELECT count(*) n FROM token_usage_writes').get()).toEqual({ n: 1 });
    vi.setSystemTime(startedAt + 1);
    expect((await read('198.51.100.8')).statusCode).toBe(200);
    expect(db.prepare('SELECT count(*) n FROM token_usage_writes').get()).toEqual({ n: 1 });
    vi.setSystemTime(startedAt + 59999);
    expect((await read('198.51.100.8')).statusCode).toBe(200);
    expect(db.prepare('SELECT count(*) n FROM token_usage_writes').get()).toEqual({ n: 1 });
    vi.setSystemTime(startedAt + 60000);
    expect((await read('198.51.100.9')).statusCode).toBe(200);
    expect(db.prepare('SELECT * FROM token_usage_writes ORDER BY used_at').all()).toEqual([
      { token_id: id, used_at: '2026-10-24T12:00:59.999Z', ip: '198.51.100.7' },
      { token_id: id, used_at: '2026-10-24T12:01:59.999Z', ip: '198.51.100.9' },
    ]);
    const list = await app.inject({ url: '/api/v1/me/tokens', headers: { cookie } });
    expect(list.json().tokens[0]).toMatchObject({ last_used_at: '2026-10-24T12:01:59.999Z', last_used_ip: '198.51.100.9' });
  } finally {
    await app.close(); db.close(); vi.useRealTimers(); rmSync(directory, { recursive: true, force: true });
  }
});
