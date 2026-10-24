import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { HcdDatabase } from './db';
import type { NotificationMail } from './outbox';

type SecurityMail = { id: string; kind: 'invite' | 'reset' | 'guest_code'; ref_id: string; recipient: string; locale: string; sealed: string | null; expires_at: string };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const binding = (mail: Pick<SecurityMail, 'id' | 'kind' | 'ref_id' | 'recipient'>) => Buffer.from(JSON.stringify([1, mail.id, mail.kind, mail.ref_id, mail.recipient]));
const key = (secret: string) => Buffer.from(hkdfSync('sha256', secret, '', 'hcd-security-mail-v1', 32));
export function enqueueSecurityMail(db: HcdDatabase, secret: string, input: { kind: SecurityMail['kind']; refId: string; recipient: string; locale: string; value: string; expiresAt: string }) {
  const id = `sm_${randomBytes(16).toString('hex')}`; const now = new Date().toISOString();
  const mail = { id, kind: input.kind, ref_id: input.refId, recipient: input.recipient };
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), nonce); cipher.setAAD(binding(mail));
  const encrypted = Buffer.concat([cipher.update(input.value, 'utf8'), cipher.final()]);
  const sealed = [1, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  db.transaction(() => {
    db.prepare('INSERT INTO security_mail(id,kind,ref_id,recipient,locale,sealed,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, input.kind, input.refId, input.recipient, input.locale, sealed, input.expiresAt, now);
    db.prepare('INSERT INTO outbox(id,security_mail_id,dedupe_key,next_attempt_at,created_at) VALUES(?,?,?,?,?)').run(`mail_${id}`, id, `security:${input.kind}:${input.refId}`, now, now);
  })();
  return id;
}
export function buildSecurityMail(db: HcdDatabase, id: string, secret: string | undefined, appUrl: string, now: number): NotificationMail | null {
  const mail = db.prepare('SELECT * FROM security_mail WHERE id=?').get(id) as SecurityMail | undefined;
  if (!mail || !mail.sealed || Date.parse(mail.expires_at) <= now) return null;
  if (mail.kind === 'guest_code') {
    const valid = db.prepare("SELECT 1 FROM guest_challenges c JOIN share_links l ON l.id=c.link_id WHERE c.id=? AND c.email=? AND c.used_at IS NULL AND c.expires_at>? AND l.role='commenter' AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>?)").get(mail.ref_id, mail.recipient, new Date(now).toISOString(), new Date(now).toISOString());
    if (!valid) return null;
  } else {
    const valid = db.prepare('SELECT 1 FROM invites i JOIN users u ON u.id=i.user_id WHERE i.id=? AND i.kind=? AND i.used_at IS NULL AND i.expires_at>? AND u.email=? AND u.disabled_at IS NULL').get(mail.ref_id, mail.kind, new Date(now).toISOString(), mail.recipient);
    if (!valid) return null;
  }
  if (!secret) throw new Error('SECURITY_MAIL_KEY_UNAVAILABLE');
  const [version, nonce, tag, data] = mail.sealed.split('.');
  if (version !== '1' || !nonce || !tag || !data) throw new Error('SECURITY_MAIL_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(nonce, 'base64url')); decipher.setAAD(binding(mail)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const value = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  const zh = mail.locale === 'zh-CN'; const code = mail.kind === 'guest_code';
  const subject = `HCD · ${code ? zh ? '访客验证码' : 'Guest verification code' : mail.kind === 'invite' ? zh ? '邀请加入协作文档' : 'Invitation to HCD' : zh ? '重置密码' : 'Reset your password'}`;
  const destination = code ? value : new URL(`/${mail.kind === 'invite' ? 'invite' : 'reset'}/${encodeURIComponent(value)}`, appUrl).href;
  const info = code ? zh ? '验证码 10 分钟内有效。请勿向他人透露。' : 'This code expires in 10 minutes. Do not share it.' : zh ? '链接仅可使用一次；若你未申请此邮件，可忽略。' : 'This link can be used once. If you did not request this email, you can ignore it.';
  return { to: mail.recipient, subject, text: `${subject}\n\n${destination}\n\n${info}`, html: `<h2>${escape(subject)}</h2><p>${code ? `<strong>${escape(destination)}</strong>` : `<a href="${escape(destination)}">${zh ? '继续' : 'Continue'}</a>`}</p><p>${escape(info)}</p>`, messageId: `<hcd-${createHash('sha256').update(id).digest('hex')}@${new URL(appUrl).hostname}>` };
}
