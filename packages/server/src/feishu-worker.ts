import { randomBytes } from 'node:crypto';
import type { HcdDatabase } from './db';
import { createFeishuTransport, createIntegrationStore, integrationCard, IntegrationError, type IntegrationKind } from './feishu';
type Job = { id: string; space_id: string; kind: IntegrationKind; config_revision: number; doc_id: string; event: string; source_id: string; notification_id: string | null; user_id: string | null; attempts: number };
const delays = [1, 5, 30, 120, 360];
export function createFeishuWorker(db: HcdDatabase, store: ReturnType<typeof createIntegrationStore>, transport: ReturnType<typeof createFeishuTransport>, appUrl: string, now: () => number = Date.now) {
  let running: Promise<number> | null = null; let stopping = false;
  const iso = (value = now()) => new Date(value).toISOString();
  function prepare(job: Job) {
    const integration = store.get(job.space_id, job.kind);
    if (!integration?.enabled || integration.revision !== job.config_revision) return null;
    const doc = db.prepare('SELECT title,space_id FROM documents WHERE id=?').get(job.doc_id) as { title: string; space_id: string } | undefined;
    if (!doc || doc.space_id !== job.space_id) return null;
    let email: string | undefined; let locale: string | undefined; let sourceId = job.source_id;
    if (job.user_id) {
      const user = db.prepare('SELECT email,locale,is_admin FROM users WHERE id=? AND disabled_at IS NULL').get(job.user_id) as { email: string; locale: string; is_admin: number } | undefined;
      if (!user || (!user.is_admin && !db.prepare('SELECT 1 FROM document_members WHERE doc_id=? AND user_id=? UNION SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').get(job.doc_id, job.user_id, doc.space_id, job.user_id))) return null;
      email = user.email; locale = user.locale;
      const notification = db.prepare('SELECT payload FROM notifications WHERE id=? AND user_id=? AND doc_id=?').get(job.notification_id, job.user_id, job.doc_id) as { payload: string } | undefined;
      if (!notification) return null;
      const payload = JSON.parse(notification.payload) as Record<string, unknown>;
      if (job.event === 'submission_pending') sourceId = String(payload.submissionId ?? '');
      if (job.event === 'submission_published') sourceId = String(payload.version ?? '');
    }
    let summary: string | undefined;
    if (job.event === 'mention') {
      const comment = db.prepare('SELECT body FROM comments WHERE id=? AND doc_id=? AND deleted_at IS NULL').get(sourceId, job.doc_id) as { body: string } | undefined;
      if (!comment) return null; summary = comment.body.replace(/@\[([^\]\n]+)\]\([^)]+\)/g, '@$1').slice(0, 200);
    } else if (job.event === 'ai_task_requested') {
      if (!db.prepare("SELECT 1 FROM ai_tasks WHERE id=? AND doc_id=? AND status='requested'").get(sourceId, job.doc_id)) return null;
    } else if (job.event === 'submission_pending') {
      if (!db.prepare("SELECT 1 FROM submissions WHERE id=? AND doc_id=? AND status='pending'").get(sourceId, job.doc_id)) return null;
    } else if (job.event === 'submission_published') {
      if (!db.prepare('SELECT 1 FROM versions WHERE doc_id=? AND version=?').get(job.doc_id, Number(sourceId))) return null;
    } else return null;
    const config = store.read(integration);
    const card = integrationCard(job.event, doc.title, new URL(`/d/${encodeURIComponent(job.doc_id)}`, appUrl).href, locale ?? config.locale, summary);
    return { integration, config, card, email };
  }
  const process = async () => {
    let sent = 0;
    for (let index = 0; index < 25 && !stopping; index++) {
      const lease = randomBytes(16).toString('hex');
      const job = db.transaction(() => {
        db.prepare("UPDATE feishu_outbox SET status='failed',last_error='DELIVERY_UNCERTAIN',lease_token=NULL,lease_until=NULL WHERE status='processing' AND lease_until<=? AND attempts>=6").run(iso());
        const row = db.prepare("SELECT * FROM feishu_outbox WHERE attempts<6 AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1").get(iso(), iso()) as Job | undefined;
        if (!row) return undefined;
        db.prepare("UPDATE feishu_outbox SET status='processing',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?").run(lease, iso(now() + 60000), row.id);
        return { ...row, attempts: row.attempts + 1 };
      })();
      if (!job) break;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        const value = prepare(job);
        if (!value) { db.prepare("UPDATE feishu_outbox SET status='cancelled',last_error='INELIGIBLE',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(job.id, lease); continue; }
        heartbeat = setInterval(() => { try { db.prepare("UPDATE feishu_outbox SET lease_until=? WHERE id=? AND status='processing' AND lease_token=?").run(iso(now() + 60000), job.id, lease); } catch { /* Ownership is checked again at finalization. */ } }, 20000); heartbeat.unref();
        await transport.send(db, value.integration, value.config, value.card, job.id, value.email, () => {
          if (!db.prepare("SELECT 1 FROM feishu_outbox WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?").get(job.id, lease, iso())) return false;
          const current = prepare(job);
          return Boolean(current && current.email === value.email);
        });
        const changed = db.prepare("UPDATE feishu_outbox SET status='sent',sent_at=?,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND status='processing' AND lease_token=?").run(iso(), job.id, lease);
        sent += changed.changes;
      } catch (error) {
        const terminal = job.attempts >= 6; const code = error instanceof IntegrationError ? error.code : 'INTEGRATION_DELIVERY_FAILED';
        db.prepare("UPDATE feishu_outbox SET status=?,next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='processing' AND lease_token=?").run(code === 'INTEGRATION_INELIGIBLE' ? 'cancelled' : terminal ? 'failed' : 'pending', iso(now() + (delays[job.attempts - 1] ?? 0) * 60000), code, job.id, lease);
      } finally { if (heartbeat) clearInterval(heartbeat); }
    }
    return sent;
  };
  return { tick() { if (!running) running = process().finally(() => { running = null; }); return running; }, async stop() { stopping = true; if (running) await running; } };
}
