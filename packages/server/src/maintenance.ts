import { expireAiTasks } from './ai-tasks';
import { expireCliAuth } from './cli-auth';
import type { HcdDatabase } from './db';
/** Expiry cleanup leaves documents, comments, assets and delivery audit metadata intact. */
export function runMaintenance(db: HcdDatabase, now = Date.now()) {
  const timestamp = new Date(now).toISOString(); const dayAgo = new Date(now - 86400000).toISOString();
  return db.transaction(() => {
    expireAiTasks(db, now);
    const expiredMail = db.prepare(`SELECT m.id FROM security_mail m WHERE m.expires_at<=? OR m.sealed IS NULL
      OR (m.kind IN ('invite','reset') AND NOT EXISTS(SELECT 1 FROM invites i JOIN users u ON u.id=i.user_id WHERE i.id=m.ref_id AND i.used_at IS NULL AND i.expires_at>? AND u.disabled_at IS NULL AND u.email=m.recipient))
      OR (m.kind='guest_code' AND NOT EXISTS(SELECT 1 FROM guest_challenges c JOIN share_links l ON l.id=c.link_id WHERE c.id=m.ref_id AND c.used_at IS NULL AND c.expires_at>? AND l.revoked_at IS NULL AND l.role='commenter' AND (l.expires_at IS NULL OR l.expires_at>?) AND c.email=m.recipient))`).all(timestamp, timestamp, timestamp, timestamp) as Array<{ id: string }>;
    let cancelledMail = 0; let erasedSecrets = 0;
    for (const mail of expiredMail) {
      cancelledMail += db.prepare("UPDATE outbox SET status='cancelled',last_error='CREDENTIAL_EXPIRED',lease_token=NULL,lease_until=NULL WHERE security_mail_id=? AND (status='pending' OR (status='processing' AND lease_until<=?))").run(mail.id, timestamp).changes;
      erasedSecrets += db.prepare('UPDATE security_mail SET sealed=NULL WHERE id=? AND sealed IS NOT NULL').run(mail.id).changes;
    }
    const sessions = db.prepare('DELETE FROM sessions WHERE expires_at<=? OR user_id IN (SELECT id FROM users WHERE disabled_at IS NOT NULL)').run(timestamp).changes;
    const guestSessions = db.prepare("DELETE FROM guest_sessions WHERE expires_at<=? OR link_id IN (SELECT id FROM share_links WHERE revoked_at IS NOT NULL OR role<>'commenter' OR expires_at<=?)").run(timestamp, timestamp).changes;
    const invites = db.prepare('DELETE FROM invites WHERE (used_at IS NOT NULL OR expires_at<=?) AND NOT EXISTS(SELECT 1 FROM security_mail m JOIN outbox o ON o.security_mail_id=m.id WHERE m.ref_id=invites.id AND o.status=\'processing\' AND o.lease_until>?)').run(timestamp, timestamp).changes;
    const challenges = db.prepare("DELETE FROM guest_challenges WHERE (used_at IS NOT NULL OR expires_at<=? OR link_id IN (SELECT id FROM share_links WHERE revoked_at IS NOT NULL OR expires_at<=?)) AND NOT EXISTS(SELECT 1 FROM security_mail m JOIN outbox o ON o.security_mail_id=m.id WHERE m.ref_id=guest_challenges.id AND o.status='processing' AND o.lease_until>?)").run(timestamp, timestamp, timestamp).changes;
    const limits = db.prepare('DELETE FROM guest_verification_limits WHERE locked_until<=? AND window_start+3600000<=? AND last_sent+60000<=?').run(now, now, now).changes;
    const loginAttempts = db.prepare('DELETE FROM login_attempts WHERE attempted_at<?').run(dayAgo).changes;
    const identityCache = db.prepare('DELETE FROM integration_users WHERE expires_at<=?').run(timestamp).changes;
    db.prepare('DELETE FROM oauth_requests WHERE expires_at<=?').run(timestamp);
    db.prepare('DELETE FROM oauth_codes WHERE expires_at<=? AND grant_id IN (SELECT id FROM oauth_grants WHERE expires_at<=? OR revoked_at IS NOT NULL)').run(timestamp, timestamp);
    db.prepare("DELETE FROM oauth_clients WHERE source='metadata' AND expires_at<=?").run(timestamp);
    const cliAuth = expireCliAuth(db, now);
    return { sessions, guestSessions, invites, challenges, limits, loginAttempts, cancelledMail, erasedSecrets, identityCache, cliAuth };
  })();
}
