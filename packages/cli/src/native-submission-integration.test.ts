import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';
import { openDatabase } from '../../server/src/db';
import type { Document } from '../../core/src/model';
import { pullDocument, submitLocal, compareLocalModules } from './index';
import { inspectSubmissionReceipts, requestFingerprint, submitWithReceipt } from './submission-receipts';

const docId = 'd_aaaaaaab';
const base: Document = { schemaVersion: 1, id: docId, title: 'CLI plan', theme: { id: 'default', version: 1, overrides: {} }, modules: [
  { id: 'm_aaaaaaaa', title: 'Main', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'abcdefghij' }] }] },
  { id: 'm_bbbbbbbb', title: 'Second', blocks: [{ id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: 'Second unchanged content' }] }] },
] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hcd-cli-native-')); const db = openDatabase(':memory:'); const appUrl = 'http://localhost:5173';
  const app = createApp({ db, appUrl, renderUrl: 'https://render.test', secretKey: 'native-cli-test', seed: true, exports: { autoStart: false } });
  try {
    const server = await app.listen({ port: 0, host: '127.0.0.1' }); const headers = { origin: appUrl, 'x-hcd-request': '1' };
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    const ownerHeaders = { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0]! };
    const token = (await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: ownerHeaders, payload: { name: 'Native submit test', scopes: ['read', 'submit'] } })).json().token as string;
    db.prepare('DELETE FROM submissions').run(); db.prepare('UPDATE documents SET ai_enabled=1 WHERE id=?').run(docId);
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base), docId);
    await pullDocument(server, token, docId, root);
    const info = JSON.parse(await readFile(join(root, '.mdoc/doc.json'), 'utf8'));
    return { root, db, app, ownerHeaders, credential: { server, token }, info, close: async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); throw error; }
}

