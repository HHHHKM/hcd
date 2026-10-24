import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { MCP_PROTOCOL_VERSION, registerMcpRoutes } from '../src/mcp';

const origin = 'http://localhost:5173';
const documentId = 'd_aaaaaaab';
const accept = 'application/json, text/event-stream';
const writeHeaders = (cookie: string) => ({ cookie, origin, 'x-hcd-request': '1' });

describe('stateless MCP HTTP transport', () => {
  let app: FastifyInstance;
  let db: HcdDatabase;
  let owner: string;
  let token: string;
  let tokenId: string;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    app = createApp({ db, secretKey: 'mcp-test-secret', appUrl: origin, seed: true });
    registerMcpRoutes(app, { appUrl: origin });
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    expect(login.statusCode).toBe(200);
    owner = String(login.headers['set-cookie']).split(';')[0]!;
    const created = await createToken(['read', 'comment', 'submit']);
    token = created.token;
    tokenId = created.meta.id;
  });
  afterEach(async () => { await app.close(); db.close(); });

  async function createToken(scopes: string[], docIds?: string[]) {
    const result = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: writeHeaders(owner), payload: { name: 'MCP integration', scopes, ...(docIds === undefined ? {} : { docIds }) } });
    expect(result.statusCode).toBe(201);
    return result.json() as { token: string; meta: { id: string } };
  }

  const rpc = (payload: unknown, pat?: string, extraHeaders: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/mcp', headers: { accept, authorization: `Bearer ${pat ?? token}`, ...extraHeaders }, payload: payload as Record<string, unknown> });
  const call = (name: string, args: Record<string, unknown> = {}, pat?: string) => rpc({ jsonrpc: '2.0', id: 'tool-request', method: 'tools/call', params: { name, arguments: args } }, pat);
  function data(response: Awaited<ReturnType<typeof call>>) {
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result?.isError).toBe(false);
    return JSON.parse(body.result.content[0].text).untrustedData;
  }
  function failure(response: Awaited<ReturnType<typeof call>>) {
    expect(response.statusCode).toBe(200);
    expect(response.json().result.isError).toBe(true);
    return JSON.parse(response.json().result.content[0].text).error;
  }

  it('AT-30 B10 charges one HTTP request and one tool call without charging internal API reads', async () => {
    for (let i = 0; i < 50; i++) {
      const id = `d_${i.toString(2).padStart(8, '0').replaceAll('0', 'a').replaceAll('1', 'b')}`;
      if (id === documentId) continue;
      db.prepare('INSERT OR IGNORE INTO documents(id,space_id,title,current_version,ai_enabled,created_by,created_at,updated_at) SELECT ?,space_id,title,current_version,1,created_by,created_at,updated_at FROM documents WHERE id=?').run(id, documentId);
      db.prepare('INSERT OR IGNORE INTO versions(doc_id,version,kind,content,created_by,created_at) SELECT ?,version,kind,content,created_by,created_at FROM versions WHERE doc_id=?').run(id, documentId);
    }
    for (let i = 0; i < 290; i++) expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect(data(await call('list_documents')).docs.length).toBeGreaterThanOrEqual(50);
    for (let i = 0; i < 7; i++) expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(429);
  });

  it('AT-30 B10 external callers cannot forge the internal rate-limit bypass', async () => {
    for (let i = 0; i < 299; i++) expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${token}`, 'x-hcd-internal': '0'.repeat(64) } })).statusCode).toBe(429);
  });

  it('AT-21 requires a real PAT even for discovery and rejects foreign origins or cookie fallback', async () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const cookieOnly = await app.inject({ method: 'POST', url: '/mcp', headers: { cookie: owner, accept }, payload });
    expect(cookieOnly.statusCode).toBe(401);
    expect(cookieOnly.headers['www-authenticate']).toContain('Bearer');
    expect((await rpc(payload, 'hcd_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).statusCode).toBe(401);
    expect((await rpc(payload, token, { origin: 'https://attacker.example' })).statusCode).toBe(403);
    expect((await rpc(payload, token, { origin: 'null' })).statusCode).toBe(403);
    expect((await rpc(payload, token, { origin })).statusCode).toBe(200);
  });

  it('AT-22 negotiates protocol, accepts notifications, supports batches and advertises no ' +
     'official-version mutations', async () => {
    const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } } });
    expect(initialized.json().result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(initialized.json().result.capabilities.tools).toEqual({ listChanged: false });
    expect(initialized.headers['mcp-session-id']).toBeUndefined();
    const notification = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.statusCode).toBe(202);
    expect(notification.body).toBe('');
    const batch = await rpc([{ jsonrpc: '2.0', id: 2, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } }, { jsonrpc: '2.0', id: 3, method: 'tools/list' }]);
    expect(batch.json()).toHaveLength(2);
    expect(batch.json()[0]).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    const tools = batch.json()[1].result.tools as Array<{ name: string; inputSchema: { type: string } }>;
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_documents', 'read_document', 'get_outline', 'read_module', 'list_versions', 'list_comments', 'add_comment', 'list_submissions', 'get_submission', 'create_submission']));
    expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
    expect(tools.some((tool) => /publish|reject|restore|member|admin/.test(tool.name))).toBe(false);
    for (const method of ['GET', 'DELETE'] as const) {
      const result = await app.inject({ method, url: '/mcp', headers: { authorization: `Bearer ${token}`, accept } });
      expect(result.statusCode).toBe(405);
      expect(result.headers.allow).toBe('POST');
    }
  });

  it('AT-30 reads official documents, modules, outlines, versions and comments without disclosing ' +
     'private drafts', async () => {
    const original = await app.inject({ method: 'GET', url: `/api/v1/docs/${documentId}`, headers: { cookie: owner } });
    const content = original.json().content;
    const draftContent = structuredClone(content); draftContent.title = 'Private unfinished draft';
    await app.inject({ method: 'PUT', url: `/api/v1/docs/${documentId}/draft`, headers: writeHeaders(owner), payload: { baseVersion: 1, content: draftContent } });
    const docs = data(await call('list_documents')).docs;
    expect(docs).toHaveLength(1);
    expect(docs[0].aiEnabled).toBe(true);
    expect(data(await call('list_documents', { query: 'no such title' })).docs).toHaveLength(0);
    const official = data(await call('read_document', { documentId }));
    expect(official.content).toEqual(content);
    expect(official.draft).toBeUndefined();
    const historical = data(await call('read_document', { documentId, version: 1 }));
    expect(historical.version).toBe(1);
    const outline = data(await call('get_outline', { documentId }));
    expect(outline.modules[0].id).toBe(content.modules[0].id);
    const modules = data(await call('read_module', { documentId, moduleIds: [content.modules[0].id], format: 'json' }));
    expect(modules.modules[0].json).toEqual(content.modules[0]);
    expect(data(await call('list_versions', { documentId })).versions[0].version).toBe(1);
    expect(data(await call('list_comments', { documentId, status: 'all' })).threads).toBeInstanceOf(Array);
  });

  it('AT-22 persists comments and idempotent submissions through API scope checks without ' +
     'publishing', async () => {
    const read = (await createToken(['read'])).token;
    const comment = (await createToken(['comment'])).token;
    const official = data(await call('read_document', { documentId }));
    const anchor = { moduleId: official.content.modules[0].id, blockId: official.content.modules[0].blocks[0].id };
    expect(failure(await call('add_comment', { documentId, anchor, body: 'Denied' }, read)).code).toBe('TOKEN_SCOPE');
    const added = data(await call('add_comment', { documentId, anchor, body: 'A persisted MCP comment' }, comment));
    const comments = data(await call('list_comments', { documentId, moduleId: anchor.moduleId }));
    expect(comments.threads.some((thread: { root: { id: string } }) => thread.root.id === added.comment.id)).toBe(true);
    const content = structuredClone(official.content); content.modules[0].title = 'MCP proposed title';
    const args = { documentId, baseVersion: 1, message: 'Proposal for human review', idempotencyKey: 'mcp-idempotent-test', content };
    expect(failure(await call('create_submission', args, read)).code).toBe('TOKEN_SCOPE');
    expect(failure(await call('create_submission', args, comment)).code).toBe('TOKEN_SCOPE');
    const first = data(await call('create_submission', args));
    const second = data(await call('create_submission', args));
    expect(first.submission.id).toBe(second.submission.id);
    expect(first.submission.status).toBe('pending');
    const changed = structuredClone(args); changed.content.title = 'Different body';
    expect(failure(await call('create_submission', changed)).code).toBe('IDEMPOTENCY_MISMATCH');
    expect(data(await call('list_submissions', { documentId, mine: true, status: 'pending' })).submissions).toHaveLength(1);
    expect(data(await call('get_submission', { submissionId: first.submission.id })).submission.id).toBe(first.submission.id);
    const head = await app.inject({ method: 'GET', url: `/api/v1/docs/${documentId}/head`, headers: { cookie: owner } });
    expect(head.json().currentVersion).toBe(1);
    expect(data(await call('read_document', { documentId })).content).toEqual(official.content);
  });

  it('AT-21 / AT-26 enforces document restrictions and the AI switch for every document operation', async () => {
    const scoped = (await createToken(['read', 'comment', 'submit'], [])).token;
    expect(data(await call('list_documents', {}, scoped)).docs).toEqual([]);
    expect(failure(await call('read_document', { documentId }, scoped)).code).toBe('NOT_FOUND');
    expect(failure(await call('list_comments', { documentId }, scoped)).code).toBe('NOT_FOUND');
    expect(failure(await call('list_submissions', { documentId }, scoped)).code).toBe('NOT_FOUND');
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(documentId);
    expect(data(await call('list_documents')).docs).toEqual([]);
    for (const name of ['read_document', 'get_outline', 'list_versions', 'list_comments', 'list_submissions']) expect(failure(await call(name, { documentId })).code).toBe('AI_DISABLED');
    expect(failure(await call('add_comment', { documentId, anchor: { moduleId: 'm_aaaaaaab' }, body: 'Blocked' })).code).toBe('AI_DISABLED');
  });

  it('AT-21 rechecks revoked, expired and disabled-user PATs on every request', async () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await rpc(payload)).statusCode).toBe(200);
    db.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').run(new Date().toISOString(), tokenId);
    expect((await rpc(payload)).statusCode).toBe(401);
    const expired = await createToken(['read']);
    db.prepare('UPDATE api_tokens SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.meta.id);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, expired.token)).statusCode).toBe(401);
    const disabled = await createToken(['read']);
    db.prepare("UPDATE users SET disabled_at=? WHERE email='d@example.com'").run(new Date().toISOString());
    expect((await rpc(payload, disabled.token)).statusCode).toBe(401);
  });

  it('AT-30 validates transport, JSON-RPC envelopes, tool names and structured input', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, token, { accept: 'application/json' })).statusCode).toBe(406);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, token, { 'mcp-protocol-version': '1900-01-01' })).statusCode).toBe(400);
    expect((await rpc({ jsonrpc: '1.0', id: 1, method: 'ping' })).json().error.code).toBe(-32600);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'unknown' })).json().error.code).toBe(-32601);
    expect((await call('publish', { documentId })).json().error.code).toBe(-32602);
    expect((await call('read_document', { documentId: '../admin/users' })).json().error.code).toBe(-32602);
    expect((await call('read_module', { documentId, moduleIds: [], format: 'html' })).json().error.code).toBe(-32602);
    expect((await call('create_submission', { documentId, baseVersion: 1, message: '', idempotencyKey: '', content: {} })).json().error.code).toBe(-32602);
    expect(failure(await call('create_submission', { documentId, baseVersion: 1, message: '', idempotencyKey: 'invalid-content', content: {} })).code).toBe('VALIDATION_FAILED');
    const original = data(await call('read_document', { documentId })).content;
    original.id = 'd_aaaaaaac';
    expect(failure(await call('create_submission', { documentId, baseVersion: 1, message: '', idempotencyKey: 'wrong-id', content: original })).code).toBe('DOCUMENT_ID_MISMATCH');
    const malformed = await app.inject({ method: 'POST', url: '/mcp', headers: { accept, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: '{broken' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe(-32700);
    expect((await rpc([])).statusCode).toBe(400);
    expect((await rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }])).statusCode).toBe(400);
  });
});
