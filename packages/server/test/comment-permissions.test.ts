import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const docId = 'd_aaaaaaab';
const headers = (cookie = '') => ({ cookie, 'x-hcd-request': '1' });
let app: FastifyInstance; let db: HcdDatabase; let dataDir: string;
let owner: string; let commenter: string; let editor: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hcd-comment-permissions-'));
  db = openDatabase(join(dataDir, 'hcd.sqlite'));
  app = createApp({ dataDir, db, seed: true });
  owner = await login('d@example.com'); commenter = await login('f@example.com'); editor = await login('a@example.com');
});
afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
async function login(email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } });
  expect(response.statusCode).toBe(200); return String(response.headers['set-cookie']).split(';')[0]!;
}
async function comment(cookie: string, body: string, parentId?: string) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/comments`, headers: headers(cookie), payload: { body, parentId } });
  expect(response.statusCode, response.body).toBe(201); return response.json().comment.id as string;
}
const action = (id: string, cookie: string, name = 'resolve') => app.inject({ method: 'POST', url: `/api/v1/comments/${id}/${name}`, headers: headers(cookie) });

it('AT-11 B9 lets an active participant resolve and reopen but rejects nonparticipants, deleted ' +
   'participation and viewers', async () => {
  const id = await comment(owner, 'Root opened by someone else');
  const reply = await comment(commenter, 'I participated', id);
  expect((await action(id, commenter)).statusCode).toBe(200);
  expect((await action(id, commenter, 'reopen')).statusCode).toBe(200);
  expect((await action(id, editor)).statusCode).toBe(403);
  expect((await app.inject({ method: 'DELETE', url: `/api/v1/comments/${reply}`, headers: headers(commenter) })).statusCode).toBe(204);
  expect((await action(id, commenter)).statusCode).toBe(403);
  await comment(commenter, 'I participate again', id);
  for (const table of ['space_members', 'document_members']) db.prepare(`UPDATE ${table} SET role='viewer' WHERE user_id='u_comment000'`).run();
  expect((await action(id, commenter)).statusCode).toBe(403);
  expect((await action(id, owner)).statusCode).toBe(200);
});

it('AT-11 B9 requires explicit comment scope for tokens even when their owner or participant has ' +
   'submit scope', async () => {
  const id = await comment(owner, 'Owner thread');
  const issue = async (scopes: string[]) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { scopes } });
    expect(response.statusCode).toBe(201); return response.json().token as string;
  };
  const submitOnly = await issue(['submit']);
  const commenting = await issue(['comment']);
  const using = (token: string, name: string) => app.inject({ method: 'POST', url: `/api/v1/comments/${id}/${name}`, headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1' } });
  expect((await using(submitOnly, 'resolve')).statusCode).toBe(403);
  expect((await using(commenting, 'resolve')).statusCode).toBe(200);
  expect((await using(submitOnly, 'reopen')).statusCode).toBe(403);
  expect((await using(commenting, 'reopen')).statusCode).toBe(200);
});
