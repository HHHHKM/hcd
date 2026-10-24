import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { registerMcpRoutes } from '../src/mcp';

it('AT-21 B10 preserves document-read scope checks when listing documents without per-document ' +
   'reads', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hcd-mcp-list-scope-'));
  const app = createApp({ dataDir, seed: true, exports: { autoStart: false } });
  registerMcpRoutes(app, { appUrl: 'http://localhost:5173' });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const issue = async (scopes: string[]) => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: { cookie, 'x-hcd-request': '1' }, payload: { scopes } });
      expect(response.statusCode).toBe(201); return `Bearer ${response.json().token}`;
    };
    const list = (authorization: string) => app.inject({ method: 'POST', url: '/mcp', headers: { authorization, accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_documents' } } });
    const tasksOnly = await issue(['ai_tasks']);
    const denied = await list(tasksOnly);
    expect(denied.statusCode).toBe(200);
    expect(denied.json().result.isError).toBe(true);
    expect(JSON.parse(denied.json().result.content[0].text).error.code).toBe('TOKEN_SCOPE');
    expect(denied.body).not.toContain('Q4 增长方案');
    expect((await app.inject({ url: '/api/v1/docs', headers: { authorization: tasksOnly } })).statusCode).toBe(403);
    for (const scope of ['read', 'comment', 'submit', 'preview']) {
      const permitted = await list(await issue([scope]));
      expect(permitted.statusCode).toBe(200);
      expect(permitted.json().result.isError).toBe(false);
      expect(JSON.parse(permitted.json().result.content[0].text).untrustedData.docs.map((doc: { id: string }) => doc.id)).toContain('d_aaaaaaab');
    }
  } finally { await app.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
