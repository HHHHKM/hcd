import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';

const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
type Row = { status: string; attempts: number; next_attempt_at: string; lease_token: string | null; last_error: string | null };
describe('transactional email outbox', () => {
  let db: HcdDatabase; let app: FastifyInstance; let owner: string; let clock: number;
  beforeEach(async () => { db = openDatabase(':memory:'); app = createApp({ db, seed: true }); await app.ready(); clock = Date.now(); owner = String((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } })).headers['set-cookie']).split(';')[0]!; db.prepare('DELETE FROM outbox').run(); });
  afterEach(async () => { await app.close(); db.close(); });
  function notification(id = 'nt_mailtest', userId = 'u_owner000000') { db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,\'mention\',?,?)').run(id, userId, 'd_aaaaaaab', '{"private":"must-not-appear"}', new Date(clock).toISOString()); return id; }
  const row = (id = 'nt_mailtest') => db.prepare('SELECT status,attempts,next_attempt_at,lease_token,last_error FROM outbox WHERE notification_id=?').get(id) as Row;
  it('AT-34 / AT-15 queues in the business transaction and renders localized, escaped messages without ' +
     'private payloads', async () => {
    expect(() => db.transaction(() => { notification('nt_rolledback'); throw new Error('rollback'); })()).toThrow(); expect(row('nt_rolledback')).toBeUndefined();
    notification(); db.prepare("UPDATE documents SET title='<script>title</script>' WHERE id='d_aaaaaaab'").run();
    const sent: NotificationMail[] = []; const worker = createOutboxWorker(db, { send: async (mail) => { sent.push(mail); } }, 'https://app.test', () => clock);
    expect(await worker.tick()).toBe(1); expect(await worker.tick()).toBe(0); expect(row()).toMatchObject({ status: 'sent', attempts: 1, lease_token: null });
    expect(sent[0]!.subject).toContain('有人提到了你'); expect(sent[0]!.html).toContain('&lt;script&gt;title&lt;/script&gt;'); expect(sent[0]!.html).not.toContain('<script>'); expect(sent[0]!.text).not.toContain('must-not-appear'); expect(sent[0]!.text).toContain('https://app.test/d/d_aaaaaaab');
    db.prepare("UPDATE users SET locale='en' WHERE id='u_owner000000'").run(); notification('nt_english'); await worker.tick(); expect(sent[1]!.subject).toContain('You were mentioned'); await worker.stop();
  });
  it('AT-34 persists exponential retry times and stops after six failures without storing SMTP ' +
     'secrets', async () => {
    notification(); const worker = createOutboxWorker(db, { send: async () => { throw new Error('password=do-not-store'); } }, 'https://app.test', () => clock);
    for (const [index, minutes] of [1, 5, 30, 120, 360, 0].entries()) {
      expect(await worker.tick()).toBe(0); expect(row()).toMatchObject({ status: index === 5 ? 'failed' : 'pending', attempts: index + 1, last_error: 'SMTP_DELIVERY_FAILED' });
      expect(Date.parse(row().next_attempt_at)).toBe(clock + minutes * 60000);
      expect(await worker.tick()).toBe(0); expect(row().attempts).toBe(index + 1); clock += minutes * 60000;
    }
    await worker.stop();
  });
  it('AT-34 leaves unconfigured mail untouched and cancels disabled, unauthorized or opted-out ' +
     'recipients', async () => {
    notification(); const inactive = createOutboxWorker(db, undefined, 'https://app.test', () => clock); expect(await inactive.tick()).toBe(0); expect(row().attempts).toBe(0);
    db.prepare("INSERT INTO notification_preferences VALUES('u_owner000000','mention',0)").run();
    let sent = 0; const worker = createOutboxWorker(db, { send: async () => { sent++; } }, 'https://app.test', () => clock);
    await worker.tick(); expect(row().status).toBe('cancelled');
    notification('nt_disabled', 'u_editor00000'); db.prepare("UPDATE users SET disabled_at='now' WHERE id='u_editor00000'").run();
    notification('nt_revoked', 'u_ops0000000'); db.prepare("DELETE FROM space_members WHERE user_id='u_ops0000000'").run(); db.prepare("DELETE FROM document_members WHERE user_id='u_ops0000000'").run();
    await worker.tick(); expect(row('nt_disabled').status).toBe('cancelled'); expect(row('nt_revoked').status).toBe('cancelled'); expect(sent).toBe(0); await worker.stop(); await inactive.stop();
  });
  it('AT-34 recovers expired leases and prevents stale workers from overwriting a newer claim', async () => {
    notification(); let complete: () => void = () => {}; let entered: () => void = () => {}; const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = createOutboxWorker(db, { send: () => { entered(); return new Promise<void>((resolve) => { complete = resolve; }); } }, 'https://app.test', () => clock);
    const firstRun = first.tick(); await started;
    const second = createOutboxWorker(db, { send: async () => {} }, 'https://app.test', () => clock);
    expect(await second.tick()).toBe(0); clock += 61000; expect(await second.tick()).toBe(1); expect(row().attempts).toBe(2);
    complete(); expect(await firstRun).toBe(0); expect(row().status).toBe('sent'); await first.stop(); await second.stop();
    notification('nt_exhausted'); db.prepare("UPDATE outbox SET status='processing',attempts=6,lease_until=?,lease_token='lost' WHERE notification_id='nt_exhausted'").run(new Date(clock - 1).toISOString());
    const recovering = createOutboxWorker(db, { send: async () => { throw new Error('should not send'); } }, 'https://app.test', () => clock); await recovering.tick(); expect(row('nt_exhausted').status).toBe('failed'); await recovering.stop();
  });
  it('AT-34 saves only the current user preferences, rejects unknown flags and disallows PAT ' +
     'changes', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/v1/me/notification-preferences', headers: headers(owner) }); expect(initial.statusCode).toBe(200); expect(initial.json()).toMatchObject({ emailConfigured: false, email: { mention: true, submission_pending: false } });
    const update = await app.inject({ method: 'PUT', url: '/api/v1/me/notification-preferences', headers: headers(owner), payload: { email: { mention: false } } }); expect(update.statusCode).toBe(200); expect(update.json().email.mention).toBe(false);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/me/notification-preferences', headers: headers(owner), payload: { email: { unsupported: true } } })).statusCode).toBe(400);
    const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { scopes: ['read'] } });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/me/notification-preferences', headers: { ...headers(owner), authorization: `Bearer ${token.json().token}` }, payload: { email: { mention: true } } })).statusCode).toBe(403);
  });
});
