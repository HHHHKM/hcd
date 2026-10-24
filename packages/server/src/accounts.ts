import { createHash, randomBytes } from 'node:crypto';
import type { HcdDatabase } from './db';

export const pendingPasswordHash = 'pending-invite';

export function issueInvitation(
  db: HcdDatabase,
  userId: string,
  kind: 'invite' | 'reset',
  createdBy: string,
  options: { secretKey: string; appUrl: string; lifetimeMs?: number },
) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (options.lifetimeMs ?? (kind === 'invite' ? 7 * 86400000 : 86400000))).toISOString();
  const tokenHash = createHash('sha256').update(`${options.secretKey}:${token}`).digest('hex');
  const id = `iv_${randomBytes(12).toString('hex')}`;
  db.transaction(() => {
    db.prepare('UPDATE invites SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL').run(now, userId, kind);
    db.prepare('INSERT INTO invites(id,kind,user_id,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, kind, userId, tokenHash, expiresAt, createdBy, now);
  })();
  const path = kind === 'invite' ? '/invite/' : '/reset/';
  return { id, token, expiresAt, url: `${options.appUrl.replace(/\/$/, '')}${path}${token}` };
}