describe('native CLI submissions against the HCD API', () => {
  it.each(['certain', 'uncertain'] as const)('AT-28 preserves identity and the frozen %s request through a lost ' +
                                             'response and newer invalid files', async certainty => {
    const f = await fixture();
    try {
      const file = join(f.root, f.info.files[0].name);
      const original = await readFile(file, 'utf8');
      const html = original.replace(' data-id="n_aaaaaaaa"', '').replace('abcdefghij', certainty === 'certain' ? 'abcdefghij!' : 'abcdezzzzz').replace('</section>', '<p>Entirely fresh unrelated paragraph</p></section>');
      await writeFile(file, html);
      const sourceBefore = await readFile(join(f.root, '.mdoc/base/document.json'));
      const status = await compareLocalModules(f.root, f.info, base);
      expect(status.modules[0]!.blocks[0]!.id).toBe('n_aaaaaaaa');
      const fetch = globalThis.fetch;
      const intercepted = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const response = await fetch(input, init);
        if (init?.method === 'POST' && String(input).endsWith('/submissions')) throw new Error('Response lost after native request commit');
        return response;
      });
      try { await expect(submitLocal(f.root, 'Frozen native edits', true, false, f.credential)).rejects.toThrow('Response lost'); }
      finally { intercepted.mockRestore(); }
      const ledgerPath = join(f.root, '.mdoc/submissions.json');
      const pending = JSON.parse(await readFile(ledgerPath, 'utf8')).entries[0];
      expect(pending.state).toBe('pending'); expect(pending.body.content).toBeUndefined();
      if (certainty === 'certain') {
        expect(pending.body.ops.some((op: { op: string; at?: { id: string } }) => op.op === 'set' && op.at?.id === 'n_aaaaaaaa')).toBe(true);
        expect(pending.body.ops.some((op: { op: string; node?: { id: string } }) => op.op === 'insert' && op.node?.id.startsWith('tmp_'))).toBe(true);
      } else {
        expect(pending.body.ops).toBeUndefined();
        expect(pending.body.moduleHtml.some((entry: { html: string }) => entry.html === html)).toBe(true);
        expect(pending.body.moduleHtml[0].html).not.toContain('n_aaaaaaaa');
      }
      const before = f.db.prepare('SELECT id,content,operations,id_map FROM submissions WHERE doc_id=?').all(docId) as Array<{ id: string; content: string; operations: string; id_map: string }>;
      expect(before).toHaveLength(1); const submitted = JSON.parse(before[0]!.content) as Document;
      expect(submitted.modules[0]!.blocks[0]!.id).toBe('n_aaaaaaaa');
      expect(submitted.modules[0]!.blocks[1]!.id).toMatch(/^n_[a-z2-7]{8}$/);
      expect(JSON.parse(before[0]!.operations).some((op: { uncertain?: boolean }) => op.uncertain)).toBe(certainty === 'uncertain');
      await writeFile(file, 'Newer invalid local edit must not replace the frozen request');
      const id = await submitLocal(f.root, 'Ignored retry message', true, true, f.credential);
      expect(id).toBe(before[0]!.id);
      expect(f.db.prepare('SELECT id,content,operations,id_map FROM submissions WHERE doc_id=?').all(docId)).toEqual(before);
      const settled = JSON.parse(await readFile(ledgerPath, 'utf8')).entries[0];
      expect(settled.body).toEqual(pending.body); expect(settled.key).toBe(pending.key); expect(settled.state).toBe('submitted');
      expect(await readFile(join(f.root, '.mdoc/base/document.json'))).toEqual(sourceBefore);
      await writeFile(file, html);
      expect(await submitLocal(f.root, 'Frozen native edits', true, false, f.credential)).toBe(id);
      expect(f.db.prepare('SELECT count(*) count FROM submissions WHERE doc_id=?').get(docId)).toEqual({ count: 1 });
      const view = await f.app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/previews`, headers: f.ownerHeaders, payload: { submissionIds: [id] } });
      expect(view.statusCode, view.body).toBe(200); const preview = view.json().preview;
      expect(preview.publishable).toBe(certainty === 'certain');
      if (certainty === 'uncertain') expect(preview.conflicts.some((conflict: { kind: string }) => conflict.kind === 'uncertain')).toBe(true);
      expect(f.db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId)).toEqual({ current_version: 1 });
    } finally { await f.close(); }
  });

  it('AT-28 reuses a frozen legacy JSON request before the newer parser rejects its unchanged ' +
     'source files', async () => {
    const f = await fixture();
    try {
      const file = join(f.root, f.info.files[0].name);
      await writeFile(file, (await readFile(file, 'utf8')).replace('<section ', '<section data-old-client="preserved" '));
      const sourceSnapshot = await Promise.all(f.info.files.map(async (entry: { name: string }) => ({ name: entry.name, html: await readFile(join(f.root, entry.name), 'utf8') })));
      const message = 'Original JSON client';
      const body = { baseVersion: 1, content: { ...base, title: 'Exact legacy snapshot' }, message };
      const fingerprint = requestFingerprint({ server: f.credential.server, documentId: docId, baseVersion: 1, base, sourceSnapshot, message });
      const actorId = (await f.app.inject({ url: '/api/v1/me', headers: { authorization: `Bearer ${f.credential.token}` } })).json().user.id as string;
      await expect(submitWithReceipt({ root: f.root, server: f.credential.server, documentId: docId, actorId, fingerprint, body, send: async () => { throw new Error('Old client disconnected'); } })).rejects.toThrow('disconnected');
      const before = JSON.parse(await readFile(join(f.root, '.mdoc/submissions.json'), 'utf8')).entries[0];
      await expect(compareLocalModules(f.root, f.info, base)).rejects.toThrow(/lossy|unsupported/i);
      const id = await submitLocal(f.root, message, true, false, f.credential);
      const after = JSON.parse(await readFile(join(f.root, '.mdoc/submissions.json'), 'utf8')).entries[0];
      expect(after.key).toBe(before.key); expect(after.body).toEqual(body); expect(after.body.ops).toBeUndefined();
      const stored = f.db.prepare('SELECT content FROM submissions WHERE id=?').get(id) as { content: string };
      expect(JSON.parse(stored.content)).toEqual(body.content);
      expect(await submitLocal(f.root, message, true, false, f.credential)).toBe(id);
    } finally { await f.close(); }
  });

  it('AT-28 keeps a previewable working copy but rejects uncertain module reorders before creating ' +
     'a receipt or submission', async () => {
    const f = await fixture();
    try {
      const file = join(f.root, f.info.files[0].name);
      await writeFile(file, (await readFile(file, 'utf8')).replace(' data-id="n_aaaaaaaa"', '').replace('abcdefghij', 'abcdezzzzz'));
      await rename(join(f.root, f.info.files[1].name), join(f.root, '00-Second.html'));
      const status = await compareLocalModules(f.root, f.info, base);
      expect(status.modules.map(module => module.id)).toEqual(['m_bbbbbbbb', 'm_aaaaaaaa']); expect(status.warnings.length).toBeGreaterThan(0);
      await expect(submitLocal(f.root, 'Cannot be atomic', true, false, f.credential)).rejects.toThrow(/uncertain|reorder/i);
      expect((await inspectSubmissionReceipts(f.root)).receipts).toEqual([]);
      expect(await readdir(join(f.root, '.mdoc'))).not.toContain('submissions.json');
      expect(f.db.prepare('SELECT count(*) count FROM submissions WHERE doc_id=?').get(docId)).toEqual({ count: 0 });
    } finally { await f.close(); }
  });
});
