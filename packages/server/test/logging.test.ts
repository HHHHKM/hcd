import { afterEach, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createApp } from '../src/app';
import { openDatabase } from '../src/db';
import { issueInvitation } from '../src/accounts';
import { registerMcpRoutes } from '../src/mcp';

afterEach(() => vi.unstubAllEnvs());

it('B5 logs a route template without secrets, bodies or query strings', async () => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('LOG_LEVEL', 'info');
  let output = ''; const stream = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback(); } });
  const app = createApp({ databasePath: ':memory:', seed: true, logger: { level: 'info' }, logStream: stream });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login?password=secret-query', headers: { origin: 'http://localhost:5173', 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    expect(response.statusCode).toBe(200);
    const entry = JSON.parse(output.trim().split('\n').at(-1)!);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry).toMatchObject({ method: 'POST', route: '/api/v1/auth/login', status: 200, requestId: expect.any(String), actorId: 'u_owner000000' });
    expect(entry).not.toHaveProperty('url'); expect(output).not.toContain('secret-query'); expect(output).not.toContain('hcd-demo-2026'); expect(output).not.toContain('hcd_session');
  } finally { await app.close(); }
});

it('B5 never logs share or invite secrets and emits only one entry per request', async () => {
  let output = ''; const stream = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback(); } });
  const db = openDatabase(':memory:'); const secretKey = 'local-logging-test';
  const app = createApp({ db, secretKey, seed: true, logger: { level: 'info' }, logStream: stream });
  try {
    const invite = issueInvitation(db, 'u_owner000000', 'reset', 'u_owner000000', { secretKey, appUrl: 'http://localhost:5173' });
    await app.inject({ url: '/api/v1/s/private-share-token/doc?code=123456', headers: { cookie: 'hcd_guest=private-cookie' } });
    await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${invite.token}/accept`, headers: { origin: 'http://localhost:5173', 'x-hcd-request': '1' }, payload: { password: 'secret-new-password' } });
    const entries = output.trim().split('\n').map(line => JSON.parse(line));
    expect(entries).toHaveLength(2);
    expect(entries.map(entry => entry.route)).toEqual(['/api/v1/s/:token/doc', '/api/v1/auth/invites/:token/accept']);
    for (const secret of ['private-share-token', 'private-cookie', 'secret-new-password', '123456', invite.token]) expect(output).not.toContain(secret);
    expect(entries.every(entry => typeof entry.status === 'number' && typeof entry.durationMs === 'number')).toBe(true);
  } finally { await app.close(); db.close(); }
});

it('B5 records the authenticated actor on the outer MCP request', async () => {
  let output = ''; const stream = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback(); } });
  const app = createApp({ databasePath: ':memory:', seed: true, logger: { level: 'info' }, logStream: stream });
  registerMcpRoutes(app, { appUrl: 'http://localhost:5173' });
  try {
    const headers = { origin: 'http://localhost:5173', 'x-hcd-request': '1' };
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const created = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: { ...headers, cookie }, payload: { scopes: ['read'] } });
    output = '';
    await app.inject({ method: 'POST', url: '/mcp', headers: { accept: 'application/json, text/event-stream', authorization: `Bearer ${created.json().token}` }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    const outer = output.trim().split('\n').map(line => JSON.parse(line)).find(entry => entry.route === '/mcp');
    expect(outer).toMatchObject({ actorId: 'u_owner000000', method: 'POST', status: 200 });
    expect(output).not.toContain(created.json().token);
  } finally { await app.close(); }
});
