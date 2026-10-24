import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HcdDatabase } from './db';
import { enqueueSecurityMail } from './security-mail';
import { createRateLimiter } from './rate-limit';
import { requestActors } from './internal-request';

type ShareLink = { id: string; doc_id: string; role: 'viewer' | 'commenter'; show_comments: number; version_pin: number | null };
type GuestSession = { id: string; guest_id: string; link_id: string; name: string };
type Challenge = { id: string; link_id: string; email: string; name: string; locale: string; code_hash: string; expires_at: string; used_at: string | null };
type Limit = { failures: number; window_start: number; locked_until: number; last_sent: number };
const iso = (now = Date.now()) => new Date(now).toISOString();
export function createGuestAccess(db: HcdDatabase, secret: string) {
  const digest = (purpose: string, value: string) => createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
  const session = (request: FastifyRequest, linkId: string) => {
    const token = request.cookies.hcd_guest;
    if (!token || token.length > 128) return undefined;
    return db.prepare('SELECT s.id,s.guest_id,s.link_id,g.name FROM guest_sessions s JOIN guests g ON g.id=s.guest_id AND g.link_id=s.link_id WHERE s.token_hash=? AND s.link_id=? AND s.expires_at>?').get(digest('guest-session', token), linkId, iso()) as GuestSession | undefined;
  };
  return { digest, session };
}
export function registerGuestVerification(app: FastifyInstance, options: {
  db: HcdDatabase; secret: string; appUrl: string; mailEnabled: boolean;
  access: ReturnType<typeof createGuestAccess>; link: (token: string) => ShareLink | undefined;
  writeGuard: (request: FastifyRequest, reply: FastifyReply) => boolean;
}) {
  const { db, access } = options; const rate = createRateLimiter();
  const fail = (reply: FastifyReply, code: string, status = 400) => reply.code(status).send({ error: { code } });
  app.addHook('preHandler', async (request, reply) => {
    if (!request.routeOptions.url?.startsWith('/api/v1/s/:token/')) return;
    const token = (request.params as { token: string }).token;
    const link = options.link(token); if (!link) return fail(reply, 'INVITE_INVALID', 404);
    if (request.routeOptions.url.endsWith('/verify/start') || request.routeOptions.url.endsWith('/verify/finish')) return;
    if (link.role === 'commenter' && !access.session(request, link.id)) return fail(reply, 'GUEST_VERIFICATION_REQUIRED', 401);
  });
  app.post('/api/v1/s/:token/verify/start', async (request, reply) => {
    if (!options.writeGuard(request, reply)) return;
    const link = options.link((request.params as { token: string }).token)!;
    if (link.role !== 'commenter') return fail(reply, 'FORBIDDEN', 403);
    if (!options.mailEnabled) return fail(reply, 'SMTP_NOT_CONFIGURED', 503);
    const body = request.body as Record<string, unknown> | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) return fail(reply, 'VALIDATION_FAILED');
    const now = Date.now(); const retry = rate(`verify-start:${request.ip}`, 10, now);
    if (retry) return reply.header('Retry-After', String(retry)).code(429).send({ error: { code: 'RATE_LIMITED' } });
    const result = db.transaction(() => {
      const emailHash = access.digest('guest-email', email);
      let limit = db.prepare('SELECT * FROM guest_verification_limits WHERE email_hash=?').get(emailHash) as Limit | undefined;
      if (limit && limit.locked_until > now) return { code: 'GUEST_LOCKED', wait: Math.ceil((limit.locked_until - now) / 1000) };
      if (limit && limit.last_sent + 60000 > now) return { code: 'RATE_LIMITED', wait: Math.ceil((limit.last_sent + 60000 - now) / 1000) };
      if (!limit) { db.prepare('INSERT INTO guest_verification_limits(email_hash,window_start) VALUES(?,?)').run(emailHash, now); limit = { failures: 0, window_start: now, locked_until: 0, last_sent: 0 }; }
      if (limit.window_start + 3600000 <= now) db.prepare('UPDATE guest_verification_limits SET failures=0,window_start=?,locked_until=0 WHERE email_hash=?').run(now, emailHash);
      db.prepare('UPDATE guest_verification_limits SET last_sent=? WHERE email_hash=?').run(now, emailHash);
      db.prepare('UPDATE guest_challenges SET used_at=? WHERE link_id=? AND email=? AND used_at IS NULL').run(iso(now), link.id, email);
      const id = `gc_${randomBytes(16).toString('hex')}`; const code = String(randomInt(1000000)).padStart(6, '0'); const expiresAt = iso(now + 600000); const locale = body?.locale === 'en' ? 'en' : 'zh-CN';
      db.prepare('INSERT INTO guest_challenges(id,link_id,email,name,locale,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, link.id, email, name, locale, access.digest('guest-code', `${id}:${code}`), expiresAt, iso(now));
      enqueueSecurityMail(db, options.secret, { kind: 'guest_code', refId: id, recipient: email, locale, value: code, expiresAt });
      return { challengeId: id, expiresAt };
    })();
    if ('code' in result) return reply.header('Retry-After', String(result.wait)).code(429).send({ error: { code: result.code } });
    return reply.code(202).send(result);
  });
  app.post('/api/v1/s/:token/verify/finish', async (request, reply) => {
    if (!options.writeGuard(request, reply)) return;
    const { token } = request.params as { token: string }; const link = options.link(token)!;
    if (link.role !== 'commenter') return fail(reply, 'FORBIDDEN', 403);
    const body = request.body as Record<string, unknown> | null;
    if (typeof body?.challengeId !== 'string' || body.challengeId.length > 128 || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return fail(reply, 'VALIDATION_FAILED');
    const challengeId = body.challengeId; const code = body.code; const now = Date.now();
    const result = db.transaction(() => {
      const challenge = db.prepare('SELECT * FROM guest_challenges WHERE id=? AND link_id=?').get(challengeId, link.id) as Challenge | undefined;
      if (!challenge || challenge.used_at || challenge.expires_at <= iso(now)) return { error: 'GUEST_CODE_INVALID' };
      const emailHash = access.digest('guest-email', challenge.email);
      const limit = db.prepare('SELECT * FROM guest_verification_limits WHERE email_hash=?').get(emailHash) as Limit;
      if (limit.locked_until > now) return { error: 'GUEST_LOCKED' };
      const actual = Buffer.from(access.digest('guest-code', `${challengeId}:${code}`)); const expected = Buffer.from(challenge.code_hash);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        const failures = limit.failures + 1;
        db.prepare('UPDATE guest_verification_limits SET failures=?,locked_until=? WHERE email_hash=?').run(failures, failures >= 5 ? now + 3600000 : 0, emailHash);
        if (failures >= 5) db.prepare('UPDATE guest_challenges SET used_at=? WHERE email=? AND used_at IS NULL').run(iso(now), challenge.email);
        return { error: failures >= 5 ? 'GUEST_LOCKED' : 'GUEST_CODE_INVALID' };
      }
      db.prepare('UPDATE guest_challenges SET used_at=? WHERE id=?').run(iso(now), challengeId);
      // Keep failure counters across challenges. A successful solve must not erase abuse history.
      let guest = db.prepare('SELECT id,name FROM guests WHERE link_id=? AND email=?').get(link.id, challenge.email) as { id: string; name: string } | undefined;
      if (!guest) { guest = { id: `g_${randomBytes(12).toString('hex')}`, name: challenge.name }; db.prepare('INSERT INTO guests(id,link_id,email,name,locale,created_at) VALUES(?,?,?,?,?,?)').run(guest.id, link.id, challenge.email, challenge.name, challenge.locale, iso(now)); }
      else { db.prepare('UPDATE guests SET name=?,locale=? WHERE id=?').run(challenge.name, challenge.locale, guest.id); guest.name = challenge.name; }
      const sessionToken = randomBytes(32).toString('base64url'); const expiresAt = iso(now + 7 * 86400000);
      db.prepare('INSERT INTO guest_sessions(id,guest_id,link_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(`gs_${randomBytes(16).toString('hex')}`, guest.id, link.id, access.digest('guest-session', sessionToken), expiresAt, iso(now));
      return { guest, sessionToken };
    })();
    if ('error' in result) return fail(reply, result.error!, result.error === 'GUEST_LOCKED' ? 429 : 400);
    requestActors.set(request, result.guest!.id);
    for (const path of [`/s/${encodeURIComponent(token)}`, `/api/v1/s/${encodeURIComponent(token)}`]) reply.setCookie('hcd_guest', result.sessionToken!, { path, httpOnly: true, sameSite: 'lax', secure: new URL(options.appUrl).protocol === 'https:', maxAge: 7 * 86400 });
    return { guest: result.guest };
  });
}
