import { buildDailyDigest } from './digests';
import { randomBytes, createHash } from 'node:crypto';
import { buildSecurityMail } from './security-mail';
import nodemailer from 'nodemailer';
import type { HcdDatabase } from './db';

export const mailEvents = ['mention', 'reply', 'submission_published', 'submission_rejected', 'submission_pending', 'ai_task_requested', 'ai_task_done', 'ai_task_failed', 'ai_task_rejected', 'anchor_lost', 'pending_summary'] as const;
export type MailEvent = typeof mailEvents[number];
export const defaultPreferences: Record<MailEvent, boolean> = { mention: true, reply: true, submission_published: true, submission_rejected: true, submission_pending: false, ai_task_requested: true, ai_task_done: false, ai_task_failed: true, ai_task_rejected: true, anchor_lost: true, pending_summary: true };
export type NotificationMail = { to: string; subject: string; text: string; html: string; messageId: string };
export type MailDelivery = { send: (mail: NotificationMail) => Promise<void>; close?: () => void };
const retryMinutes = [1, 5, 30, 120, 360];
const titles: Record<MailEvent, [string, string]> = {
  pending_summary: ['每日待审汇总', 'Daily review summary'], mention: ['有人提到了你', 'You were mentioned'], reply: ['讨论有新回复', 'New discussion reply'], submission_published: ['修改已发布', 'Changes published'], submission_rejected: ['修改被退回', 'Changes returned'], submission_pending: ['有修改等待审核', 'Changes need review'], ai_task_requested: ['AI 任务等待批准', 'AI task needs approval'], ai_task_done: ['AI 任务已完成', 'AI task complete'], ai_task_failed: ['AI 任务失败', 'AI task failed'], ai_task_rejected: ['AI 任务被退回', 'AI task declined'], anchor_lost: ['评论需要重新定位', 'Comment needs a new location'],
};
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function notificationPreferences(db: HcdDatabase, userId: string) {
  const result = { ...defaultPreferences };
  for (const row of db.prepare('SELECT event,email_enabled FROM notification_preferences WHERE user_id=?').all(userId) as Array<{ event: MailEvent; email_enabled: number }>) if (row.event in result) result[row.event] = Boolean(row.email_enabled);
  return result;
}
function buildMail(db: HcdDatabase, notificationId: string, appUrl: string): NotificationMail | null {
  const row = db.prepare(`SELECT n.id,n.user_id,n.doc_id,n.kind,n.payload,u.email,u.name,u.locale,u.is_admin,u.disabled_at,d.title
    FROM notifications n JOIN users u ON u.id=n.user_id JOIN documents d ON d.id=n.doc_id WHERE n.id=?`).get(notificationId) as { id: string; user_id: string; doc_id: string; kind: MailEvent; payload: string; email: string; name: string; locale: string; is_admin: number; disabled_at: string | null; title: string } | undefined;
  if (!row || row.disabled_at || !mailEvents.includes(row.kind) || !notificationPreferences(db, row.user_id)[row.kind]) return null;
  if (!row.is_admin && !db.prepare(`SELECT 1 FROM document_members WHERE doc_id=? AND user_id=? UNION SELECT 1 FROM space_members sm JOIN documents d ON d.space_id=sm.space_id WHERE d.id=? AND sm.user_id=? LIMIT 1`).get(row.doc_id, row.user_id, row.doc_id, row.user_id)) return null;
  const zh = row.locale === 'zh-CN'; const subject = `HCD · ${titles[row.kind][zh ? 0 : 1]}`; const url = new URL(`/d/${encodeURIComponent(row.doc_id)}`, appUrl).href;
  const title = row.title.replace(/[\r\n\t]/g, ' ').slice(0, 200);
  const lines = [`${row.name},`, '', subject, title, '', url, '', zh ? '可在 HCD 设置中调整邮件通知。' : 'Manage email notifications in HCD settings.'];
  return { to: row.email, subject, text: lines.join('\n'), html: `<p>${escape(row.name)},</p><h2>${escape(subject)}</h2><p>${escape(title)}</p><p><a href="${escape(url)}">${zh ? '打开文档' : 'Open document'}</a></p><p>${zh ? '可在 HCD 设置中调整邮件通知。' : 'Manage email notifications in HCD settings.'}</p>`, messageId: `<hcd-${createHash('sha256').update(row.id).digest('hex')}@${new URL(appUrl).hostname}>` };
}

