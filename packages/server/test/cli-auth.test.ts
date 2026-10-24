import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, hashTokenForTesting } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { issueInvitation } from '../src/accounts';
import { runMaintenance } from '../src/maintenance';

const origin = 'http://localhost:5173'; const secret = 'device-auth-secret-fixture'; const docId = 'd_aaaaaaab';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
type Flow = { code: string; verifyUrl: string; pollToken: string; expiresIn: number; interval: number };
type Issued = { status: string; token: string; tokenId: string; expiresAt: string; user: { id: string; email: string }; meta: { scopes: string[]; docIds: string[] | null } };
describe('CLI device authorization', () => {
  let app: FastifyInstance; let db: HcdDatabase; let cookie: string; let clock: number; let dataDir: string;
  beforeEach(async () => {
    clock = Date.now(); dataDir = mkdtempSync(join(tmpdir(), 'hcd-cli-auth-')); db = openDatabase(':memory:');
    app = createApp({ db, dataDir, secretKey: secret, appUrl: origin, seed: true, cliAuth: { now: () => clock }, exports: { autoStart: false } }); await app.ready();
    cookie = await login('d@example.com');
  });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function login(email: string) {
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } });
    expect(result.statusCode).toBe(200); return String(result.headers['set-cookie']).split(';')[0]!;
  }
  async function start() { const result = await app.inject({ method: 'POST', url: '/api/v1/cli-auth/start', payload: { clientName: 'mdoc', hostname: 'my-laptop' } }); expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); return result.json<Flow>(); }
  const view = (flow: Flow, current = cookie) => app.inject({ url: `/api/v1/cli-auth/requests/${flow.code}`, headers: { cookie: current } });
  const decide = (flow: Flow, body: Record<string, unknown> = {}, current = cookie) => app.inject({ method: 'POST', url: `/api/v1/cli-auth/requests/${flow.code}`, headers: headers(current), payload: { decision: 'approve', scopes: ['read', 'comment', 'submit', 'ai_tasks'], docIds: [docId], ...body } });
  const poll = (flow: Flow) => app.inject({ method: 'POST', url: '/api/v1/cli-auth/poll', payload: { pollToken: flow.pollToken } });
  const api = (path: string, token: string) => app.inject({ url: `/api/v1${path}`, headers: { authorization: `Bearer ${token}` } });
  async function issued(body: Record<string, unknown> = {}, current = cookie) {
    const flow = await start(); expect((await view(flow, current)).statusCode).toBe(200); expect((await decide(flow, body, current)).json()).toEqual({ status: 'approved' });
    const response = await poll(flow); expect(response.statusCode).toBe(200); return { flow, result: response.json<Issued>() };
  }

  it('keeps the display code separate from secrets and approves a normal scoped PAT', async () => {
    const flow = await start(); expect(flow.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); expect(flow.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow).toMatchObject({ expiresIn: 600, interval: 3 }); expect(flow.verifyUrl).toBe(`${origin}/cli-auth?code=${flow.code}`);
    const pending = await poll(flow); expect(pending.json()).toEqual({ status: 'pending', interval: 3 });
    const displayed = await view({ ...flow, code: flow.code.replace('-', '').toLowerCase() }); expect(displayed.statusCode).toBe(200);
    expect(displayed.json().request).toMatchObject({ code: flow.code, clientName: 'mdoc', hostname: 'my-laptop', scopes: ['read', 'comment', 'submit', 'ai_tasks'], optionalScopes: ['preview'], status: 'pending' });
    expect(displayed.json().documents.some((doc: { id: string }) => doc.id === docId)).toBe(true); expect(displayed.json().user).toMatchObject({ id: 'u_owner000000', email: 'd@example.com' });
    expect(displayed.body).not.toContain(flow.pollToken); expect(displayed.body).not.toContain('password_hash');
    expect((await decide(flow)).json()).toEqual({ status: 'approved' }); clock += 3000;
    const response = await poll(flow); const result = response.json<Issued>(); expect(result.status).toBe('approved'); expect(result.token).toMatch(/^hcd_pat_/);
    expect(result.user.id).toBe('u_owner000000'); expect(result.expiresAt).toBe(new Date(clock - 3000 + 30 * 86400000).toISOString());
    expect((await api('/me', result.token)).statusCode).toBe(200); expect((await api(`/docs/${docId}`, result.token)).statusCode).toBe(200);
    const row = db.prepare('SELECT * FROM cli_auth_requests WHERE code=?').get(flow.code); const token = db.prepare('SELECT * FROM api_tokens WHERE id=?').get(result.tokenId);
    expect(JSON.stringify([row, token])).not.toContain(flow.pollToken); expect(JSON.stringify([row, token])).not.toContain(result.token);
    expect(token).toMatchObject({ token_hash: hashTokenForTesting(secret, result.token), kind: 'pat', scopes: JSON.stringify(result.meta.scopes) });
  });

  it('repeats the same approved credential after a lost response without issuing duplicates', async () => {
    const flow = await start(); await view(flow);
    const firstDecisions = await Promise.all(Array.from({ length: 8 }, () => decide(flow)));
    expect(firstDecisions.every(response => response.statusCode === 200)).toBe(true);
    const result = (await poll(flow)).json<Issued>(); expect(result.status).toBe('approved');
    expect((await poll(flow)).statusCode).toBe(429); clock += 3000;
    expect((await poll(flow)).json()).toEqual(result);
    const decisions = await Promise.all(Array.from({ length: 8 }, () => decide(flow, { scopes: ['preview'], docIds: null, expiresInDays: 90 })));
    expect(decisions.every(response => response.statusCode === 200)).toBe(true);
    expect(db.prepare('SELECT count(*) count FROM api_tokens').get()).toEqual({ count: 1 });
    clock += 3000; const raced = await Promise.all([poll(flow), poll(flow)]);
    expect(raced.map(response => response.statusCode).sort()).toEqual([200, 429]); expect(raced.find(response => response.statusCode === 200)!.json()).toEqual(result);
    expect((await decide(flow, { decision: 'deny' })).statusCode).toBe(409);
  });

  it('preserves the consent binding and same delivery credential across an application restart', async () => {
    const { flow, result } = await issued(); await app.close();
    app = createApp({ db, dataDir, secretKey: secret, appUrl: origin, cliAuth: { now: () => clock }, exports: { autoStart: false } }); await app.ready();
    expect((await view(flow)).json().request.status).toBe('approved'); clock += 3000;
    expect((await poll(flow)).json()).toEqual(result);
    expect(db.prepare('SELECT count(*) count FROM api_tokens').get()).toEqual({ count: 1 });
    const other = await login('a@example.com'); expect((await view(flow, other)).statusCode).toBe(409);
  });

  it('AT-11 requires session review, rejects token approval and guards browser origins and CSRF', async () => {
    const flow = await start(); expect((await view(flow, '')).statusCode).toBe(401);
    expect((await decide(flow)).json().error.code).toBe('CLI_AUTH_REVIEW_REQUIRED');
    const pat = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(cookie), payload: { scopes: ['read'] } });
    const bearer = { authorization: `Bearer ${pat.json().token}`, cookie, 'x-hcd-request': '1' };
    expect((await app.inject({ url: `/api/v1/cli-auth/requests/${flow.code}`, headers: bearer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cli-auth/requests/${flow.code}`, headers: bearer, payload: { decision: 'approve', docIds: null } })).statusCode).toBe(403);
    expect((await view(flow)).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cli-auth/requests/${flow.code}`, headers: { cookie }, payload: { decision: 'deny' } })).json().error.code).toBe('CSRF_REQUIRED');
    for (const path of ['start', 'poll', `requests/${flow.code}`]) expect((await app.inject({ method: 'POST', url: `/api/v1/cli-auth/${path}`, headers: { ...headers(cookie), origin: 'https://evil.test' }, payload: { decision: 'deny', pollToken: flow.pollToken } })).json().error.code).toBe('ORIGIN_MISMATCH');
    expect((await app.inject({ url: `/api/v1/cli-auth/requests/${flow.code}`, headers: { cookie, origin: 'https://evil.test' } })).statusCode).toBe(403);
    expect((await poll({ ...flow, pollToken: 'A'.repeat(43) })).json()).toEqual({ status: 'expired' });
    expect((await poll({ ...flow, pollToken: flow.code })).statusCode).toBe(400);
  });

  it('durably binds consent to the first user and exact session, including simultaneous reads', async () => {
    const flow = await start(); const other = await login('a@example.com'); const sameUser = await login('d@example.com');
    const reads = await Promise.all([view(flow), view(flow, other)]); expect(reads.map(response => response.statusCode)).toEqual([200, 409]);
    expect((await decide(flow, {}, other)).json().error.code).toBe('CLI_AUTH_SESSION_MISMATCH');
    expect((await view(flow, sameUser)).json().error.code).toBe('CLI_AUTH_SESSION_MISMATCH');
    expect((await decide(flow, {}, sameUser)).statusCode).toBe(409); expect((await decide(flow)).statusCode).toBe(200);
    expect(db.prepare('SELECT user_id FROM api_tokens').get()).toEqual({ user_id: 'u_owner000000' });
  });

  it('AT-11 validates scope, document and expiry selections before issuing any token', async () => {
    const flow = await start(); await view(flow);
    const invalid = [{ scopes: [] }, { scopes: ['admin'] }, { scopes: ['read', 1] }, { docIds: [] }, { docIds: ['d_notfound'] }, { docIds: 'all' }, { expiresInDays: 0 }, { expiresInDays: 91 }, { expiresInDays: '30' }, { expiresInDays: 2.5 }];
    for (const body of invalid) expect((await decide(flow, body)).statusCode).toBe(400);
    expect(db.prepare('SELECT count(*) count FROM api_tokens').get()).toEqual({ count: 0 });
    expect((await decide(flow, { scopes: ['read', 'preview'], docIds: null, expiresInDays: 90 })).statusCode).toBe(200);
    const result = (await poll(flow)).json<Issued>(); expect(result.meta).toMatchObject({ scopes: ['read', 'preview'], docIds: null }); expect(result.expiresAt).toBe(new Date(clock + 90 * 86400000).toISOString());
  });

  it('denies without minting a token and expires delivery secrets without revoking issued tokens', async () => {
    const denied = await start(); await view(denied); expect((await decide(denied, { decision: 'deny' })).json()).toEqual({ status: 'denied' });
    expect((await poll(denied)).json().status).toBe('denied'); expect((await decide(denied)).statusCode).toBe(409);
    const { flow, result } = await issued(); const pending = await start();
    clock += 600001; expect(runMaintenance(db, clock).cliAuth).toBe(3);
    for (const current of [denied, flow, pending]) { expect((await poll(current)).json()).toEqual({ status: 'expired' }); expect((await view(current)).json().request.status).toBe('expired'); }
    expect(db.prepare('SELECT poll_hash,session_hash FROM cli_auth_requests').all()).toEqual(Array.from({ length: 3 }, () => ({ poll_hash: null, session_hash: null })));
    expect((await api('/me', result.token)).statusCode).toBe(200); expect((await decide(pending)).json()).toEqual({ status: 'expired' });
    expect(db.prepare('SELECT count(*) count FROM api_tokens').get()).toEqual({ count: 1 });
  });

  it('rate-limits both new device requests and early polling with retry hints', async () => {
    const flow = await start(); expect((await poll(flow)).statusCode).toBe(200);
    const slow = await poll(flow); expect(slow.statusCode).toBe(429); expect(slow.json()).toEqual({ error: { code: 'SLOW_DOWN' }, interval: 3 }); expect(slow.headers['retry-after']).toBe('3');
    clock += 2999; expect((await poll(flow)).headers['retry-after']).toBe('1'); clock += 1; expect((await poll(flow)).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) await start();
    const limited = await app.inject({ method: 'POST', url: '/api/v1/cli-auth/start', payload: { clientName: 'mdoc', hostname: 'other' } }); expect(limited.statusCode).toBe(429); expect(limited.headers['retry-after']).toBeTruthy();
  });

  it('AT-21 enforces live PAT scopes, document allowlists, AI setting and membership', async () => {
    const { flow, result } = await issued({ scopes: ['read'] });
    const content = (await api(`/docs/${docId}`, result.token)).json().content;
    expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { authorization: `Bearer ${result.token}`, 'x-hcd-request': '1' }, payload: { baseVersion: 1, content } })).statusCode).toBe(403);
    expect((await api('/docs/d_aaaaaaaa', result.token)).statusCode).toBe(404);
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId); expect((await api(`/docs/${docId}`, result.token)).statusCode).toBe(403);
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    db.prepare('DELETE FROM space_members WHERE user_id=?').run(result.user.id); db.prepare('DELETE FROM document_members WHERE user_id=?').run(result.user.id);
    expect((await api(`/docs/${docId}`, result.token)).statusCode).toBe(404);
    clock += 3000; expect((await poll(flow)).json()).toEqual({ status: 'denied' }); expect((await api('/me', result.token)).statusCode).toBe(401);
  });

  it('AT-21 rechecks reset, disabled account, revoked token and deleted approving session before ' +
     'redelivery', async () => {
    const editor = await login('a@example.com'); const first = await issued({}, editor);
    const reset = issueInvitation(db, first.result.user.id, 'reset', 'test', { secretKey: secret, appUrl: origin });
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${reset.token}/accept`, headers: headers(), payload: { password: 'a-new-safe-password' } }); expect(accepted.statusCode).toBe(200);
    clock += 3000; expect((await poll(first.flow)).json()).toEqual({ status: 'denied' }); expect((await api('/me', first.result.token)).statusCode).toBe(401);
    const second = await issued(); db.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(new Date(clock).toISOString(), second.result.user.id);
    clock += 3000; expect((await poll(second.flow)).json()).toEqual({ status: 'denied' }); db.prepare('UPDATE users SET disabled_at=NULL WHERE id=?').run(second.result.user.id);
    const third = await issued(); db.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').run(new Date(clock).toISOString(), third.result.tokenId);
    clock += 3000; expect((await poll(third.flow)).json()).toEqual({ status: 'denied' });
    const fourth = await issued(); db.prepare('DELETE FROM sessions WHERE user_id=?').run(fourth.result.user.id);
    clock += 3000; expect((await poll(fourth.flow)).json()).toEqual({ status: 'denied' }); expect(db.prepare('SELECT count(*) count FROM api_tokens').get()).toEqual({ count: 4 });
  });

  it('AT-21 revokes only the calling bearer, rejects targets, and remains usable after permissions ' +
     'disappear', async () => {
    const first = await issued(); const second = await issued();
    const revoke = (token: string, body?: unknown) => app.inject({ method: 'POST', url: '/api/v1/cli-auth/revoke', headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' }, ...(body === undefined ? {} : { payload: body as Record<string, unknown> }) });
    expect((await revoke(first.result.token, { tokenId: second.result.tokenId })).statusCode).toBe(400);
    expect((await api('/me', second.result.token)).statusCode).toBe(200);
    db.prepare('DELETE FROM space_members WHERE user_id=?').run(first.result.user.id); db.prepare('DELETE FROM document_members WHERE user_id=?').run(first.result.user.id);
    expect((await revoke(first.result.token)).statusCode).toBe(204); expect((await api('/me', first.result.token)).statusCode).toBe(401); expect((await api('/me', second.result.token)).statusCode).toBe(200);
    expect((await revoke(first.result.token)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/cli-auth/revoke', headers: headers(cookie) })).statusCode).toBe(401);
    clock += 3000; expect((await poll(first.flow)).json()).toEqual({ status: 'denied' });
  });

  it('AT-21 revokes an OAuth access token and its entire refresh family using the same self-only ' +
     'endpoint', async () => {
    const timestamp = new Date(clock).toISOString(); const expires = new Date(clock + 600000).toISOString(); const resource = `${origin}/mcp`;
    db.prepare('INSERT INTO oauth_grants(id,user_id,client_id,name,scopes,doc_ids,resource,refresh_allowed,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('og_device_test', 'u_owner000000', 'oc_test', 'Test', '["read"]', JSON.stringify([docId]), resource, 1, timestamp, expires);
    for (const [id, kind, raw] of [['tok_access', 'oauth_access', 'oauth-access-fixture'], ['tok_refresh', 'oauth_refresh', 'oauth-refresh-fixture']]) db.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,doc_ids,expires_at,created_at,kind,client_id,grant_id,resource) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'u_owner000000', 'Test', hashTokenForTesting(secret, raw!), '["read"]', JSON.stringify([docId]), expires, timestamp, kind, 'oc_test', 'og_device_test', resource);
    expect((await api('/me', 'oauth-access-fixture')).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: '/api/v1/cli-auth/revoke', headers: { authorization: 'Bearer oauth-access-fixture', 'x-hcd-request': '1' } }); expect(response.statusCode).toBe(204);
    expect((db.prepare('SELECT revoked_at FROM oauth_grants').get() as { revoked_at: string }).revoked_at).toBeTruthy();
    expect((db.prepare('SELECT revoked_at FROM api_tokens').all() as Array<{ revoked_at: string }>).every(token => token.revoked_at)).toBe(true);
  });
});
