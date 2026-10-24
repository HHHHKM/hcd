import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../server/src/app';
import { openDatabase, type HcdDatabase } from '../../server/src/db';
import { parseSpecModule } from '../../core/src/spec-html';
import { registerMcpRoutes } from '../../server/src/mcp';
import { createMcpRelay, pinnedMcpFetch } from './mcp-relay';

const origin = 'http://localhost:5173';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
describe('mdoc SDK MCP relay', () => {
  let app: FastifyInstance; let db: HcdDatabase; let server: string; let token: string; let tokenId: string; let cookie: string;
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(async () => {
    db = openDatabase(':memory:'); app = createApp({ db, seed: true, appUrl: origin }); registerMcpRoutes(app, { appUrl: origin });
    server = await app.listen({ port: 0, host: '127.0.0.1' });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const issued = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(cookie), payload: { scopes: ['read', 'comment', 'submit', 'ai_tasks', 'preview'] } });
    token = issued.json().token; tokenId = issued.json().meta.id;
  });
  afterEach(async () => { for (const close of cleanups.splice(0)) await close(); await app.close(); db.close(); });
  async function direct() {
    const client = new Client({ name: 'relay-acceptance', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server}/mcp`), { fetch: pinnedMcpFetch(new URL(`${server}/mcp`), token) }));
    cleanups.push(() => client.close()); return client;
  }
  async function relay() {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const forwarding = await createMcpRelay({ server, token }, serverTransport);
    const client = new Client({ name: 'relay-acceptance', version: '1' });
    cleanups.push(() => forwarding.close()); cleanups.push(() => client.close()); await client.connect(clientTransport); return client;
  }
  async function authorizeDevice() {
    const started = await app.inject({ method: 'POST', url: '/api/v1/cli-auth/start', payload: { clientName: 'mdoc', hostname: 'a2-local-fixture' } });
    expect(started.statusCode).toBe(200);
    const flow = started.json();
    expect((await app.inject({ url: `/api/v1/cli-auth/requests/${flow.code}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/cli-auth/requests/${flow.code}`, headers: headers(cookie), payload: { decision: 'approve', scopes: ['read'], docIds: ['d_aaaaaaab'] } })).statusCode).toBe(200);
    const approved = await app.inject({ method: 'POST', url: '/api/v1/cli-auth/poll', payload: { pollToken: flow.pollToken } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    return approved.json().token as string;
  }
  it('AT-30 A2 initializes MCP directly with a device-authorized base32 PAT', async () => {
    token = await authorizeDevice();
    const initialized = await app.inject({ method: 'POST', url: '/mcp', headers: { accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'a2-device', version: '1' } } } });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result.protocolVersion).toBe('2025-03-26');
    expect(token).toMatch(/^hcd_pat_[a-z2-7]{32}$/);
  });
  it('AT-30 A2 relays an SDK tool call end to end using a device-authorized PAT', async () => {
    token = await authorizeDevice();
    const client = await relay();
    const result = await client.callTool({ name: 'read_document', arguments: { documentId: 'd_aaaaaaab' } });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ untrustedData: { doc: { id: 'd_aaaaaaab' } } });
  });
  it('AT-30 matches real SDK HTTP reads, tool errors and resources through the relay', async () => {
    const remote = await direct(); const forwarded = await relay();
    expect(await forwarded.listTools()).toEqual(await remote.listTools());
    expect(await forwarded.listResources()).toEqual(await remote.listResources());
    expect(await forwarded.readResource({ uri: 'hcd://spec' })).toEqual(await remote.readResource({ uri: 'hcd://spec' }));
    for (const args of [{ name: 'list_documents', arguments: {} }, { name: 'get_spec', arguments: {} }, { name: 'read_document', arguments: { documentId: 'd_aaaaaaab' } }, { name: 'read_document', arguments: { documentId: 'd_zzzzzzzz' } }]) {
      expect(await forwarded.callTool(args)).toEqual(await remote.callTool(args));
    }
    const result = await forwarded.callTool({ name: 'read_document', arguments: { documentId: 'd_aaaaaaab' } });
    expect(result.structuredContent).toHaveProperty('untrustedData');
    await expect(forwarded.callTool({ name: 'publish', arguments: {} })).rejects.toThrow();
    expect((db.prepare("SELECT current_version FROM documents WHERE id='d_aaaaaaab'").get() as { current_version: number }).current_version).toBe(1);
  });
  it('AT-30 executes HTML reads, comment replies and own-submission withdrawal through the SDK', async () => {
    const client = await relay();
    const read = await client.callTool({ name: 'read_document', arguments: { documentId: 'd_aaaaaaab' } });
    const document = (read.structuredContent as { untrustedData: { content: { id: string; modules: Array<{ id: string }>; title: string } } }).untrustedData.content;
    const html = await client.callTool({ name: 'read_module', arguments: { documentId: document.id, moduleIds: [document.modules[0]!.id], format: 'html' } });
    const module = (html.structuredContent as { untrustedData: { modules: Array<{ html: string }> } }).untrustedData.modules[0]!;
    expect(parseSpecModule(module.html).ok).toBe(true);
    for (const name of ['get_outline', 'list_versions', 'list_comments', 'list_submissions']) expect((await client.callTool({ name, arguments: { documentId: document.id } })).isError).toBe(false);
    const comment = await client.callTool({ name: 'add_comment', arguments: { documentId: document.id, anchor: { moduleId: document.modules[0]!.id }, body: 'SDK parent' } });
    const commentId = (comment.structuredContent as { untrustedData: { comment: { id: string } } }).untrustedData.comment.id;
    expect((await client.callTool({ name: 'reply_comment', arguments: { commentId, body: 'SDK reply' } })).isError).toBe(false);
    const submission = await client.callTool({ name: 'create_submission', arguments: { documentId: document.id, baseVersion: 1, message: 'SDK proposal', idempotencyKey: 'sdk-all-tools', content: { ...document, title: 'SDK update' } } });
    const submissionId = (submission.structuredContent as { untrustedData: { submission: { id: string } } }).untrustedData.submission.id;
    expect((await client.callTool({ name: 'get_submission', arguments: { submissionId } })).isError).toBe(false);
    const limited = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(cookie), payload: { scopes: ['read'] } });
    const reader = new Client({ name: 'readonly', version: '1' }); await reader.connect(new StreamableHTTPClientTransport(new URL(`${server}/mcp`), { fetch: pinnedMcpFetch(new URL(`${server}/mcp`), limited.json().token) })); cleanups.push(() => reader.close());
    expect((await reader.callTool({ name: 'reply_comment', arguments: { commentId, body: 'Denied' } })).isError).toBe(true);
    expect((await reader.callTool({ name: 'withdraw_submission', arguments: { submissionId } })).isError).toBe(true);
    db.prepare("UPDATE documents SET ai_enabled=0 WHERE id='d_aaaaaaab'").run();
    expect((await client.callTool({ name: 'reply_comment', arguments: { commentId, body: 'Disabled' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'withdraw_submission', arguments: { submissionId } })).isError).toBe(true);
    db.prepare("UPDATE documents SET ai_enabled=1 WHERE id='d_aaaaaaab'").run();
    expect((await client.callTool({ name: 'withdraw_submission', arguments: { submissionId } })).isError).toBe(false);
    expect((db.prepare("SELECT current_version FROM documents WHERE id='d_aaaaaaab'").get() as { current_version: number }).current_version).toBe(1);
  });

  it('AT-30 runs AI task claims, linked submissions, completion, failure and read-only previews ' +
     'through the SDK relay', async () => {
    const client = await relay();
    const document = (await app.inject({ url: '/api/v1/docs/d_aaaaaaab', headers: headers(cookie) })).json().content;
    const requestTask = async () => (await app.inject({ method: 'POST', url: `/api/v1/docs/${document.id}/comments`, headers: headers(cookie), payload: { body: '@[AI](ai) Improve title', anchor: { moduleId: document.modules[0].id } } })).json().aiTask;
    const unwrap = (result: Awaited<ReturnType<typeof client.callTool>>) => { expect(result.isError).toBe(false); return (result.structuredContent as { untrustedData: Record<string, any> }).untrustedData; };
    const task = await requestTask();
    expect(unwrap(await client.callTool({ name: 'list_ai_tasks', arguments: { documentId: document.id } })).tasks.some((item: { id: string }) => item.id === task.id)).toBe(true);
    const claimed = unwrap(await client.callTool({ name: 'claim_ai_task', arguments: { taskId: task.id } }));
    document.modules[0].title = 'SDK task edit';
    const submitted = unwrap(await client.callTool({ name: 'create_submission', arguments: { documentId: document.id, baseVersion: claimed.task.baseVersion, message: 'Task output', idempotencyKey: 'sdk-task', content: document, aiTaskId: task.id, claimId: claimed.claimId } }));
    expect(unwrap(await client.callTool({ name: 'complete_ai_task', arguments: { taskId: task.id, claimId: claimed.claimId, submissionId: submitted.submission.id } })).task.status).toBe('done');
    const saved = (await app.inject({ method: 'POST', url: `/api/v1/docs/${document.id}/previews`, headers: headers(cookie), payload: { submissionIds: [submitted.submission.id] } })).json().preview;
    const before = db.prepare('SELECT * FROM previews').all();
    expect(unwrap(await client.callTool({ name: 'prepare_preview', arguments: { documentId: document.id, submissionIds: [submitted.submission.id] } })).preview.readOnly).toBe(true);
    expect(unwrap(await client.callTool({ name: 'get_preview', arguments: { previewId: saved.id } })).preview.id).toBe(saved.id);
    expect(db.prepare('SELECT * FROM previews').all()).toEqual(before);
    const failedTask = await requestTask(); const attempt = unwrap(await client.callTool({ name: 'claim_ai_task', arguments: { taskId: failedTask.id } }));
    expect(unwrap(await client.callTool({ name: 'fail_ai_task', arguments: { taskId: failedTask.id, claimId: attempt.claimId, reason: 'Upstream unavailable' } })).task.status).toBe('approved');
  });

  it('AT-30 forwards resolve suggestions with their claim and preserves the human adoption ' +
     'boundary', async () => {
    const client = await relay(); const docId = 'd_aaaaaaab';
    const original = (await app.inject({ url: `/api/v1/docs/${docId}`, headers: headers(cookie) })).json().content;
    const ids: string[] = [];
    for (const title of ['SDK option A', 'SDK option B']) {
      const content = structuredClone(original); content.modules[0].title = title;
      const created = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { ...headers(cookie), 'idempotency-key': title }, payload: { baseVersion: 1, content } }); ids.push(created.json().submission.id);
    }
    const preview = (await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: headers(cookie), payload: { submissionIds: ids } })).json().preview;
    const task = (await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/conflicts/${encodeURIComponent(preview.conflicts[0].id)}/ai-suggest`, headers: headers(cookie), payload: { revision: preview.revision } })).json().task;
    const claim = await client.callTool({ name: 'claim_ai_task', arguments: { taskId: task.id } }); expect(claim.isError).toBe(false);
    const claimId = (claim.structuredContent as { untrustedData: { claimId: string } }).untrustedData.claimId;
    const suggestion = await client.callTool({ name: 'suggest_resolution', arguments: { taskId: task.id, claimId, value: 'SDK combined title', rationale: 'Both proposals are represented.' } }); expect(suggestion.isError).toBe(false);
    const completed = await client.callTool({ name: 'complete_ai_task', arguments: { taskId: task.id, claimId } }); expect(completed.isError).toBe(false);
    expect((db.prepare('SELECT resolutions FROM previews WHERE id=?').get(preview.id) as { resolutions: string }).resolutions).toBe('{}');
    expect((db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId) as { current_version: number }).current_version).toBe(1);
    const listed = await client.callTool({ name: 'list_ai_tasks', arguments: { status: 'done' } }); expect(listed.isError).toBe(false);
    expect((listed.structuredContent as { untrustedData: { tasks: Array<{ id: string }> } }).untrustedData.tasks.some((item) => item.id === task.id)).toBe(true);
  });

  it('AT-30 submits strict operations and module HTML with stable receipts through the SDK', async () => {
    const client=await relay();const docId='d_aaaaaaab';const content=(await app.inject({url:`/api/v1/docs/${docId}`,headers:headers(cookie)})).json().content;
    const args={documentId:docId,baseVersion:1,message:'SDK operations',idempotencyKey:'sdk-operations',ops:[{op:'insert',parent:{id:content.modules[0].id,list:'blocks'},after:null,node:{id:'tmp_sdk',type:'paragraph',text:[{t:'SDK inserted'}]}}]};
    const first=await client.callTool({name:'create_submission',arguments:args});expect(first.isError).toBe(false);expect(await client.callTool({name:'create_submission',arguments:args})).toEqual(first);
    const output=(first.structuredContent as {untrustedData:{idMap:Record<string,string>;opCount:number}}).untrustedData;expect(output.idMap.tmp_sdk).toMatch(/^n_/);expect(output.opCount).toBe(1);
    const read=await client.callTool({name:'read_module',arguments:{documentId:docId,moduleIds:[content.modules[0].id],format:'html'}});
    const html=(read.structuredContent as {untrustedData:{modules:Array<{html:string}>}}).untrustedData.modules[0]!.html.replace(content.modules[0].title,'SDK HTML title');
    const htmlArgs={documentId:docId,baseVersion:1,message:'SDK HTML',idempotencyKey:'sdk-html',moduleHtml:[{moduleId:content.modules[0].id,html}]};
    expect((await client.callTool({name:'create_submission',arguments:htmlArgs})).isError).toBe(false);
    expect((await client.callTool({name:'create_submission',arguments:{...htmlArgs,ops:[]}})).isError).toBe(true);
    const limited=(await app.inject({method:'POST',url:'/api/v1/me/tokens',headers:headers(cookie),payload:{scopes:['read']}})).json().token;
    const reader=new Client({name:'limited-submission',version:'1'});await reader.connect(new StreamableHTTPClientTransport(new URL(`${server}/mcp`),{fetch:pinnedMcpFetch(new URL(`${server}/mcp`),limited)}));cleanups.push(()=>reader.close());
    expect((await reader.callTool({name:'create_submission',arguments:htmlArgs})).isError).toBe(true);
    db.prepare('UPDATE documents SET ai_enabled=0 WHERE id=?').run(docId);expect((await client.callTool({name:'create_submission',arguments:args})).isError).toBe(true);
    expect((db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId) as {current_version:number}).current_version).toBe(1);
  });
  it('AT-30 rechecks revoked credentials and keeps failures on one request from corrupting ' +
     'concurrent calls', async () => {
    const client = await relay();
    const responses = await Promise.allSettled([client.callTool({ name: 'get_spec' }), client.callTool({ name: 'not_a_tool' }), client.callTool({ name: 'list_documents' })]);
    expect(responses.map((response) => response.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    await app.inject({ method: 'DELETE', url: `/api/v1/me/tokens/${tokenId}`, headers: headers(cookie) });
    await expect(client.listTools()).rejects.toThrow('HCD upstream request failed');
    await expect(client.callTool({ name: 'read_document', arguments: { documentId: 'd_aaaaaaab' } })).rejects.toThrow('HCD upstream request failed');
  });
  it('AT-30 works as a real stdio child process with clean JSON-RPC stdout and closes on EOF', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', resolve('packages/cli/src/index.ts'), 'mcp', '--server', server], env: { ...process.env as Record<string, string>, HCD_TOKEN: token }, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const client = new Client({ name: 'stdio-acceptance', version: '1' });
    try {
      await client.connect(transport); expect((await client.listTools()).tools.length).toBeGreaterThan(10);
      expect((await client.callTool({ name: 'get_spec' })).isError).toBe(false);
      await client.close(); expect(stderr).not.toContain(token); expect(stderr).toBe('');
    } finally { await client.close(); }
  });
  it('AT-30 fails initialization cleanly for revoked credentials', async () => {
    db.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').run(new Date().toISOString(), tokenId);
    const [transport] = InMemoryTransport.createLinkedPair(); await expect(createMcpRelay({ server, token }, transport)).rejects.toThrow('Cannot connect to HCD MCP');
  });
});

it('AT-30 pins every HTTP method and rejects redirect responses without leaking credentials', async () => {
  let destinationRequests = 0; const destination = createServer((_request, response) => { destinationRequests++; response.end('{}'); });
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve)); const address = destination.address(); if (!address || typeof address === 'string') throw new Error('fixture');
  const origin = createServer((_request, response) => response.writeHead(307, { location: `http://127.0.0.1:${address.port}/stolen` }).end());
  await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve)); const source = origin.address(); if (!source || typeof source === 'string') throw new Error('fixture');
  const endpoint = new URL(`http://127.0.0.1:${source.port}/mcp`); const request = pinnedMcpFetch(endpoint, 'sensitive-test-token');
  try {
    for (const method of ['POST', 'GET', 'DELETE']) await expect(request(endpoint, { method })).rejects.toThrow();
    await expect(request(new URL('/different', endpoint))).rejects.toThrow('MCP endpoint changed'); expect(destinationRequests).toBe(0);
  } finally { origin.closeAllConnections(); destination.closeAllConnections(); await Promise.all([new Promise<void>((resolve) => origin.close(() => resolve())), new Promise<void>((resolve) => destination.close(() => resolve()))]); }
});
