import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueInvitation } from '../src/accounts';
import { createAssetStore } from '../src/assets';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { registerMcpRoutes } from '../src/mcp';
import { publicIPv4, validRedirect, validateClient } from '../src/oauth-client';
import { runMaintenance } from '../src/maintenance';

const origin = 'http://localhost:5173'; const resource = `${origin}/mcp`; const docId = 'd_aaaaaaab';
const redirect = 'http://127.0.0.1:9876/callback?application=hcd';
const verifier = 'v'.repeat(64); const challenge = createHash('sha256').update(verifier).digest('base64url');
const metadata = { client_name: '<b>Unverified client</b>', redirect_uris: [redirect] };
const headers = (cookie: string) => ({ cookie, origin, 'x-hcd-request': '1' });
type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; scope: string };
describe('OAuth authorization and token lifecycle', () => {
  let app: FastifyInstance; let db: HcdDatabase; let cookie: string; let clientId: string;
  let clock: number; let dataDir: string;
  const loader = vi.fn();
  beforeEach(async () => {
    clock = Date.now(); dataDir = mkdtempSync(join(tmpdir(), 'hcd-oauth-')); loader.mockReset(); db = openDatabase(':memory:');
    app = createApp({ db, dataDir, renderUrl: 'http://render.localhost:5173', secretKey: 'oauth-test-secret', appUrl: origin, seed: true, oauth: { metadataLoader: loader, now: () => clock } });
    registerMcpRoutes(app, { appUrl: origin }); await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(''), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    expect(login.statusCode).toBe(200); cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const registration = await app.inject({ method: 'POST', url: '/oauth/register', payload: metadata });
    expect(registration.statusCode).toBe(201); clientId = registration.json().client_id;
  });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function start(overrides: Record<string, string> = {}) {
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, scope: 'read comment submit ai_tasks preview', state: 'state-value', ...overrides });
    return app.inject({ method: 'GET', url: `/oauth/authorize?${query}` });
  }
  async function consent(overrides: Record<string, string> = {}) {
    const response = await start(overrides); expect(response.statusCode).toBe(302);
    const flowCookie = `${cookie}; ${String(response.headers['set-cookie']).split(';')[0]}`;
    const id = new URL(String(response.headers.location), origin).searchParams.get('request')!;
    return { flowCookie, id, url: `/api/v1/oauth/requests/${id}` };
  }
  async function code(scopes = 'read comment submit ai_tasks preview', days = 30) {
    const flow = await consent({ scope: scopes });
    const response = await app.inject({ method: 'POST', url: flow.url, headers: headers(flow.flowCookie), payload: { allow: true, docIds: [docId], expiresInDays: days } });
    expect(response.statusCode).toBe(200);
    const target = new URL(response.json().redirect); expect(target.origin).toBe('http://127.0.0.1:9876'); expect(target.searchParams.get('iss')).toBe(origin); expect(target.searchParams.get('state')).toBe('state-value');
    return target.searchParams.get('code')!;
  }
  const exchange = (value: string, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: value, code_verifier: verifier, redirect_uri: redirect, resource, ...extra }).toString() });
  const refresh = (value: string, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/oauth/token', payload: { grant_type: 'refresh_token', client_id: clientId, refresh_token: value, resource, ...extra } });
  const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  async function tokens(scope?: string, days?: number) { const result = await exchange(await code(scope, days)); expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); return result.json<TokenResponse>(); }

  it('AT-37 publishes trusted discovery metadata and MCP challenges without requiring cookies', async () => {
    const discovery = await app.inject({ url: '/.well-known/oauth-authorization-server', headers: { host: 'attacker.example' } });
    expect(discovery.json()).toMatchObject({ issuer: origin, client_id_metadata_document_supported: true, code_challenge_methods_supported: ['S256'] });
    expect(discovery.headers['access-control-allow-origin']).toBe('*');
    const protectedResource = await app.inject({ url: '/.well-known/oauth-protected-resource/mcp' });
    expect(protectedResource.json().resource).toBe(resource);
    const mcp = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(mcp.statusCode).toBe(401); expect(mcp.headers['www-authenticate']).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
  });
  it('AT-37 validates clients, exact callbacks, PKCE, resources and scopes before redirecting', async () => {
    for (const changes of [{ redirect_uri: 'https://attacker.example/cb' }, { redirect_uri: `${redirect}/` }, { resource: `${origin}/other` }, { code_challenge_method: 'plain' }, { code_challenge: 'x' }, { scope: 'admin' }, { response_type: 'token' }] as Record<string, string>[]) {
      const response = await start(changes); expect(response.statusCode).toBe(400); expect(response.headers.location).toBeUndefined();
    }
    for (const invalid of [{ redirect_uris: ['http://example.com/cb'] }, { redirect_uris: ['https://example.com/#'] }, { token_endpoint_auth_method: 'client_secret_basic' }]) expect((await app.inject({ method: 'POST', url: '/oauth/register', payload: { ...metadata, ...invalid } })).statusCode).toBe(400);
    const duplicate = await app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'client_id=a&client_id=b' }); expect(duplicate.statusCode).toBe(400);
  });
  it('AT-37 requires matching browser, session, CSRF marker, selected documents and one-use ' +
     'consent', async () => {
    const flow = await consent();
    expect((await app.inject({ url: flow.url, headers: { cookie } })).statusCode).toBe(400);
    const view = await app.inject({ url: flow.url, headers: headers(flow.flowCookie) }); expect(view.statusCode).toBe(200); expect(view.json().client.client_name).toBe(metadata.client_name);
    expect(view.json().documents.some((doc: { id: string }) => doc.id === docId)).toBe(true);
    const payload = { allow: true, docIds: [docId], expiresInDays: 7 };
    expect((await app.inject({ method: 'POST', url: flow.url, headers: { cookie: flow.flowCookie }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: flow.url, headers: { ...headers(flow.flowCookie), origin: 'https://attacker.example' }, payload })).statusCode).toBe(403);
    for (const bad of [[], ['d_missing']]) expect((await app.inject({ method: 'POST', url: flow.url, headers: headers(flow.flowCookie), payload: { ...payload, docIds: bad } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: flow.url, headers: headers(flow.flowCookie), payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: flow.url, headers: headers(flow.flowCookie), payload })).statusCode).toBe(400);
    const denied = await consent(); const refusal = await app.inject({ method: 'POST', url: denied.url, headers: headers(denied.flowCookie), payload: { allow: false } });
    expect(new URL(refusal.json().redirect).searchParams.get('error')).toBe('access_denied');
    expect(new URL(refusal.json().redirect).searchParams.has('code')).toBe(false);
  });
  it('AT-37 binds codes to client, redirect, verifier and resource; refresh credentials never ' +
     'authenticate API/MCP', async () => {
    const value = await code();
    for (const extra of [{ client_id: 'oc_other' }, { redirect_uri: `${redirect}/` }, { code_verifier: 'x'.repeat(64) }, { resource: 'https://other.example/mcp' }] as Record<string, string>[]) expect((await exchange(value, extra)).statusCode).toBe(400);
    const result = await exchange(value); expect(result.statusCode).toBe(200); const issued = result.json<TokenResponse>();
    expect(issued.expires_in).toBe(3600);
    expect((await get(`/api/v1/docs/${docId}`, issued.access_token)).statusCode).toBe(200);
    expect((await get('/api/v1/me', issued.refresh_token)).statusCode).toBe(401);
    expect((await get('/mcp', issued.refresh_token)).statusCode).toBe(401);
    const rpc = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${issued.access_token}`, accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_document', arguments: { documentId: docId } } } });
    expect(rpc.statusCode).toBe(200); expect(rpc.json().result.isError).toBe(false);
    const stored = db.prepare("SELECT * FROM api_tokens WHERE kind<>'pat'").all(); expect(JSON.stringify(stored)).not.toContain(issued.access_token); expect(JSON.stringify(stored)).not.toContain(issued.refresh_token);
  });
  it('AT-37 serializes concurrent code redemption and commits family revocation on replay', async () => {
    const value = await code(); const responses = await Promise.all([exchange(value), exchange(value)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    const issued = responses.find((response) => response.statusCode === 200)!.json<TokenResponse>();
    expect((await get('/api/v1/me', issued.access_token)).statusCode).toBe(401); expect((await refresh(issued.refresh_token)).statusCode).toBe(400);
  });
  it('AT-37 rotates refreshes, prevents scope escalation and revokes the whole family on ' +
     'concurrent reuse', async () => {
    const issued = await tokens('read comment'); const isolated = await tokens('read');
    expect((await refresh(issued.refresh_token, { scope: 'read submit' })).json().error).toBe('invalid_scope');
    expect((await refresh(issued.refresh_token, { client_id: 'oc_other' })).statusCode).toBe(400);
    const narrowed = await refresh(issued.refresh_token, { scope: 'read' }); expect(narrowed.statusCode).toBe(200); expect(narrowed.json().scope).toBe('read');
    const next = narrowed.json<TokenResponse>();
    expect((await refresh(next.refresh_token, { scope: 'read comment' })).json().error).toBe('invalid_scope');
    const concurrent = await Promise.all([refresh(next.refresh_token), refresh(next.refresh_token)]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    const latest = concurrent.find((response) => response.statusCode === 200)!.json<TokenResponse>();
    for (const value of [issued.access_token, next.access_token, latest.access_token]) expect((await get('/api/v1/me', value)).statusCode).toBe(401);
    expect((await get('/api/v1/me', isolated.access_token)).statusCode).toBe(200);
  });
  it('AT-37 never extends absolute authorization lifetime and rejects expired requests/codes', async () => {
    const issued = await tokens('read', 1); clock += 86400000 - 10000;
    const renewed = await refresh(issued.refresh_token); expect(renewed.statusCode).toBe(200); expect(renewed.json().expires_in).toBe(10);
    clock += 11000; expect((await refresh(renewed.json().refresh_token)).statusCode).toBe(400);
    const value = await code(); clock += 300001; expect((await exchange(value)).statusCode).toBe(400);
    const flow = await consent(); clock += 600001; expect((await app.inject({ url: flow.url, headers: headers(flow.flowCookie) })).statusCode).toBe(400);
    runMaintenance(db, clock); expect(db.prepare('SELECT 1 FROM oauth_requests WHERE id=?').get(flow.id)).toBeUndefined();
  });
  it('AT-37 intersects document scope, current membership, AI switch and never allows owner ' +
     'actions', async () => {
    const issued = await tokens();
    expect((await get('/api/v1/docs/d_aaaaaaac', issued.access_token)).statusCode).toBe(404);
    expect((await get('/api/v1/me/tokens', issued.access_token)).statusCode).toBe(403);
    expect((await get('/api/v1/spaces', issued.access_token)).statusCode).toBe(403);
    expect((await get(`/api/v1/docs/${docId}/draft`, issued.access_token)).statusCode).toBe(403);
    const settings = await app.inject({ method: 'PATCH', url: `/api/v1/docs/${docId}`, headers: { authorization: `Bearer ${issued.access_token}`, 'x-hcd-request': '1' }, payload: { aiEnabled: false } }); expect([403, 404]).toContain(settings.statusCode);
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId);
    expect((await get(`/api/v1/docs/${docId}`, issued.access_token)).statusCode).toBe(403); expect((await get('/api/v1/docs', issued.access_token)).json().docs).toEqual([]);
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    const user = (db.prepare('SELECT user_id FROM oauth_grants LIMIT 1').get() as { user_id: string }).user_id;
    db.prepare('UPDATE users SET is_admin=0 WHERE id=?').run(user); db.prepare('DELETE FROM space_members WHERE user_id=?').run(user); db.prepare('DELETE FROM document_members WHERE user_id=?').run(user);
    expect((await get(`/api/v1/docs/${docId}`, issued.access_token)).statusCode).toBe(404);
  });
  it('AT-37 lists one authorization per family and revokes by personal settings or protocol', async () => {
    const issued = await tokens(); const next = (await refresh(issued.refresh_token)).json<TokenResponse>();
    const listing = await app.inject({ url: '/api/v1/me/tokens', headers: { cookie } }); expect(listing.statusCode).toBe(200);
    expect(listing.json().tokens).toHaveLength(1); const grant = listing.json().tokens[0]; expect(grant.kind).toBe('oauth');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/me/tokens/${grant.id}`, headers: headers(cookie) })).statusCode).toBe(204);
    expect((await get('/api/v1/me', next.access_token)).statusCode).toBe(401); expect((await refresh(next.refresh_token)).statusCode).toBe(400);
    const another = await tokens();
    expect((await app.inject({ method: 'POST', url: '/oauth/revoke', payload: { client_id: 'oc_wrong', token: another.access_token } })).statusCode).toBe(200);
    expect((await get('/api/v1/me', another.access_token)).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/oauth/revoke', payload: { client_id: clientId, token: another.refresh_token } })).statusCode).toBe(200);
    expect((await get('/api/v1/me', another.access_token)).statusCode).toBe(401);
  });
  it('AT-37 keeps private drafts out of token reads and preserves them when the client submits', async () => {
    const content = (await app.inject({ url: `/api/v1/docs/${docId}`, headers: { cookie } })).json().content;
    const draft = { ...content, title: 'Private unpublished title' };
    expect((await app.inject({ method: 'PUT', url: `/api/v1/docs/${docId}/draft`, headers: headers(cookie), payload: { baseVersion: 1, content: draft } })).statusCode).toBe(200);
    const issued = await tokens();
    expect((await get(`/api/v1/docs/${docId}`, issued.access_token)).json().draft).toBeUndefined();
    const submitted = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { authorization: `Bearer ${issued.access_token}`, 'x-hcd-request': '1', 'idempotency-key': 'oauth-draft-preservation' }, payload: { baseVersion: 1, content, message: 'Client changes' } });
    expect(submitted.statusCode).toBe(201);
    expect((await app.inject({ url: `/api/v1/docs/${docId}`, headers: { cookie } })).json().draft.content.title).toBe('Private unpublished title');
    const readonly = await tokens('read');
    expect((await get(`/api/v1/docs/${docId}/submissions`, readonly.access_token)).statusCode).toBe(200);
    expect((await get(`/api/v1/submissions/${submitted.json().submission.id}`, readonly.access_token)).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { authorization: `Bearer ${readonly.access_token}`, 'x-hcd-request': '1' }, payload: { baseVersion: 1, content } })).statusCode).toBe(403);
  });
  it('AT-37 rechecks OAuth credentials when serving an already issued signed asset URL', async () => {
    const issued = await tokens('read');
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
    const asset = await createAssetStore(db, dataDir).save(docId, 'u_owner000000', image, 'image/png');
    const signed = await get(`/api/v1/docs/${docId}/assets/${asset.id}/url`, issued.access_token); expect(signed.statusCode).toBe(200);
    const url = new URL(signed.json().url);
    expect(url.searchParams.get('c')).toMatch(/^tok_/);
    const serve = () => app.inject({ url: url.pathname + url.search, headers: { host: url.host } });
    expect((await serve()).rawPayload).toEqual(image);
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId); expect((await serve()).statusCode).toBe(404);
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    await app.inject({ method: 'POST', url: '/oauth/revoke', payload: { client_id: clientId, token: issued.refresh_token } });
    expect((await serve()).statusCode).toBe(404);
  });
  it('AT-37 requires both AI-task and submit scope plus current role for task claims/completion', async () => {
    const at = new Date().toISOString();
    const document = (await get(`/api/v1/docs/${docId}`, (await tokens()).access_token)).json().content;
    db.prepare("INSERT INTO ai_tasks(id,doc_id,requested_by,kind,status,instruction,module_ids,created_at,updated_at) VALUES('at_oauthtest',?,'u_owner000000','edit','approved','Help',?,?,?)").run(docId, JSON.stringify([document.modules[0].id]), at, at);
    const limited = await tokens('read ai_tasks'); const full = await tokens('read submit ai_tasks');
    let completion = {};
    const taskAction = (action: string, token: string) => app.inject({ method: 'POST', url: `/api/v1/ai-tasks/at_oauthtest/${action}`, headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' }, payload: completion });
    expect((await taskAction('claim', limited.access_token)).statusCode).toBe(403);
    const claimed = await taskAction('claim', full.access_token); expect(claimed.statusCode).toBe(200);
    const submitted = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { authorization: `Bearer ${full.access_token}`, 'x-hcd-request': '1', 'idempotency-key': 'oauth-ai' }, payload: { baseVersion: 1, content: document, aiTaskId: 'at_oauthtest', claimId: claimed.json().claimId } });
    expect(submitted.statusCode).toBe(201); completion = { claimId: claimed.json().claimId, submissionId: submitted.json().submission.id };
    db.prepare("UPDATE space_members SET role='viewer' WHERE user_id='u_owner000000'").run(); db.prepare("UPDATE document_members SET role='viewer' WHERE user_id='u_owner000000'").run();
    expect((await taskAction('complete', full.access_token)).statusCode).toBe(403);
    db.prepare("UPDATE space_members SET role='owner' WHERE user_id='u_owner000000'").run();
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId); expect((await taskAction('complete', full.access_token)).statusCode).toBe(403);
    db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId); expect((await taskAction('complete', full.access_token)).statusCode).toBe(200);
  });
  it('AT-37 revokes access, refreshes and outstanding codes when a password is reset', async () => {
    const issued = await tokens(); const pendingCode = await code();
    const reset = issueInvitation(db, 'u_owner000000', 'reset', 'u_admin000000', { secretKey: 'oauth-test-secret', appUrl: origin });
    const response = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${reset.token}/accept`, headers: headers(''), payload: { password: 'new-oauth-test-password' } });
    expect(response.statusCode).toBe(200);
    expect((await get('/api/v1/me', issued.access_token)).statusCode).toBe(401); expect((await refresh(issued.refresh_token)).statusCode).toBe(400); expect((await exchange(pendingCode)).statusCode).toBe(400);
  });
  it('AT-37 does not resurrect authorizations when a disabled account is re-enabled', async () => {
    const issued = await tokens(); const pendingCode = await code();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(''), payload: { email: 'admin@example.com', password: 'hcd-demo-2026' } });
    const admin = String(login.headers['set-cookie']).split(';')[0]!;
    db.prepare("UPDATE space_members SET role='owner' WHERE user_id='u_editor00000'").run(); db.prepare("UPDATE document_members SET role='owner' WHERE user_id='u_editor00000'").run();
    for (const disabled of [true, false]) expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_owner000000', headers: headers(admin), payload: { disabled } })).statusCode).toBe(200);
    expect((await get('/api/v1/me', issued.access_token)).statusCode).toBe(401); expect((await refresh(issued.refresh_token)).statusCode).toBe(400); expect((await exchange(pendingCode)).statusCode).toBe(400);
  });
  it('AT-37 binds an inspected consent request to the signed-in user', async () => {
    const flow = await consent(); expect((await app.inject({ url: flow.url, headers: headers(flow.flowCookie) })).statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(''), payload: { email: 'a@example.com', password: 'hcd-demo-2026' } });
    const other = String(login.headers['set-cookie']).split(';')[0]!;
    const browserCookie = flow.flowCookie.split('; ').find((item) => item.startsWith('hcd_oauth='))!;
    expect((await app.inject({ url: flow.url, headers: headers(`${other}; ${browserCookie}`) })).statusCode).toBe(400);
  });
  it('AT-37 supports cached client metadata documents with exact IDs and no redirects on fetch ' +
     'failure', async () => {
    const url = 'https://client.example/oauth/client.json';
    loader.mockResolvedValue({ body: { ...metadata, client_id: url }, maxAge: 60 });
    expect((await start({ client_id: url })).statusCode).toBe(302); expect((await start({ client_id: url })).statusCode).toBe(302); expect(loader).toHaveBeenCalledTimes(1);
    clock += 61000; loader.mockResolvedValue({ body: { ...metadata, client_id: 'https://wrong.example/id' }, maxAge: 60 });
    expect((await start({ client_id: url })).statusCode).toBe(400);
    loader.mockRejectedValue(new Error('network failure')); const response = await start({ client_id: url }); expect(response.statusCode).toBe(400); expect(response.headers.location).toBeUndefined();
  });
});

describe('OAuth client metadata validation', () => {
  it('AT-37 rejects unsafe callback forms and confidential clients', () => {
    for (const uri of ['javascript:alert(1)', 'http://example.com/cb', 'https://a.example/#', 'https://u:p@a.example/cb', 'https://*.example.com/cb', ' https://a.example/cb', 'http://127.0.0.1.evil/cb']) expect(validRedirect(uri)).toBe(false);
    for (const uri of ['https://client.example/callback', 'http://127.0.0.1:1234/callback', 'http://[::1]:1234/callback']) expect(validRedirect(uri)).toBe(true);
    expect(() => validateClient({ ...metadata, token_endpoint_auth_method: 'client_secret_post' })).toThrow();
  });
  it('AT-37 blocks private, reserved, loopback and IPv6 metadata targets', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.31.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '::1', '::ffff:8.8.8.8']) expect(publicIPv4(address)).toBe(false);
    expect(publicIPv4('8.8.8.8')).toBe(true);
  });
});
