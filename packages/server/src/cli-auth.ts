import { personalAccessToken, PERSONAL_ACCESS_TOKEN_BYTES } from '../../core/src/tokens';
import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import type { HcdDatabase } from './db';
import { revokeOAuthGrant } from './oauth';

export type CliAuthOptions = { now?: () => number };
type Session = { id: string; name: string; email: string; locale: string; sessionHash: string };
type Status = 'pending' | 'approved' | 'denied' | 'expired';
type DeviceRequest = { code: string; poll_hash: string | null; client_name: string; hostname: string; status: Status; user_id: string | null; session_hash: string | null; token_id: string | null; expires_at: string; last_poll_at: number | null };
type Token = { id: string; user_id: string; name: string; token_hash: string; scopes: string; doc_ids: string | null; created_at: string; expires_at: string; revoked_at: string | null; kind: string; grant_id: string | null; resource: string | null };
const defaultScopes = ['read', 'comment', 'submit', 'ai_tasks'];
const optionalScopes = ['preview'];
const interval = 3;
const lifetime = 600_000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
class CliAuthError extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
const bodyObject = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliAuthError('VALIDATION_FAILED'); return value as Record<string, unknown>; };
const publicUser = (user: Pick<Session, 'id' | 'name' | 'email' | 'locale'>) => ({ id: user.id, name: user.name, email: user.email, locale: user.locale });
function normalizeCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i.test(value)) throw new CliAuthError('CLI_AUTH_NOT_FOUND', 404);
  const compact = value.replace('-', '').toUpperCase(); return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
/** Erase the derivation input when delivery expires; issued PATs retain their own lifetime. */
export function expireCliAuth(db: HcdDatabase, now = Date.now()): number {
  const timestamp = new Date(now).toISOString();
  const changed = db.prepare("UPDATE cli_auth_requests SET status='expired',poll_hash=NULL,session_hash=NULL WHERE expires_at<=? AND (status<>'expired' OR poll_hash IS NOT NULL OR session_hash IS NOT NULL)").run(timestamp).changes;
  db.prepare('DELETE FROM cli_auth_requests WHERE expires_at<=?').run(new Date(now - 86400000).toISOString());
  return changed;
}

