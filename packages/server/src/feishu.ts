import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { HcdDatabase } from './db';
export type IntegrationKind = 'feishu_webhook' | 'feishu_app';
export type IntegrationConfig = { locale: 'zh-CN' | 'en'; webhookUrl?: string; secret?: string; appId?: string; appSecret?: string };
export type Integration = { space_id: string; kind: IntegrationKind; revision: number; enabled: number; config_enc: string; summary: string };
export type FeishuOptions = { baseUrl?: string; fixtureOrigin?: string; request?: typeof fetch; now?: () => number };
export class IntegrationError extends Error { constructor(public code: string) { super(code); } }
const fail = (code = 'INTEGRATION_DELIVERY_FAILED'): never => { throw new IntegrationError(code); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const iso = (value: number) => new Date(value).toISOString();
const key = (secret: string) => Buffer.from(hkdfSync('sha256', secret, '', 'hcd-integrations-v1', 32));
function seal(value: IntegrationConfig, secret: string, context: string) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), nonce); cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [1, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
function unseal(row: Integration, secret: string): IntegrationConfig {
  const [version, nonce, tag, data] = row.config_enc.split('.');
  if (version !== '1' || !nonce || !tag || !data) return fail('INTEGRATION_CONFIG_INVALID');
  const cipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(nonce, 'base64url')); cipher.setAAD(Buffer.from(`${row.space_id}:${row.kind}:${row.revision}`)); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8')) as IntegrationConfig;
}
export function createFeishuTransport(options: FeishuOptions = {}) {
  const base = new URL(options.baseUrl ?? 'https://open.feishu.cn');
  const fixture = options.fixtureOrigin ? new URL(options.fixtureOrigin) : null;
  if (fixture && (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || fixture.pathname !== '/' || fixture.username || fixture.password || fixture.search || fixture.hash)) throw new Error('Invalid fixture origin');
  if ((!fixture || base.origin !== fixture.origin) && !['https://open.feishu.cn', 'https://open.larksuite.com'].includes(base.origin)) throw new Error('Invalid FEISHU_BASE_URL');
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Invalid FEISHU_BASE_URL');
  const tokenUrl = base.hostname === 'open.feishu.cn' ? 'https://accounts.feishu.cn/oauth/v3/token' : `${base.origin}/open-apis/auth/v3/tenant_access_token/internal`;
  const now = options.now ?? Date.now; const request = options.request ?? fetch;
  const tokens = new Map<string, { value: string; expires: number }>();
  async function post(url: string, body: unknown, authorization?: string) {
    const destination = new URL(url);
    if (![base.origin, new URL(tokenUrl).origin].includes(destination.origin)) return fail('INTEGRATION_TARGET_INVALID');
    const response = await request(destination, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) return fail(response.status === 429 ? 'INTEGRATION_RATE_LIMITED' : 'INTEGRATION_HTTP_FAILED');
    const reader = response.body?.getReader(); if (!reader) return fail();
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) { await reader.cancel(); return fail('INTEGRATION_RESPONSE_TOO_LARGE'); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    let result: unknown; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail('INTEGRATION_RESPONSE_INVALID'); }
    if (!object(result) || result.code !== 0) return fail('INTEGRATION_API_FAILED');
    return result;
  }
  return {
    baseUrl: base.origin,
    validate(kind: IntegrationKind, body: unknown): IntegrationConfig {
      if (!object(body)) return fail('VALIDATION_FAILED');
      const config: IntegrationConfig = { locale: body.locale === 'en' ? 'en' : 'zh-CN' };
      const text = (name: string, max: number, required = true) => { const value = body[name]; if ((required && (typeof value !== 'string' || !value.trim())) || (value !== undefined && (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)))) return fail('VALIDATION_FAILED'); return typeof value === 'string' ? value.trim() : ''; };
      if (kind === 'feishu_webhook') {
        const value = text('webhookUrl', 512); let url: URL; try { url = new URL(value); } catch { return fail('VALIDATION_FAILED'); }
        if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_-]{8,128}$/.test(url.pathname)) return fail('INTEGRATION_TARGET_INVALID');
        config.webhookUrl = url.href; config.secret = text('secret', 256, false);
      } else { config.appId = text('appId', 128); config.appSecret = text('appSecret', 512); }
      return config;
    },
    async send(db: HcdDatabase, row: Integration, config: IntegrationConfig, card: unknown, deliveryId: string, email?: string, eligible?: () => boolean) {
      const sendPost = (...args: Parameters<typeof post>) => { if (eligible && !eligible()) return fail('INTEGRATION_INELIGIBLE'); return post(...args); };
      if (row.kind === 'feishu_webhook') {
        const timestamp = String(Math.floor(now() / 1000));
        await sendPost(config.webhookUrl!, { msg_type: 'interactive', card, ...(config.secret ? { timestamp, sign: createHmac('sha256', `${timestamp}\n${config.secret}`).digest('base64') } : {}) }); return;
      }
      if (!email) return fail('INTEGRATION_RECIPIENT_UNAVAILABLE');
      const cacheKey = `${row.space_id}:${row.revision}:${config.appId}`;
      let token = tokens.get(cacheKey);
      if (!token || token.expires <= now()) {
        const modern = base.hostname === 'open.feishu.cn';
        const response = await sendPost(tokenUrl, modern ? { grant_type: 'client_credentials', client_id: config.appId, client_secret: config.appSecret, scope: 'im:message:send_as_bot contact:user.id:readonly' } : { app_id: config.appId, app_secret: config.appSecret });
        const value = response[modern ? 'access_token' : 'tenant_access_token']; const seconds = response[modern ? 'expires_in' : 'expire'];
        if (typeof value !== 'string' || value.length > 32768 || typeof seconds !== 'number' || seconds < 60) return fail('INTEGRATION_TOKEN_INVALID');
        if (tokens.size > 500) tokens.clear();
        token = { value, expires: now() + Math.min(seconds - 30, 7170) * 1000 }; tokens.set(cacheKey, token);
      }
      try {
        let cached = db.prepare('SELECT open_id FROM integration_users WHERE space_id=? AND revision=? AND email=? AND expires_at>?').get(row.space_id, row.revision, email, iso(now())) as { open_id: string } | undefined;
        if (!cached) {
          const response = await sendPost(`${base.origin}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`, { emails: [email] }, token.value);
          const data = object(response.data) ? response.data : {}; const users = Array.isArray(data.user_list) ? data.user_list : [];
          const matches = users.filter((value) => object(value) && typeof value.email === 'string' && value.email.toLowerCase() === email.toLowerCase());
          const user = matches[0];
          if (matches.length !== 1 || !object(user) || typeof user.user_id !== 'string' || !/^ou_[a-zA-Z0-9_-]{1,128}$/.test(user.user_id)) return fail('INTEGRATION_RECIPIENT_UNAVAILABLE');
          cached = { open_id: user.user_id };
          db.prepare('INSERT INTO integration_users(space_id,revision,email,open_id,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(space_id,revision,email) DO UPDATE SET open_id=excluded.open_id,expires_at=excluded.expires_at').run(row.space_id, row.revision, email, cached.open_id, iso(now() + 86400000));
        }
        await sendPost(`${base.origin}/open-apis/im/v1/messages?receive_id_type=open_id`, { receive_id: cached.open_id, msg_type: 'interactive', content: JSON.stringify(card), uuid: createHash('sha256').update(deliveryId).digest('hex').slice(0, 40) }, token.value);
      } catch (error) { tokens.delete(cacheKey); throw error; }
    },
  };
}
export function integrationCard(kind: string, title: string, url: string, locale: string, summary?: string) {
  const labels: Record<string, [string, string]> = { submission_pending: ['新提交待审核', 'Changes ready for review'], submission_published: ['正式版本已发布', 'New version published'], mention: ['讨论中有提及', 'Mention in discussion'], ai_task_requested: ['AI 请求待批准', 'AI request needs approval'], test: ['通知连接测试', 'Notification connection test'] };
  const zh = locale === 'zh-CN'; const heading = labels[kind]?.[zh ? 0 : 1] ?? 'HCD';
  return { config: { wide_screen_mode: true }, header: { template: 'blue', title: { tag: 'plain_text', content: `HCD · ${heading}` } }, elements: [
    { tag: 'div', text: { tag: 'plain_text', content: title.slice(0, 200) } }, ...(summary ? [{ tag: 'div', text: { tag: 'plain_text', content: summary.slice(0, 200) } }] : []),
    { tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: zh ? '打开 HCD' : 'Open HCD' }, url }] },
  ] };
}
export function createIntegrationStore(db: HcdDatabase, secret: string, transport: ReturnType<typeof createFeishuTransport>) {
  const get = (spaceId: string, kind: IntegrationKind) => db.prepare('SELECT * FROM space_integrations WHERE space_id=? AND kind=?').get(spaceId, kind) as Integration | undefined;
  return {
    get, read: (row: Integration) => unseal(row, secret),
    save(spaceId: string, kind: IntegrationKind, input: unknown) {
      if (!object(input) || (input.enabled !== undefined && typeof input.enabled !== 'boolean')) return fail('VALIDATION_FAILED');
      return db.transaction(() => {
        const old = get(spaceId, kind); const revision = (old?.revision ?? 0) + 1;
        const config = input.config === undefined && old ? unseal(old, secret) : transport.validate(kind, input.config);
        const enabled = input.enabled !== false;
        const summary = kind === 'feishu_webhook' ? `${new URL(config.webhookUrl!).hostname} · webhook` : `${transport.baseUrl} · ${config.appId}`;
        db.prepare('INSERT INTO space_integrations(space_id,kind,revision,config_enc,enabled,summary,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(space_id,kind) DO UPDATE SET revision=excluded.revision,config_enc=excluded.config_enc,enabled=excluded.enabled,summary=excluded.summary,updated_at=excluded.updated_at').run(spaceId, kind, revision, seal(config, secret, `${spaceId}:${kind}:${revision}`), Number(enabled), summary, iso(Date.now()));
        db.prepare("UPDATE feishu_outbox SET status='cancelled',last_error='CONFIG_CHANGED',lease_token=NULL,lease_until=NULL WHERE space_id=? AND kind=? AND status='pending'").run(spaceId, kind);
        db.prepare('DELETE FROM integration_users WHERE space_id=?').run(spaceId);
      })();
    },
  };
}
