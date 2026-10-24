import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { openDatabase } from '../../server/src/db';
import { cancelLocalReceipt } from './index';
import { inspectSubmissionReceipts, requestFingerprint, submitWithReceipt } from './submission-receipts';
import type { Document } from '../../core/src/model';

describe('CLI cancellation with the HCD API', () => {
  it.each(['pending', 'published'] as const)('recovers a lost response and truthfully settles a %s submission', async status => {
    const root = await mkdtemp(join(tmpdir(), 'hcd-cancel-api-')); const db = openDatabase(':memory:'); const appUrl = 'http://localhost:5173'; const docId = 'd_aaaaaaab';
    const app = createApp({ db, appUrl, renderUrl: 'https://render.test', secretKey: 'cancel-api-test', seed: true, exports: { autoStart: false } });
    try {
      const server = await app.listen({ port: 0, host: '127.0.0.1' });
      const headers = { origin: appUrl, 'x-hcd-request': '1' };
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
      const ownerHeaders = { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0]! };
      const tokenResponse = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: ownerHeaders, payload: { name: 'Cancellation fixture', scopes: ['read', 'submit'] } });
      const token = tokenResponse.json().token as string; expect(token).toBeTypeOf('string');
      db.prepare('DELETE FROM submissions').run(); db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
      const base = JSON.parse((db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(docId) as { content: string }).content) as Document;
      await mkdir(join(root, '.mdoc/base'), { recursive: true });
      await writeFile(join(root, '.mdoc/doc.json'), JSON.stringify({ version: 1, server, documentId: docId, baseVersion: 1, title: base.title, files: [] }));
      await writeFile(join(root, '.mdoc/base/document.json'), JSON.stringify(base));
      const content = { ...base, title: 'Changed by CLI' }; const body = { baseVersion: 1, content, message: 'Cancellation test' };
      const fingerprint = requestFingerprint({ base, body }); let submissionId = '';
      await expect(submitWithReceipt({ root, server, documentId: docId, actorId: login.json().user.id as string, fingerprint, body, send: async (frozen, key) => {
        const result = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/submissions`, headers: { authorization: `Bearer ${token}`, 'x-hcd-request': '1', 'idempotency-key': key }, payload: frozen });
        expect(result.statusCode, result.body).toBe(201); submissionId = result.json().submission.id; throw new Error('Simulated lost response after server commit');
      } })).rejects.toThrow('lost response');
      const before = await inspectSubmissionReceipts(root); const key = before.receipts[0]!.key; expect(before.receipts[0]!.state).toBe('pending');
      if (status === 'published') {
        const built = await app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: ownerHeaders, payload: { submissionIds: [submissionId] } }); expect(built.statusCode, built.body).toBe(200);
        const preview = built.json().preview;
        const published = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.id}/publish`, headers: ownerHeaders, payload: { revision: preview.revision } }); expect(published.statusCode, published.body).toBe(200);
      }
      const otherLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'a@example.com', password: 'hcd-demo-2026' } });
      const otherToken = (await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: { ...headers, cookie: String(otherLogin.headers['set-cookie']).split(';')[0]! }, payload: { scopes: ['read', 'submit'] } })).json().token as string;
      const savedBeforeMismatch = await readFile(join(root, '.mdoc/submissions.json'));
      await expect(cancelLocalReceipt(root, key, { server, token: otherToken })).rejects.toThrow(/author|account/i);
      expect(await readFile(join(root, '.mdoc/submissions.json'))).toEqual(savedBeforeMismatch);
      expect(db.prepare('SELECT count(*) count FROM submissions WHERE doc_id=?').get(docId)).toEqual({ count: 1 });
      const result = await cancelLocalReceipt(root, key, { server, token });
      expect(result).toEqual({ key, submissionId, status: status === 'published' ? 'published' : 'withdrawn' });
      expect(db.prepare('SELECT count(*) count FROM submissions WHERE doc_id=?').get(docId)).toEqual({ count: 1 });
      expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId)).toEqual({ current_version: status === 'published' ? 2 : 1 });
      const ledger = JSON.parse(await readFile(join(root, '.mdoc/submissions.json'), 'utf8'));
      expect(ledger.entries[0].body).toEqual(body); expect(ledger.entries[0].key).toBe(key);
      expect(ledger.entries[0].state).toBe(status === 'published' ? 'submitted' : 'cancelled');
      const repeated = await cancelLocalReceipt(root, key, { server, token }); expect(repeated).toEqual(result);
      // A real read-only command exposes receipt metadata, never the frozen document or credential.
      const listed = await promisify(execFile)(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./index.ts', import.meta.url)), 'receipts', '--json'], { cwd: root });
      expect(JSON.parse(listed.stdout).receipts[0].key).toBe(key); expect(listed.stdout).not.toContain('Changed by CLI'); expect(listed.stdout).not.toContain(token);
    } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
  });
});
