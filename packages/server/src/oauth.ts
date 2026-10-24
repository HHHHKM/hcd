import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import type { HcdDatabase } from './db';
import { loadClientMetadata, OAuthError, oauthScopes, parseScopes, validateClient, type ClientMetadata, type MetadataLoader } from './oauth-client';

type Grant = { id: string; user_id: string; client_id: string; name: string; scopes: string; doc_ids: string; resource: string; refresh_allowed: number; expires_at: string; revoked_at: string | null };
type ConsentRequest = { id: string; user_id: string | null; browser_hash: string; client_id: string; metadata: string; redirect_uri: string; scopes: string; resource: string; state: string | null; challenge: string; expires_at: string; used_at: string | null };
type SessionUser = { id: string };
export type OAuthOptions = { metadataLoader?: MetadataLoader; now?: () => number };
const random = (prefix: string) => prefix + randomBytes(32).toString('base64url');
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OAuthError('invalid_request');
  return input as Record<string, unknown>;
};
const string = (value: unknown, max = 2048) => { if (typeof value !== 'string' || !value || value.length > max) throw new OAuthError('invalid_request'); return value; };
export function revokeOAuthGrant(db: HcdDatabase, id: string, at = new Date().toISOString()) {
  db.transaction(() => {
    db.prepare('UPDATE oauth_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(at, id);
    db.prepare('UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE grant_id=?').run(at, id);
  })();
}
export function registerOAuth(app: FastifyInstance, config: OAuthOptions & {
  db: HcdDatabase; appUrl: string; digest: (value: string) => string;
  session: (request: FastifyRequest, reply: FastifyReply) => Promise<SessionUser | null>;
  writeGuard: (request: FastifyRequest, reply: FastifyReply) => boolean;
  documents: (user: SessionUser) => Array<{ id: string; title: string }>;
  rateLimit: (key: string, max: number, now: number) => number;
}) {
  const { db, digest } = config;
  const issuer = new URL(config.appUrl).origin;
  const resource = `${issuer}/mcp`;
  const now = config.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const after = (ms: number) => new Date(now() + ms).toISOString();
  const loader = config.metadataLoader ?? loadClientMetadata;
  const cookieName = 'hcd_oauth';
  const safe = (handler: RouteHandlerMethod): RouteHandlerMethod => async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    try {
      if (config.rateLimit(`oauth:${request.ip}`, 60, now()) || config.rateLimit('oauth:global', 1000, now())) throw new OAuthError('temporarily_unavailable', 429);
      return await handler.call(app, request, reply);
    } catch (error) {
      return reply.code(error instanceof OAuthError ? error.status : 500).send({ error: error instanceof OAuthError ? error.code : 'server_error' });
    }
  };
  const route = (method: 'GET' | 'POST', url: string, handler: RouteHandlerMethod) => app.route({ method, url, bodyLimit: 16384, handler: safe(handler),
    onRequest: async (_request, reply) => { reply.header('Cache-Control', 'no-store'); if (method === 'POST' && url.startsWith('/oauth/')) reply.header('Access-Control-Allow-Origin', '*'); },
    errorHandler: (_error, _request, reply) => reply.header('Cache-Control', 'no-store').code(400).send({ error: 'invalid_request' }),
  });
  for (const url of ['/oauth/token', '/oauth/register', '/oauth/revoke']) app.options(url, async (_request, reply) => reply.header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Methods', 'POST, OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type').code(204).send());
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const params = new URLSearchParams(String(body)); const parsed: Record<string, string> = Object.create(null);
    for (const [key, value] of params) { if (Object.hasOwn(parsed, key)) { done(new OAuthError('invalid_request')); return; } parsed[key] = value; }
    done(null, parsed);
  });
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) route('GET', path, async (_request, reply) => reply.header('Access-Control-Allow-Origin', '*').send({ resource, authorization_servers: [issuer], scopes_supported: oauthScopes, bearer_methods_supported: ['header'], resource_name: 'HCD' }));
  route('GET', '/.well-known/oauth-authorization-server', async (_request, reply) => reply.header('Access-Control-Allow-Origin', '*').send({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: oauthScopes, client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true }));
  route('POST', '/oauth/register', async (request, reply) => {
    const metadata = validateClient(request.body);
    if ((db.prepare('SELECT COUNT(*) n FROM oauth_clients WHERE source=?').get('dynamic') as { n: number }).n >= 10000) throw new OAuthError('temporarily_unavailable', 429);
    const id = random('oc_');
    db.prepare('INSERT INTO oauth_clients(id,metadata,source,created_at) VALUES(?,?,?,?)').run(id, JSON.stringify(metadata), 'dynamic', iso());
    return reply.code(201).send({ ...metadata, client_id: id, client_id_issued_at: Math.floor(now() / 1000) });
  });
  async function client(id: string): Promise<ClientMetadata> {
    const saved = db.prepare('SELECT metadata,source,expires_at FROM oauth_clients WHERE id=?').get(id) as { metadata: string; source: string; expires_at: string | null } | undefined;
    if (saved && (saved.source === 'dynamic' || saved.expires_at && saved.expires_at > iso())) return JSON.parse(saved.metadata) as ClientMetadata;
    if (!id.startsWith('https://')) throw new OAuthError('invalid_client');
    let fetched: Awaited<ReturnType<MetadataLoader>>;
    try { fetched = await loader(id); } catch { throw new OAuthError('invalid_client'); }
    const metadata = validateClient(fetched.body, id);
    // Bound cached client records, even when a malicious URL changes every request.
    db.prepare("DELETE FROM oauth_clients WHERE source='metadata' AND expires_at<=?").run(iso());
    if (Number.isFinite(fetched.maxAge) && fetched.maxAge > 0) {
      if ((db.prepare("SELECT COUNT(*) n FROM oauth_clients WHERE source='metadata'").get() as { n: number }).n >= 1000) throw new OAuthError('temporarily_unavailable', 429);
      db.prepare("INSERT INTO oauth_clients(id,metadata,source,created_at,expires_at) VALUES(?,?,'metadata',?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,expires_at=excluded.expires_at").run(id, JSON.stringify(metadata), iso(), after(Math.min(fetched.maxAge, 3600) * 1000));
    }
    return metadata;
  }
  route('GET', '/oauth/authorize', async (request, reply) => {
    const query = object(request.query);
    const clientId = string(query.client_id); const redirect = string(query.redirect_uri);
    const metadata = await client(clientId);
    if (!metadata.redirect_uris.includes(redirect)) throw new OAuthError('invalid_redirect_uri');
    if (query.response_type !== 'code' || query.code_challenge_method !== 'S256') throw new OAuthError('invalid_request');
    const challenge = string(query.code_challenge, 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || Buffer.from(challenge, 'base64url').toString('base64url') !== challenge) throw new OAuthError('invalid_request');
    if (query.resource !== resource) throw new OAuthError('invalid_target');
    const scopes = parseScopes(query.scope ?? 'read');
    const state = query.state === undefined ? null : string(query.state, 1024);
    db.prepare('DELETE FROM oauth_requests WHERE expires_at<=?').run(iso());
    if ((db.prepare('SELECT COUNT(*) n FROM oauth_requests').get() as { n: number }).n >= 1000) throw new OAuthError('temporarily_unavailable', 429);
    const browser = random('ob_'); const id = random('or_');
    db.prepare('INSERT INTO oauth_requests(id,browser_hash,client_id,metadata,redirect_uri,scopes,resource,state,challenge,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, digest(browser), clientId, JSON.stringify(metadata), redirect, JSON.stringify(scopes), resource, state, challenge, after(600000));
    reply.setCookie(cookieName, browser, { httpOnly: true, sameSite: 'lax', secure: issuer.startsWith('https:'), path: '/', maxAge: 600 });
    return reply.redirect(`/oauth/consent?request=${encodeURIComponent(id)}`);
  });
  function consent(request: FastifyRequest, user: SessionUser) {
    const id = string(object(request.params).id, 100);
    const row = db.prepare('SELECT * FROM oauth_requests WHERE id=?').get(id) as ConsentRequest | undefined;
    const browser = request.cookies[cookieName];
    if (!row || !browser || row.browser_hash !== digest(browser) || row.expires_at <= iso() || row.used_at || row.user_id && row.user_id !== user.id) throw new OAuthError('invalid_request');
    if (!row.user_id) db.prepare('UPDATE oauth_requests SET user_id=? WHERE id=? AND user_id IS NULL').run(user.id, id);
    return row;
  }
  route('GET', '/api/v1/oauth/requests/:id', async (request, reply) => {
    const user = await config.session(request, reply); if (!user) return;
    const row = consent(request, user);
    return { client: { ...JSON.parse(row.metadata), client_id: row.client_id }, redirectUri: row.redirect_uri, scopes: JSON.parse(row.scopes), expiresAt: row.expires_at, documents: config.documents(user), user };
  });
  route('POST', '/api/v1/oauth/requests/:id', async (request, reply) => {
    if (!config.writeGuard(request, reply)) return;
    const user = await config.session(request, reply); if (!user) return;
    const body = object(request.body);
    if (typeof body.allow !== 'boolean') throw new OAuthError('invalid_request');
    const result = db.transaction(() => {
      const row = consent(request, user);
      const target = new URL(row.redirect_uri);
      for (const key of ['code', 'error', 'error_description', 'state', 'iss']) target.searchParams.delete(key);
      target.searchParams.set('iss', issuer); if (row.state !== null) target.searchParams.set('state', row.state);
      if (body.allow) {
        const docs = body.docIds;
        const days = body.expiresInDays;
        const available = new Set(config.documents(user).map((doc) => doc.id));
        if (!Array.isArray(docs) || !docs.length || docs.length > 100 || docs.some((id) => typeof id !== 'string' || !available.has(id)) || typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 30) throw new OAuthError('invalid_request');
        const id = random('og_'); const code = random('hcd_oc_');
        const metadata = JSON.parse(row.metadata) as ClientMetadata;
        db.prepare('INSERT INTO oauth_grants(id,user_id,client_id,name,scopes,doc_ids,resource,refresh_allowed,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, user.id, row.client_id, metadata.client_name, row.scopes, JSON.stringify([...new Set(docs)]), resource, metadata.grant_types.includes('refresh_token') ? 1 : 0, iso(), after(days * 86400000));
        db.prepare('INSERT INTO oauth_codes(token_hash,grant_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?)').run(digest(code), id, row.redirect_uri, row.challenge, after(300000));
        target.searchParams.set('code', code);
      } else target.searchParams.set('error', 'access_denied');
      db.prepare('UPDATE oauth_requests SET used_at=? WHERE id=?').run(iso(), row.id);
      return { redirect: target.href };
    })();
    reply.clearCookie(cookieName, { path: '/' });
    return result;
  });
  function grant(id: string): Grant | undefined {
    return db.prepare('SELECT g.* FROM oauth_grants g JOIN users u ON u.id=g.user_id WHERE g.id=? AND g.revoked_at IS NULL AND g.expires_at>? AND u.disabled_at IS NULL').get(id, iso()) as Grant | undefined;
  }
  function issue(g: Grant, scopes: string[]) {
    const access = random('hcd_oat_'); const refresh = g.refresh_allowed ? random('hcd_ort_') : undefined;
    const expires = Math.min(now() + 3600000, Date.parse(g.expires_at));
    const insert = db.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,doc_ids,expires_at,created_at,kind,client_id,grant_id,resource) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    insert.run(random('tok_'), g.user_id, g.name, digest(access), JSON.stringify(scopes), g.doc_ids, new Date(expires).toISOString(), iso(), 'oauth_access', g.client_id, g.id, resource);
    if (refresh) insert.run(random('tok_'), g.user_id, g.name, digest(refresh), JSON.stringify(scopes), g.doc_ids, g.expires_at, iso(), 'oauth_refresh', g.client_id, g.id, resource);
    return { access_token: access, token_type: 'Bearer', expires_in: Math.floor((expires - now()) / 1000), scope: scopes.join(' '), ...(refresh ? { refresh_token: refresh } : {}) };
  }
  route('POST', '/oauth/token', async (request, reply) => {
    const body = object(request.body); const clientId = string(body.client_id);
    if (request.headers.authorization || body.client_secret !== undefined) throw new OAuthError('invalid_client', 401);
    if (body.resource !== resource) throw new OAuthError('invalid_target');
    // Errors that revoke a family must be returned from the transaction, never thrown (rollback).
    const result = db.transaction(() => {
      if (body.grant_type === 'authorization_code') {
        const code = db.prepare('SELECT * FROM oauth_codes WHERE token_hash=?').get(digest(string(body.code))) as { grant_id: string; redirect_uri: string; challenge: string; expires_at: string; used_at: string | null } | undefined;
        const g = code && grant(code.grant_id);
        if (!code || !g || g.client_id !== clientId || g.resource !== resource || body.redirect_uri !== code.redirect_uri) return { error: 'invalid_grant' };
        const verifier = string(body.code_verifier, 128);
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== code.challenge) return { error: 'invalid_grant' };
        if (code.used_at) { revokeOAuthGrant(db, g.id, iso()); return { error: 'invalid_grant' }; }
        if (code.expires_at <= iso()) return { error: 'invalid_grant' };
        db.prepare('UPDATE oauth_codes SET used_at=? WHERE token_hash=?').run(iso(), digest(String(body.code)));
        return issue(g, JSON.parse(g.scopes));
      }
      if (body.grant_type === 'refresh_token') {
        const token = db.prepare("SELECT * FROM api_tokens WHERE token_hash=? AND kind='oauth_refresh'").get(digest(string(body.refresh_token))) as { grant_id: string; client_id: string; scopes: string; resource: string; consumed_at: string | null; revoked_at: string | null; expires_at: string } | undefined;
        const g = token && grant(token.grant_id);
        if (!token || !g || token.client_id !== clientId || g.client_id !== clientId || token.resource !== resource || g.resource !== resource) return { error: 'invalid_grant' };
        if (token.consumed_at) { revokeOAuthGrant(db, g.id, iso()); return { error: 'invalid_grant' }; }
        if (token.revoked_at || token.expires_at <= iso() || !g.refresh_allowed) return { error: 'invalid_grant' };
        const previous = JSON.parse(token.scopes) as string[];
        const scopes = body.scope === undefined ? previous : parseScopes(body.scope);
        if (scopes.some((scope) => !previous.includes(scope))) return { error: 'invalid_scope' };
        db.prepare('UPDATE api_tokens SET consumed_at=?,revoked_at=? WHERE token_hash=?').run(iso(), iso(), digest(String(body.refresh_token)));
        return issue(g, scopes);
      }
      return { error: 'unsupported_grant_type' };
    })();
    return reply.code('error' in result ? 400 : 200).send(result);
  });
  route('POST', '/oauth/revoke', async (request, reply) => {
    const body = object(request.body); const clientId = string(body.client_id); const token = string(body.token);
    if (request.headers.authorization || body.client_secret !== undefined) throw new OAuthError('invalid_client', 401);
    const row = db.prepare("SELECT grant_id FROM api_tokens WHERE token_hash=? AND client_id=? AND kind IN ('oauth_access','oauth_refresh')").get(digest(token), clientId) as { grant_id: string } | undefined;
    if (row) revokeOAuthGrant(db, row.grant_id, iso());
    return reply.code(200).send({});
  });
}
