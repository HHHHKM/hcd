import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { runMaintenance } from '../src/maintenance';
import { issueInvitation } from '../src/accounts';
import { enqueueSecurityMail } from '../src/security-mail';
const secret = 'maintenance-fixture-secret';
describe('credential maintenance', () => {
  let db: HcdDatabase; let app: FastifyInstance; let now: number;
  const iso = (value: number) => new Date(value).toISOString();
  beforeEach(async () => { db = openDatabase(':memory:'); app = createApp({ db, seed: true }); await app.ready(); now = Date.now(); });
  afterEach(async () => { await app.close(); db.close(); });
  function invite(user: string) { const value = issueInvitation(db, user, 'reset', 'test', { secretKey: secret, appUrl: 'https://app.test' }); const mailId = enqueueSecurityMail(db, secret, { kind: 'reset', refId: value.id, recipient: (db.prepare('SELECT email FROM users WHERE id=?').get(user) as { email: string }).email, locale: 'en', value: value.token, expiresAt: value.expiresAt }); return { ...value, mailId }; }
  it('removes expired sessions and attempts without touching content or active credentials', () => {
    for (const [id, expires] of [['expired', iso(now - 1)], ['active', iso(now + 86400000)]]) db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(id, 'u_editor00000', id, iso(now - 1000), expires);
    db.prepare('INSERT INTO login_attempts VALUES(?,?,?)').run('old@example.com', '127.0.0.1', iso(now - 86400001)); db.prepare('INSERT INTO login_attempts VALUES(?,?,?)').run('active@example.com', '127.0.0.1', iso(now));
    const active = invite('u_editor00000');
    const counts = () => ['users','documents','comments','assets'].map((table) => db.prepare(`SELECT count(*) n FROM ${table}`).get()); const before = counts();
    expect(runMaintenance(db, now)).toMatchObject({ sessions: 1, loginAttempts: 1, erasedSecrets: 0 }); expect(counts()).toEqual(before);
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'active' }]); expect(db.prepare('SELECT id FROM invites WHERE id=?').get(active.id)).toBeTruthy();
    expect(Object.values(runMaintenance(db, now)).every((value) => value === 0)).toBe(true);
  });
  it('erases consumed secrets but preserves in-flight leases and delivery audit records', () => {
    const pending = invite('u_editor00000'); const leased = invite('u_owner000000');
    db.prepare('UPDATE invites SET used_at=? WHERE id IN (?,?)').run(iso(now), pending.id, leased.id);
    db.prepare("UPDATE outbox SET status='processing',lease_token='worker-owns-this',lease_until=? WHERE security_mail_id=?").run(iso(now + 60000), leased.mailId);
    const result = runMaintenance(db, now); expect(result).toMatchObject({ erasedSecrets: 2, cancelledMail: 1, invites: 1 });
    expect(db.prepare('SELECT status,lease_token FROM outbox WHERE security_mail_id=?').get(leased.mailId)).toEqual({ status: 'processing', lease_token: 'worker-owns-this' });
    expect(db.prepare('SELECT id FROM invites WHERE id=?').get(leased.id)).toBeTruthy();
    expect(db.prepare('SELECT sealed FROM security_mail WHERE id IN (?,?)').all(pending.mailId, leased.mailId)).toEqual([{ sealed: null }, { sealed: null }]);
    expect(runMaintenance(db, now + 60001)).toMatchObject({ invites: 1, cancelledMail: 1 });
    expect(db.prepare('SELECT count(*) n FROM security_mail').get()).toEqual({ n: 2 }); expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('retains active lockouts and cooldowns while cleaning revoked guest credentials and expired identity caches', () => {
    db.prepare('INSERT INTO share_links(id,doc_id,token_hash,role,created_by,created_at,revoked_at) VALUES(?,?,?,?,?,?,?)').run('sl_old', 'd_aaaaaaab', 'hash', 'commenter', 'u_owner000000', iso(now), iso(now));
    db.prepare('INSERT INTO guests VALUES(?,?,?,?,?,?)').run('g_old', 'sl_old', 'guest@example.com', 'Guest', 'en', iso(now));
    db.prepare('INSERT INTO guest_sessions VALUES(?,?,?,?,?,?)').run('gs_old', 'g_old', 'sl_old', 'hash', iso(now + 86400000), iso(now));
    db.prepare('INSERT INTO guest_challenges VALUES(?,?,?,?,?,?,?,?,?)').run('gc_old', 'sl_old', 'guest@example.com', 'Guest', 'en', 'hashed-code', iso(now + 600000), null, iso(now));
    const mail = enqueueSecurityMail(db, secret, { kind: 'guest_code', refId: 'gc_old', recipient: 'guest@example.com', locale: 'en', value: '123456', expiresAt: iso(now + 600000) });
    for (const [id, window, lock, sent] of [['old', now - 7200000, 0, now - 120000], ['locked', now - 7200000, now + 3600000, 0], ['cooldown', now - 7200000, 0, now - 1000], ['window', now - 1000, 0, 0]] as const) db.prepare('INSERT INTO guest_verification_limits VALUES(?,?,?,?,?)').run(id, 4, window, lock, sent);
    db.prepare('INSERT INTO integration_users VALUES(?,?,?,?,?)').run('sp_demo000000', 1, 'old@example.com', 'ou_old', iso(now - 1));
    expect(runMaintenance(db, now)).toMatchObject({ guestSessions: 1, challenges: 1, erasedSecrets: 1, cancelledMail: 1, limits: 1, identityCache: 1 });
    expect(db.prepare('SELECT email_hash FROM guest_verification_limits ORDER BY email_hash').all()).toEqual([{ email_hash: 'cooldown' }, { email_hash: 'locked' }, { email_hash: 'window' }]);
    expect(db.prepare('SELECT status FROM outbox WHERE security_mail_id=?').get(mail)).toEqual({ status: 'cancelled' }); expect(db.prepare('SELECT 1 FROM guests WHERE id=?').get('g_old')).toBeTruthy();
  });
});