export function registerCliAuth(app: FastifyInstance, config: CliAuthOptions & {
  db: HcdDatabase; appUrl: string; secret: string; digest: (value: string) => string;
  session: (request: FastifyRequest, reply: FastifyReply) => Promise<Session | null>;
  documents: (user: Pick<Session, 'id'>) => Array<{ id: string; title: string }>;
  writeGuard: (request: FastifyRequest, reply: FastifyReply) => boolean;
  rateLimit: (key: string, max: number, now: number) => number;
}) {
  const { db, digest } = config; const now = config.now ?? Date.now;
  const origin = new URL(config.appUrl).origin; const iso = () => new Date(now()).toISOString();
  // The random poll hash is a disposable derivation input, never the bearer token.
  // Domain separation keeps these credentials independent from all other secret-key uses.
  const credential = (row: DeviceRequest) => personalAccessToken(createHmac('sha256', config.secret).update(JSON.stringify(['hcd-cli-auth-token-v1', row.code, row.poll_hash, row.user_id])).digest().subarray(0, PERSONAL_ACCESS_TOKEN_BYTES));
  const originGuard = (request: FastifyRequest) => { if (request.headers.origin && request.headers.origin !== origin) throw new CliAuthError('ORIGIN_MISMATCH', 403); };
  const limit = (request: FastifyRequest, reply: FastifyReply, key: string, perIp: number, global: number) => {
    const retry = config.rateLimit(`cli-auth:${key}:${request.ip}`, perIp, now()) || config.rateLimit(`cli-auth:${key}:global`, global, now());
    if (retry) { reply.header('Retry-After', String(retry)); throw new CliAuthError('RATE_LIMITED', 429); }
  };
  const route = (method: 'GET' | 'POST', url: string, handler: RouteHandlerMethod) => app.route({ method, url: `/api/v1/cli-auth${url}`, bodyLimit: 16384,
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
      try { originGuard(request); return await handler.call(app, request, reply); }
      catch (error) { if (error instanceof CliAuthError) return reply.code(error.status).send({ error: { code: error.code }, ...(error.code === 'SLOW_DOWN' ? { interval } : {}) }); throw error; }
    },
  });
  const find = (code: string) => db.prepare('SELECT * FROM cli_auth_requests WHERE code=?').get(code) as DeviceRequest | undefined;
  const requestFor = (request: FastifyRequest) => { expireCliAuth(db, now()); const row = find(normalizeCode(bodyObject(request.params).code)); if (!row) throw new CliAuthError('CLI_AUTH_NOT_FOUND', 404); return row; };
  const sessionActive = (userId: string, sessionHash: string) => Boolean(db.prepare('SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL').get(userId, sessionHash, iso()));
  const requireBinding = (row: DeviceRequest, user: Session) => {
    if (!row.user_id || !row.session_hash) throw new CliAuthError('CLI_AUTH_REVIEW_REQUIRED', 409);
    if (row.user_id !== user.id || row.session_hash !== user.sessionHash) throw new CliAuthError('CLI_AUTH_SESSION_MISMATCH', 409);
    if (!sessionActive(user.id, user.sessionHash)) throw new CliAuthError('UNAUTHENTICATED', 401);
  };
  const tokenFor = (row: DeviceRequest) => db.prepare('SELECT * FROM api_tokens WHERE id=?').get(row.token_id) as Token | undefined;
  const available = (row: DeviceRequest, token: Token | undefined) => {
    if (!row.poll_hash || !row.user_id || !row.session_hash || !token || token.user_id !== row.user_id || token.kind !== 'pat' || token.revoked_at || token.expires_at <= iso() || token.token_hash !== digest(credential(row))) return false;
    if (!sessionActive(row.user_id, row.session_hash)) return false;
    const ids: string[] | null = token.doc_ids ? JSON.parse(token.doc_ids) : null;
    if (ids) { const current = new Set(config.documents({ id: row.user_id }).map(doc => doc.id)); if (ids.some(id => !current.has(id))) return false; }
    return true;
  };
  route('POST', '/start', async (request, reply) => {
    limit(request, reply, 'start', 6, 60);
    const body = bodyObject(request.body);
    if (body.clientName !== 'mdoc' || typeof body.hostname !== 'string' || !body.hostname.trim() || body.hostname.length > 100 || /[\p{Cc}\p{Cf}]/u.test(body.hostname) || Object.keys(body).some(key => !['clientName', 'hostname'].includes(key))) throw new CliAuthError('VALIDATION_FAILED');
    expireCliAuth(db, now());
    if ((db.prepare("SELECT COUNT(*) count FROM cli_auth_requests WHERE status<>'expired'").get() as { count: number }).count >= 1000) throw new CliAuthError('RATE_LIMITED', 429);
    let code: string; do { const chars = [...randomBytes(8)].map(byte => alphabet[byte & 31]).join(''); code = `${chars.slice(0, 4)}-${chars.slice(4)}`; } while (find(code));
    const pollToken = randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO cli_auth_requests(code,poll_hash,client_name,hostname,status,created_at,expires_at) VALUES(?,?,?,?,'pending',?,?)").run(code, digest(pollToken), body.clientName, body.hostname.trim(), iso(), new Date(now() + lifetime).toISOString());
    const verifyUrl = new URL('/cli-auth', origin); verifyUrl.searchParams.set('code', code);
    return { code, verifyUrl: verifyUrl.href, pollToken, expiresIn: lifetime / 1000, interval };
  });
  route('GET', '/requests/:code', async (request, reply) => {
    limit(request, reply, 'consent', 60, 1000);
    const user = await config.session(request, reply); if (!user) return;
    const row = db.transaction(() => {
      if (!sessionActive(user.id, user.sessionHash)) throw new CliAuthError('UNAUTHENTICATED', 401);
      const value = requestFor(request);
      if (value.status !== 'expired') {
        if (!value.user_id) db.prepare('UPDATE cli_auth_requests SET user_id=?,session_hash=? WHERE code=? AND user_id IS NULL').run(user.id, user.sessionHash, value.code);
        else requireBinding(value, user);
      }
      return find(value.code)!;
    })();
    return { request: { code: row.code, clientName: row.client_name, hostname: row.hostname, scopes: defaultScopes, optionalScopes, expiresAt: row.expires_at, status: row.status }, documents: config.documents(user), user: publicUser(user) };
  });
  route('POST', '/requests/:code', async (request, reply) => {
    limit(request, reply, 'consent', 60, 1000);
    if (!config.writeGuard(request, reply)) return;
    const user = await config.session(request, reply); if (!user) return;
    const body = bodyObject(request.body); if (!['approve', 'deny'].includes(String(body.decision))) throw new CliAuthError('VALIDATION_FAILED');
    return db.transaction(() => {
      const row = requestFor(request); if (row.status === 'expired') return { status: 'expired' };
      requireBinding(row, user);
      const next = body.decision === 'approve' ? 'approved' : 'denied';
      if (row.status !== 'pending') { if (row.status !== next) throw new CliAuthError('CLI_AUTH_ALREADY_DECIDED', 409); return { status: row.status }; }
      if (next === 'approved') {
        const scopes = body.scopes ?? defaultScopes; const allowed = new Set([...defaultScopes, ...optionalScopes]);
        const days = body.expiresInDays ?? 30; const docs = body.docIds;
        if (!Array.isArray(scopes) || !scopes.length || scopes.length > allowed.size || scopes.some(scope => typeof scope !== 'string' || !allowed.has(scope)) || !Number.isInteger(days) || Number(days) < 1 || Number(days) > 90) throw new CliAuthError('VALIDATION_FAILED');
        const documentIds = new Set(config.documents(user).map(doc => doc.id));
        if (docs !== null && (!Array.isArray(docs) || !docs.length || docs.length > 100 || docs.some(id => typeof id !== 'string' || !documentIds.has(id)))) throw new CliAuthError('VALIDATION_FAILED');
        const token = credential(row); const tokenId = `tok_${randomBytes(16).toString('hex')}`;
        db.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,doc_ids,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(tokenId, user.id, `${row.client_name} · ${row.hostname}`, digest(token), JSON.stringify([...new Set(scopes)]), docs === null ? null : JSON.stringify([...new Set(docs as string[])]), new Date(now() + Number(days) * 86400000).toISOString(), iso());
        db.prepare("UPDATE cli_auth_requests SET status='approved',token_id=? WHERE code=? AND status='pending'").run(tokenId, row.code);
      } else db.prepare("UPDATE cli_auth_requests SET status='denied' WHERE code=? AND status='pending'").run(row.code);
      return { status: next };
    })();
  });
  route('POST', '/poll', async (request, reply) => {
    limit(request, reply, 'poll', 120, 3000);
    const body = bodyObject(request.body);
    if (typeof body.pollToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.pollToken) || Object.keys(body).some(key => key !== 'pollToken')) throw new CliAuthError('VALIDATION_FAILED');
    expireCliAuth(db, now());
    return db.transaction(() => {
      const row = db.prepare('SELECT * FROM cli_auth_requests WHERE poll_hash=?').get(digest(body.pollToken as string)) as DeviceRequest | undefined;
      if (!row) return { status: 'expired' };
      if (row.last_poll_at !== null && now() - row.last_poll_at < interval * 1000) { reply.header('Retry-After', String(Math.max(1, Math.ceil((interval * 1000 - now() + row.last_poll_at) / 1000)))); throw new CliAuthError('SLOW_DOWN', 429); }
      db.prepare('UPDATE cli_auth_requests SET last_poll_at=? WHERE code=?').run(now(), row.code);
      if (row.status !== 'approved') return { status: row.status, interval };
      const token = tokenFor(row);
      if (!available(row, token)) {
        if (token) db.prepare('UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(iso(), token.id);
        db.prepare("UPDATE cli_auth_requests SET status='denied' WHERE code=?").run(row.code);
        return { status: 'denied' };
      }
      const user = db.prepare('SELECT id,email,name,locale FROM users WHERE id=?').get(row.user_id) as Session;
      return { status: 'approved', token: credential(row), tokenId: token!.id, expiresAt: token!.expires_at, user: publicUser(user), meta: { id: token!.id, name: token!.name, scopes: JSON.parse(token!.scopes), docIds: token!.doc_ids ? JSON.parse(token!.doc_ids) : null, createdAt: token!.created_at, expiresAt: token!.expires_at } };
    })();
  });
  route('POST', '/revoke', async (request, reply) => {
    limit(request, reply, 'revoke', 60, 1000);
    if (!config.writeGuard(request, reply)) return;
    if (request.body !== undefined && (typeof request.body !== 'object' || request.body === null || Object.keys(request.body).length)) throw new CliAuthError('VALIDATION_FAILED');
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 512) throw new CliAuthError('UNAUTHENTICATED', 401);
    const token = db.prepare('SELECT t.* FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>?) AND u.disabled_at IS NULL').get(digest(authorization.slice(7)), iso()) as Token | undefined;
    if (!token) throw new CliAuthError('UNAUTHENTICATED', 401);
    if (token.kind === 'pat') db.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').run(iso(), token.id);
    else if (token.kind === 'oauth_access' && token.grant_id && token.resource === `${origin}/mcp`) revokeOAuthGrant(db, token.grant_id, iso());
    else throw new CliAuthError('UNAUTHENTICATED', 401);
    return reply.code(204).send();
  });
}
