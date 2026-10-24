import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { createFeishuTransport, createIntegrationStore, integrationCard } from '../src/feishu';
import { createFeishuWorker } from '../src/feishu-worker';
const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
const secret = 'integration-encryption-test-secret'; const space = 'sp_demo000000'; const doc = 'd_aaaaaaab';
type RequestLog = { url: string; body: Record<string, unknown>; authorization?: string };
describe('Feishu integration delivery', () => {
  let db: HcdDatabase; let app: FastifyInstance; let owner: string; let server: Server; let baseUrl: string; let calls: RequestLog[]; let responseCode: number; let clock: number;
  let onRequest: ((call: RequestLog) => void | Promise<void>) | undefined;
  beforeEach(async () => {
    db = openDatabase(':memory:'); calls = []; responseCode = 0; clock = Date.now(); onRequest = undefined;
    server = createServer(async (request, response) => {
      let text = ''; for await (const part of request) text += part.toString(); const body = JSON.parse(text) as Record<string, unknown>;
      calls.push({ url: request.url!, body, authorization: request.headers.authorization });
      await onRequest?.(calls.at(-1)!);
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.includes('/tenant_access_token/')) response.end(JSON.stringify({ code: 0, tenant_access_token: 'fixture-token', expire: 7200 }));
      else if (request.url?.includes('/batch_get_id')) response.end(JSON.stringify({ code: 0, data: { user_list: [{ email: (body.emails as string[])[0], user_id: 'ou_fixture' }] } }));
      else response.end(JSON.stringify({ code: responseCode, msg: 'upstream secret must not be stored', data: {} }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture');
    baseUrl = `http://127.0.0.1:${address.port}`;
    app = createApp({ db, seed: true, secretKey: secret, feishu: { baseUrl, fixtureOrigin: baseUrl } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } }); owner = String(login.headers['set-cookie']).split(';')[0]!;
  });
  afterEach(async () => { await app.close(); db.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  function transport() { return createFeishuTransport({ baseUrl, fixtureOrigin: baseUrl, now: () => clock }); }
  function worker() { const service = transport(); return createFeishuWorker(db, createIntegrationStore(db, secret, service), service, 'https://hcd.test', () => clock); }
  async function configure(kind: 'feishu_webhook' | 'feishu_app' = 'feishu_webhook', config?: unknown) {
    const response = await app.inject({ method: 'PUT', url: `/api/v1/spaces/${space}/integrations/${kind}`, headers: headers(owner), payload: { config: config ?? (kind === 'feishu_webhook' ? { webhookUrl: `${baseUrl}/open-apis/bot/v2/hook/fixture-token`, secret: 'signing-secret', locale: 'en' } : { appId: 'cli_fixture', appSecret: 'app-secret', locale: 'en' }) } });
    expect(response.statusCode, response.body).toBe(204);
  }
  function submit(id: string) { const snapshot = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(doc) as { content: string }; db.prepare('INSERT INTO submissions(id,doc_id,author_id,base_version,message,content,status,idempotency_key,payload_hash,created_at) VALUES(?,?,?,1,?,?,\'pending\',?,?,?)').run(id, doc, 'u_editor00000', 'private-message', snapshot.content, id, id, new Date(clock).toISOString()); }
  function notify(id: string, kind: string, payload: unknown, user = 'u_owner000000') { db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(id, user, doc, kind, JSON.stringify(payload), new Date(clock).toISOString()); }
  it('AT-35 stores encrypted owner-only configuration without disclosing secrets and prevents ' +
     'arbitrary network destinations', async () => {
    await configure(); const stored = db.prepare('SELECT config_enc,summary FROM space_integrations').get() as { config_enc: string; summary: string };
    expect(JSON.stringify(stored)).not.toContain('fixture-token'); expect(JSON.stringify(stored)).not.toContain('signing-secret');
    const list = await app.inject({ method: 'GET', url: `/api/v1/spaces/${space}/integrations`, headers: headers(owner) }); expect(list.statusCode).toBe(200); expect(list.body).not.toContain('fixture-token'); expect(list.body).not.toContain('signing-secret');
    const editor = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'a@example.com', password: 'hcd-demo-2026' } }); const cookie = String(editor.headers['set-cookie']).split(';')[0]!;
    for (const method of ['GET', 'PUT', 'POST'] as const) { const url = `/api/v1/spaces/${space}/integrations${method === 'GET' ? '' : '/feishu_webhook'}${method === 'POST' ? '/test' : ''}`; expect((await app.inject({ method, url, headers: headers(cookie), ...(method === 'GET' ? {} : { payload: {} }) })).statusCode).toBe(403); }
    const pat = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { scopes: ['read'] } });
    expect((await app.inject({ method: 'GET', url: `/api/v1/spaces/${space}/integrations`, headers: { authorization: `Bearer ${pat.json().token}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/spaces/${space}/integrations/feishu_webhook`, headers: { cookie: owner }, payload: {} })).statusCode).toBe(403);
    const validator = createFeishuTransport();
    for (const webhookUrl of ['http://127.0.0.1/open-apis/bot/v2/hook/secret123', 'https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/secret123', 'https://open.feishu.cn/open-apis/bot/v2/hook/secret123?redirect=evil', 'https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/secret123']) expect(() => validator.validate('feishu_webhook', { webhookUrl })).toThrow();
    expect(() => createFeishuTransport({ baseUrl: 'http://127.0.0.1' })).toThrow(); expect(calls).toEqual([]);
  });
  it('AT-35 queues transactionally, signs webhook cards and deduplicates a mention across ' +
     'recipients', async () => {
    await configure(); expect(() => db.transaction(() => { submit('sub_rollback'); throw new Error('rollback'); })()).toThrow(); expect(db.prepare('SELECT count(*) n FROM feishu_outbox').get()).toEqual({ n: 0 });
    submit('sub_one'); const service = worker(); expect(await service.tick()).toBe(1);
    const sent = calls[0]!; expect(sent.url).toBe('/open-apis/bot/v2/hook/fixture-token'); expect(sent.body.msg_type).toBe('interactive'); expect(sent.body.sign).toBe(createHmac('sha256', `${sent.body.timestamp}\nsigning-secret`).digest('base64'));
    expect(JSON.stringify(sent.body.card)).toContain('https://hcd.test/d/d_aaaaaaab'); expect(JSON.stringify(sent.body.card)).not.toContain('private-message');
    db.prepare('INSERT INTO comments(id,doc_id,thread_id,user_id,body,anchor,created_at) VALUES(?,?,?,?,?,?,?)').run('cm_test', doc, 'cm_test', 'u_editor00000', '@[Owner](u_owner000000) <at id=all>unsafe</at> '+ 'a'.repeat(400), '{}', new Date(clock).toISOString());
    notify('nt_a', 'mention', { commentId: 'cm_test' }); notify('nt_b', 'mention', { commentId: 'cm_test' }, 'u_editor00000');
    expect(await service.tick()).toBe(1); expect(calls).toHaveLength(2); const card = calls[1]!.body.card as { elements: Array<{ text?: { tag: string; content: string } }> };
    expect(card.elements[1]!.text!.tag).toBe('plain_text'); expect(card.elements[1]!.text!.content.length).toBeLessThanOrEqual(200);
    expect(await service.tick()).toBe(0); await service.stop();
    const snapshot = (db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(doc) as { content: string }).content;
    for (const version of [2, 3]) db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)').run(doc, version, 'publish', snapshot, 'u_owner000000', new Date(clock).toISOString());
    expect(db.prepare("SELECT count(*) n FROM feishu_outbox WHERE event='submission_published'").get()).toEqual({ n: 2 });
  });
  it('AT-35 cancels pending events when their configuration changes or source is no longer ' +
     'actionable', async () => {
    await configure(); submit('sub_old'); await configure('feishu_webhook', { webhookUrl: `${baseUrl}/open-apis/bot/v2/hook/replacement`, locale: 'en' });
    submit('sub_withdrawn'); db.prepare("UPDATE submissions SET status='withdrawn' WHERE id='sub_withdrawn'").run();
    db.prepare('INSERT INTO comments(id,doc_id,thread_id,user_id,body,anchor,created_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)').run('cm_deleted', doc, 'cm_deleted', 'u_editor00000', '', '{}', new Date(clock).toISOString(), new Date(clock).toISOString()); notify('nt_deleted', 'mention', { commentId: 'cm_deleted' });
    const service = worker(); expect(await service.tick()).toBe(0); expect(calls).toEqual([]); expect(db.prepare("SELECT count(*) n FROM feishu_outbox WHERE status='cancelled'").get()).toEqual({ n: 3 });
    submit('sub_disabled'); await app.inject({ method: 'PUT', url: `/api/v1/spaces/${space}/integrations/feishu_webhook`, headers: headers(owner), payload: { enabled: false } }); expect(await service.tick()).toBe(0); await service.stop();
  });
  it('AT-35 maps private recipients by current email, caches identities for a day and rechecks ' +
     'membership before delivery', async () => {
    await configure('feishu_app'); submit('sub_private'); notify('nt_private1', 'submission_pending', { submissionId: 'sub_private' }); notify('nt_private2', 'submission_pending', { submissionId: 'sub_private' });
    const service = worker(); expect(await service.tick()).toBe(2);
    expect(calls.filter((item) => item.url.includes('tenant_access_token'))).toHaveLength(1); expect(calls.filter((item) => item.url.includes('batch_get_id'))).toHaveLength(1);
    const messages = calls.filter((item) => item.url.includes('/im/v1/messages')); expect(messages).toHaveLength(2); expect(messages[0]!.authorization).toBe('Bearer fixture-token'); expect(messages[0]!.body).toMatchObject({ receive_id: 'ou_fixture', msg_type: 'interactive' }); expect(messages[0]!.body.uuid).not.toBe(messages[1]!.body.uuid);
    notify('nt_removed', 'submission_pending', { submissionId: 'sub_private' }); db.prepare("DELETE FROM document_members WHERE user_id='u_owner000000'").run(); db.prepare("DELETE FROM space_members WHERE user_id='u_owner000000'").run(); expect(await service.tick()).toBe(0);
    db.prepare("INSERT INTO space_members VALUES(?,'u_owner000000','owner')").run(space); db.prepare("UPDATE users SET email='changed@example.com' WHERE id='u_owner000000'").run(); notify('nt_changed', 'submission_pending', { submissionId: 'sub_private' }); expect(await service.tick()).toBe(1);
    expect(calls.filter((item) => item.url.includes('batch_get_id')).at(-1)!.body).toEqual({ emails: ['changed@example.com'] });
    clock += 86400001; notify('nt_nextday', 'submission_pending', { submissionId: 'sub_private' }); expect(await service.tick()).toBe(1); expect(calls.filter((item) => item.url.includes('batch_get_id'))).toHaveLength(3); await service.stop();
  });
  it('AT-35 treats HTTP 200 business errors as failures and persists bounded retries without ' +
     'upstream secret text', async () => {
    await configure(); submit('sub_retry'); responseCode = 9499; const service = worker();
    for (const [index, delay] of [1, 5, 30, 120, 360, 0].entries()) {
      expect(await service.tick()).toBe(0); const row = db.prepare('SELECT status,attempts,last_error,next_attempt_at FROM feishu_outbox').get() as { status: string; attempts: number; last_error: string; next_attempt_at: string };
      expect(row).toMatchObject({ status: index === 5 ? 'failed' : 'pending', attempts: index + 1, last_error: 'INTEGRATION_API_FAILED' }); expect(Date.parse(row.next_attempt_at)).toBe(clock + delay * 60000); expect(JSON.stringify(row)).not.toContain('upstream secret'); clock += delay * 60000;
    }
    expect(calls).toHaveLength(6); await service.stop();
  });
  it('AT-35 does not send tampered ciphertext and sends test messages only through the explicit ' +
     'owner endpoint', async () => {
    await configure(); expect(calls).toEqual([]);
    const test = await app.inject({ method: 'POST', url: `/api/v1/spaces/${space}/integrations/feishu_webhook/test`, headers: headers(owner), payload: {} }); expect(test.json()).toEqual({ ok: true }); expect(calls).toHaveLength(1);
    db.prepare('UPDATE space_integrations SET revision=revision+1').run(); submit('sub_tamper'); const service = worker(); expect(await service.tick()).toBe(0); expect(calls).toHaveLength(1); expect(db.prepare('SELECT last_error FROM feishu_outbox').get()).toEqual({ last_error: 'INTEGRATION_DELIVERY_FAILED' }); await service.stop();
  });
  it('AT-35 stops a private delivery when configuration or recipient changes while obtaining the ' +
     'token', async () => {
    for (const change of ['configuration', 'email'] as const) {
      await configure('feishu_app'); submit(`sub_race_${change}`); notify(`nt_race_${change}`, 'submission_pending', { submissionId: `sub_race_${change}` });
      onRequest = (call) => {
        if (!call.url.includes('tenant_access_token')) return;
        if (change === 'configuration') createIntegrationStore(db, secret, transport()).save(space, 'feishu_app', { enabled: false });
        else db.prepare("UPDATE users SET email='new@example.com' WHERE id='u_owner000000'").run();
      };
      const service = worker(); expect(await service.tick()).toBe(0); await service.stop();
      expect(db.prepare('SELECT status,last_error FROM feishu_outbox WHERE notification_id=?').get(`nt_race_${change}`)).toEqual({ status: 'cancelled', last_error: 'INTEGRATION_INELIGIBLE' });
    }
    expect(calls).toHaveLength(2); expect(calls.every((call) => call.url.includes('tenant_access_token'))).toBe(true);
  });
  it('AT-35 recovers an expired lease without letting the previous worker send or overwrite the ' +
     'new result', async () => {
    await configure('feishu_app'); submit('sub_lease'); notify('nt_lease', 'submission_pending', { submissionId: 'sub_lease' });
    let release!: () => void; let entered!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; }); let first = true;
    onRequest = async (call) => { if (first && call.url.includes('tenant_access_token')) { first = false; entered(); await blocked; } };
    const oldWorker = worker(); const currentWorker = worker(); const pending = oldWorker.tick(); await started;
    try {
      expect(await currentWorker.tick()).toBe(0);
      clock += 60001;
      expect(await currentWorker.tick()).toBe(1);
      release(); expect(await pending).toBe(0);
      expect(calls.filter((call) => call.url.includes('/im/v1/messages'))).toHaveLength(1);
      expect(db.prepare('SELECT status,attempts,last_error,lease_token FROM feishu_outbox').get()).toEqual({ status: 'sent', attempts: 2, last_error: null, lease_token: null });
    } finally { release(); await oldWorker.stop(); await currentWorker.stop(); }
  });
  it('AT-35 queues AI requests for the group even without private notification recipients and ' +
     'deduplicates later notifications', async () => {
    await configure();
    db.prepare("INSERT INTO ai_tasks(id,doc_id,requested_by,kind,status,instruction,module_ids,created_at,updated_at) VALUES(?,?,?,'edit','requested','private instruction','[]',?,?)").run('at_group', doc, 'u_owner000000', new Date(clock).toISOString(), new Date(clock).toISOString());
    expect(db.prepare("SELECT count(*) n FROM feishu_outbox WHERE event='ai_task_requested'").get()).toEqual({ n: 1 });
    notify('nt_ai', 'ai_task_requested', { taskId: 'at_group' });
    const service = worker(); expect(await service.tick()).toBe(1); expect(calls).toHaveLength(1); expect(JSON.stringify(calls[0])).not.toContain('private instruction'); await service.stop();
  });
});