/** Atomic leases; SMTP delivery is at-least-once when a process crashes after sending. */
export function createOutboxWorker(db: HcdDatabase, delivery: MailDelivery | undefined, appUrl: string, now: () => number = Date.now, secretKey?: string) {
  let running: Promise<number> | null = null; let stopping = false;
  const iso = (value: number) => new Date(value).toISOString();
  const processBatch = async () => {
    if (!delivery || stopping) return 0;
    db.prepare("UPDATE security_mail SET sealed=NULL WHERE sealed IS NOT NULL AND (expires_at<=? OR id IN (SELECT security_mail_id FROM outbox WHERE status IN ('sent','failed','cancelled')))").run(iso(now()));
    let sent = 0;
    for (let index = 0; index < 25 && !stopping; index++) {
      const lease = randomBytes(16).toString('hex'); const timestamp = iso(now());
      const claimed = db.transaction(() => {
        db.prepare("UPDATE outbox SET status='failed',last_error='DELIVERY_UNCERTAIN',lease_token=NULL,lease_until=NULL WHERE status='processing' AND lease_until<=? AND attempts>=6").run(timestamp);
        const row = db.prepare("SELECT id,notification_id,security_mail_id,digest_id,attempts FROM outbox WHERE attempts<6 AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?)) ORDER BY CASE WHEN security_mail_id IS NOT NULL THEN 0 ELSE 1 END,created_at,id LIMIT 1").get(timestamp, timestamp) as { id: string; notification_id: string | null; security_mail_id: string | null; digest_id: string | null; attempts: number } | undefined;
        if (!row) return null;
        db.prepare("UPDATE outbox SET status='processing',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?").run(lease, iso(now() + 60000), row.id);
        return { ...row, attempts: row.attempts + 1 };
      })();
      if (!claimed) break;
      try {
        const mail = claimed.digest_id ? buildDailyDigest(db, claimed.digest_id, appUrl, now()) : claimed.security_mail_id ? buildSecurityMail(db, claimed.security_mail_id, secretKey, appUrl, now()) : claimed.notification_id ? buildMail(db, claimed.notification_id, appUrl) : null;
        if (!mail) {
          db.transaction(() => {
            const changed = db.prepare("UPDATE outbox SET status='cancelled',lease_token=NULL,lease_until=NULL,last_error='RECIPIENT_INELIGIBLE' WHERE id=? AND status='processing' AND lease_token=?").run(claimed.id, lease);
            if (changed.changes && claimed.security_mail_id) db.prepare('UPDATE security_mail SET sealed=NULL WHERE id=?').run(claimed.security_mail_id);
          })();
          continue;
        }
        const heartbeat = setInterval(() => { try { db.prepare("UPDATE outbox SET lease_until=? WHERE id=? AND status='processing' AND lease_token=?").run(iso(now() + 60000), claimed.id, lease); } catch { /* Final state writes still require the lease token; expired leases are recoverable. */ } }, 20000);
        heartbeat.unref();
        try { await delivery.send(mail); } finally { clearInterval(heartbeat); }
        const changed = db.transaction(() => {
          const result = db.prepare("UPDATE outbox SET status='sent',sent_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=? AND status='processing' AND lease_token=?").run(iso(now()), claimed.id, lease);
          if (result.changes && claimed.security_mail_id) db.prepare('UPDATE security_mail SET sealed=NULL WHERE id=?').run(claimed.security_mail_id);
          return result.changes;
        })();
        if (changed) sent++;
      } catch {
        const terminal = claimed.attempts >= 6;
        db.transaction(() => {
          const changed = db.prepare('UPDATE outbox SET status=?,next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status=\'processing\' AND lease_token=?').run(terminal ? 'failed' : 'pending', iso(now() + (retryMinutes[claimed.attempts - 1] ?? 0) * 60000), 'SMTP_DELIVERY_FAILED', claimed.id, lease);
          if (changed.changes && terminal && claimed.security_mail_id) db.prepare('UPDATE security_mail SET sealed=NULL WHERE id=?').run(claimed.security_mail_id);
        })();
      }
    }
    return sent;
  };
  return {
    tick() { if (!running) running = processBatch().finally(() => { running = null; }); return running; },
    async stop() { stopping = true; if (running) await running; delivery?.close?.(); },
  };
}

export function configuredMailDelivery(env: NodeJS.ProcessEnv = process.env): MailDelivery | undefined {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return undefined;
  const port = Number(env.SMTP_PORT ?? 587); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP_PORT');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === 'true' || port === 465, requireTLS: env.SMTP_REQUIRE_TLS !== 'false', ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}), connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, disableFileAccess: true, disableUrlAccess: true });
  return { async send(mail) { await transport.sendMail({ ...mail, from: env.SMTP_FROM }); }, close: () => transport.close() };
}
