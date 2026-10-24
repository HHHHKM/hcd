import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { buildDailyDigest, createDigestScheduler } from '../src/digests';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';
const now = Date.parse('2026-10-23T01:00:00.000Z');
describe('daily review summaries', () => {
  let db: HcdDatabase; let app: FastifyInstance;
  beforeEach(async () => { db = openDatabase(':memory:'); app = createApp({ db, seed: true }); await app.ready(); db.prepare('DELETE FROM outbox').run(); });
  afterEach(async () => { await app.close(); db.close(); });
  const digestFor = (user = 'u_owner000000') => (db.prepare('SELECT id FROM mail_digests WHERE user_id=? ORDER BY created_at DESC').get(user) as { id: string }).id;
  it('AT-34 queues once per local day at the configured hour across restarts and aggregates all ' +
     'eligible documents', async () => {
    const scheduler = createDigestScheduler(db, 'Asia/Taipei', 9);
    expect(scheduler.enqueue(now - 1000)).toBe(0);
    expect(scheduler.enqueue(now)).toBeGreaterThan(0);
    expect(scheduler.enqueue(now + 1000)).toBe(0); expect(createDigestScheduler(db, 'Asia/Taipei', 9).enqueue(now + 1000)).toBe(0);
    const id = digestFor(); const digest = buildDailyDigest(db, id, 'https://app.test', now)!;
    const counts = db.prepare("SELECT count(*) n FROM submissions WHERE status='pending'").get() as { n: number };
    expect(digest.text).toContain(String(counts.n)); expect(digest.subject).toContain('每日待审汇总'); expect(digest.text).toContain('https://app.test/d/d_aaaaaaab');
    const sent: NotificationMail[] = [];
    const worker = createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, 'https://app.test', () => now);
    await worker.tick(); expect(sent.filter((mail) => mail.to === 'd@example.com')).toHaveLength(1);
    expect(await worker.tick()).toBe(0); await worker.stop();
    expect(scheduler.enqueue(now + 86400000)).toBeGreaterThan(0);
    expect(db.prepare("SELECT count(*) n FROM mail_digests WHERE user_id='u_owner000000'").get()).toEqual({ n: 2 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('AT-34 rechecks current permissions, pending status, preferences and disabled accounts at ' +
     'delivery', async () => {
    const scheduler = createDigestScheduler(db, 'UTC', 0); scheduler.enqueue(now);
    const id = digestFor();
    db.prepare("INSERT INTO notification_preferences VALUES('u_owner000000','pending_summary',0)").run();
    expect(buildDailyDigest(db, id, 'https://app.test', now)).toBeNull();
    db.prepare("UPDATE notification_preferences SET email_enabled=1 WHERE user_id='u_owner000000'").run();
    db.prepare("UPDATE users SET disabled_at='disabled' WHERE id='u_owner000000'").run(); expect(buildDailyDigest(db, id, 'https://app.test', now)).toBeNull();
    db.prepare("UPDATE users SET disabled_at=NULL WHERE id='u_owner000000'").run();
    db.prepare("UPDATE document_members SET role='viewer' WHERE user_id='u_owner000000'").run(); db.prepare("UPDATE space_members SET role='viewer' WHERE user_id='u_owner000000'").run();
    expect(buildDailyDigest(db, id, 'https://app.test', now)).toBeNull();
    db.prepare("UPDATE space_members SET role='owner' WHERE user_id='u_owner000000'").run();
    expect(buildDailyDigest(db, id, 'https://app.test', now)).not.toBeNull();
    db.prepare("UPDATE submissions SET status='rejected'").run();
    const sent: NotificationMail[] = []; const worker = createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, 'https://app.test', () => now);
    await worker.tick(); expect(sent).toEqual([]); expect(db.prepare("SELECT count(*) n FROM outbox WHERE status='cancelled'").get()).toMatchObject({ n: 2 }); await worker.stop();
    expect(scheduler.enqueue(now + 86400000)).toBe(0);
  });
  it('AT-34 escapes titles, omits submission contents, localizes emails and expires stale ' +
     'summaries', () => {
    db.prepare("UPDATE users SET locale='en' WHERE id='u_owner000000'").run();
    db.prepare("UPDATE documents SET title='<img src=x onerror=alert(1)>' WHERE id='d_aaaaaaab'").run();
    db.prepare("UPDATE submissions SET message='PRIVATE SUBMISSION MESSAGE'").run();
    createDigestScheduler(db, 'UTC', 0).enqueue(now); const id = digestFor(); const mail = buildDailyDigest(db, id, 'https://app.test', now)!;
    expect(mail.subject).toBe('HCD · Daily review summary'); expect(mail.html).toContain('&lt;img'); expect(mail.html).not.toContain('<img'); expect(mail.text).not.toContain('PRIVATE SUBMISSION MESSAGE');
    expect(buildDailyDigest(db, id, 'https://app.test', now + 86400000)).toBeNull();
    expect(() => createDigestScheduler(db, 'not-a-time-zone')).toThrow(); expect(() => createDigestScheduler(db, 'UTC', 24)).toThrow();
  });
  it('AT-34 respects the daily preference before scheduling and handles daylight saving repetition ' +
     'with one date key', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'http://localhost:5173', 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const prefs = await app.inject({ method: 'PUT', url: '/api/v1/me/notification-preferences', headers: { cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' }, payload: { email: { pending_summary: false } } });
    expect(prefs.json().email.pending_summary).toBe(false);
    const scheduler = createDigestScheduler(db, 'America/New_York', 1);
    scheduler.enqueue(Date.parse('2026-11-01T05:30:00.000Z'));
    expect(db.prepare("SELECT 1 FROM mail_digests WHERE user_id='u_owner000000'").get()).toBeUndefined();
    expect(scheduler.enqueue(Date.parse('2026-11-01T06:30:00.000Z'))).toBe(0);
    db.prepare("UPDATE notification_preferences SET email_enabled=1 WHERE user_id='u_owner000000'").run();
    expect(scheduler.enqueue(Date.parse('2026-11-01T06:31:00.000Z'))).toBe(1);
  });
});