it('AT-35 uses the current Feishu token endpoint, disables redirects and rejects oversized ' +
   'responses', async () => {
  const db = openDatabase(':memory:'); const paths: string[] = []; let large = false;
  const fake: typeof fetch = async (url, options) => {
    const target = String(url); paths.push(target); expect(options?.redirect).toBe('error'); expect(options?.signal).toBeTruthy();
    if (target.includes('accounts.feishu.cn')) { expect(JSON.parse(String(options?.body))).toMatchObject({ grant_type: 'client_credentials', client_id: 'cli_test', client_secret: 'secret' }); return Response.json({ code: 0, access_token: 'modern-token', expires_in: 7200 }); }
    if (large) return new Response('x'.repeat(1024 * 1024 + 1));
    return Response.json({ code: 0 });
  };
  const transport = createFeishuTransport({ request: fake });
  try {
    const row = { space_id: 'missing', kind: 'feishu_app' as const, revision: 1, enabled: 1, config_enc: '', summary: '' };
    await expect(transport.send(db, row, { appId: 'cli_test', appSecret: 'secret', locale: 'en' }, integrationCard('test', 'Test', 'https://hcd.test', 'en'), 'job', 'person@example.com')).rejects.toThrow('INTEGRATION_RECIPIENT_UNAVAILABLE');
    expect(paths[0]).toBe('https://accounts.feishu.cn/oauth/v3/token');
    large = true;
    await expect(transport.send(db, { ...row, kind: 'feishu_webhook' }, { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-token', locale: 'en' }, {}, 'large')).rejects.toThrow('INTEGRATION_RESPONSE_TOO_LARGE');
  } finally { db.close(); }
});

it('AT-35 fails closed for ambiguous contact lookup and selects the Lark API host', async () => {
  const db = openDatabase(':memory:'); const urls: string[] = [];
  const transport = createFeishuTransport({ baseUrl: 'https://open.larksuite.com', request: async (url) => {
    urls.push(String(url));
    return String(url).includes('tenant_access_token') ? Response.json({ code: 0, tenant_access_token: 'lark-token', expire: 7200 }) : Response.json({ code: 0, data: { user_list: [{ email: 'person@example.com', user_id: 'ou_first' }, { email: 'person@example.com', user_id: 'ou_second' }] } });
  } });
  try {
    await expect(transport.send(db, { space_id: 'missing', kind: 'feishu_app', revision: 1, enabled: 1, config_enc: '', summary: '' }, { appId: 'cli_test', appSecret: 'secret', locale: 'en' }, {}, 'ambiguous', 'person@example.com')).rejects.toThrow('INTEGRATION_RECIPIENT_UNAVAILABLE');
    expect(urls).toHaveLength(2); expect(urls.every((url) => url.startsWith('https://open.larksuite.com/'))).toBe(true); expect(urls[0]).toContain('/auth/v3/tenant_access_token/internal');
  } finally { db.close(); }
});
