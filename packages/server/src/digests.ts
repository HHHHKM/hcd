import { createHash, randomBytes } from 'node:crypto';
import type { HcdDatabase } from './db';
import type { NotificationMail } from './outbox';

type Recipient = { id: string; email: string; name: string; locale: string; is_admin: number };
type Review = { id: string; title: string; pending: number };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const eligibleSql = `SELECT u.id,u.email,u.name,u.locale,u.is_admin FROM users u WHERE u.disabled_at IS NULL AND u.password_hash<>'pending-invite'
  AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.user_id=u.id AND p.event='pending_summary' AND p.email_enabled=0)`;
function reviews(db: HcdDatabase, user: Recipient): Review[] {
  return db.prepare(`SELECT d.id,d.title,count(s.id) pending FROM documents d JOIN submissions s ON s.doc_id=d.id AND s.status='pending'
    WHERE ?=1 OR EXISTS(SELECT 1 FROM document_members m WHERE m.doc_id=d.id AND m.user_id=? AND m.role='owner')
    OR EXISTS(SELECT 1 FROM space_members m WHERE m.space_id=d.space_id AND m.user_id=? AND m.role='owner')
    GROUP BY d.id ORDER BY d.title,d.id`).all(user.is_admin, user.id, user.id) as Review[];
}
/** A persisted user/day key prevents duplicate daily digests across restarts. */
export function createDigestScheduler(db: HcdDatabase, timeZone = 'UTC', hour = 9) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Invalid MAIL_DIGEST_HOUR');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  return {
    enqueue(now = Date.now()) {
      const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
      if (Number(parts.hour) < hour) return 0;
      const dateKey = `${parts.year}-${parts.month}-${parts.day}`; const timestamp = new Date(now).toISOString();
      return db.transaction(() => {
        let count = 0;
        for (const user of db.prepare(eligibleSql).all() as Recipient[]) {
          if (db.prepare('SELECT 1 FROM mail_digests WHERE user_id=? AND date_key=?').get(user.id, dateKey) || !reviews(db, user).length) continue;
          const id = `dg_${randomBytes(16).toString('hex')}`;
          db.prepare('INSERT INTO mail_digests(id,user_id,date_key,created_at) VALUES(?,?,?,?)').run(id, user.id, dateKey, timestamp);
          db.prepare('INSERT INTO outbox(id,digest_id,dedupe_key,next_attempt_at,created_at) VALUES(?,?,?,?,?)').run(`mail_${id}`, id, `digest:${user.id}:${dateKey}`, timestamp, timestamp);
          count++;
        }
        return count;
      })();
    },
  };
}
export function buildDailyDigest(db: HcdDatabase, id: string, appUrl: string, now: number): NotificationMail | null {
  const digest = db.prepare('SELECT user_id,created_at FROM mail_digests WHERE id=?').get(id) as { user_id: string; created_at: string } | undefined;
  if (!digest || Date.parse(digest.created_at) + 86400000 <= now) return null;
  const user = db.prepare(`${eligibleSql} AND u.id=?`).get(digest.user_id) as Recipient | undefined;
  if (!user) return null;
  const pending = reviews(db, user); if (!pending.length) return null;
  const zh = user.locale === 'zh-CN'; const total = pending.reduce((sum, review) => sum + review.pending, 0);
  const subject = `HCD · ${zh ? '每日待审汇总' : 'Daily review summary'}`;
  const intro = zh ? `当前有 ${total} 项提交等待你审核，分布在 ${pending.length} 篇文档中。` : `${total} submissions across ${pending.length} documents currently await your review.`;
  const entries = pending.slice(0, 50).map((review) => ({ title: review.title.replace(/[\r\n\t]/g, ' ').slice(0, 200), count: review.pending, url: new URL(`/d/${encodeURIComponent(review.id)}`, appUrl).href }));
  const extra = pending.length > 50 ? zh ? '更多待审文档请到 HCD 工作台查看。' : 'Open the HCD workspace for the remaining documents.' : '';
  const footer = zh ? '可在通知偏好中关闭每日汇总。' : 'Disable daily summaries in notification preferences.';
  return { to: user.email, subject, text: [user.name, subject, intro, ...entries.map((entry) => `${entry.title} (${entry.count})\n${entry.url}`), extra, footer].filter(Boolean).join('\n\n'), html: `<p>${escape(user.name)}</p><h2>${escape(subject)}</h2><p>${escape(intro)}</p><ul>${entries.map((entry) => `<li><a href="${escape(entry.url)}">${escape(entry.title)}</a> (${entry.count})</li>`).join('')}</ul>${extra ? `<p>${escape(extra)}</p>` : ''}<p>${escape(footer)}</p>`, messageId: `<hcd-${createHash('sha256').update(id).digest('hex')}@${new URL(appUrl).hostname}>` };
}
