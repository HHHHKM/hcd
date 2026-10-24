import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Document } from '../../core/src/model';
const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });

describe('published comment anchors', () => {
  it('AT-08 relocates on publish, records deleted/lost states, notifies once, and allows owner ' +
     'relocation', async () => {
    const app = createApp({ databasePath: ':memory:', seed: true, appUrl: 'http://localhost:5173' });
    try {
      const login = async (email: string) => { const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(response.statusCode).toBe(200); return String(response.headers['set-cookie']).split(';')[0]!; };
      const owner = await login('d@example.com'); const admin = await login('admin@example.com'); const editor = await login('a@example.com');
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'anchor.html', html: '<h2>First</h2><p>right target end</p><h2>Second</h2><p>Stay</p>' } });
      const imported = await app.inject({ method: 'POST', url: `/api/v1/imports/${prepared.json().import.id}/confirm`, headers: headers(owner), payload: {} });
      expect(imported.statusCode).toBe(201);
      const content = imported.json().content as Document; const id = content.id; let version = 1;
      const firstModule = content.modules[0]!; const secondModule = content.modules[1]!;
      const add = (anchor: unknown) => app.inject({ method: 'POST', url: `/api/v1/docs/${id}/comments`, headers: headers(editor), payload: { body: 'Anchored note', anchor } });
      expect((await add({ quote: 'x'.repeat(501) })).statusCode).toBe(400);
      expect((await add({ moduleId: 'm_missing' })).statusCode).toBe(400);
      const created = await add({ moduleId: firstModule.id, blockId: firstModule.blocks[0]!.id, field: 'text', quote: 'target', prefix: 'right ', suffix: ' end', version });
      expect(created.statusCode).toBe(201); const commentId = created.json().comment.id;
      const publish = async () => {
        const submitted = await app.inject({ method: 'POST', url: `/api/v1/docs/${id}/submissions`, headers: { ...headers(owner), 'idempotency-key': `anchor-v${version}` }, payload: { content, baseVersion: version } }); expect(submitted.statusCode).toBe(201);
        const preview = await app.inject({ method: 'POST', url: `/api/v1/docs/${id}/previews`, headers: headers(admin), payload: { submissionIds: [submitted.json().submission.id] } }); expect(preview.statusCode).toBe(200);
        const result = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(admin), payload: { revision: preview.json().preview.revision } }); expect(result.statusCode).toBe(200); version++;
      };
      const thread = async () => (await app.inject({ method: 'GET', url: `/api/v1/docs/${id}/comments?status=all`, headers: { cookie: owner } })).json().threads[0];
      const paragraph = firstModule.blocks[0]!; if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
      paragraph.text = [{ t: 'right targat end' }]; await publish();
      expect(await thread()).toMatchObject({ anchorState: 'ok', range: { start: 6, end: 12 }, root: { anchor: { quote: 'targat', version: 2 } } });
      firstModule.blocks = []; await publish(); expect((await thread()).anchorState).toBe('block_deleted');
      content.modules = [secondModule]; await publish(); expect((await thread()).anchorState).toBe('lost');
      expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${id}/comments?status=relocate`, headers: { cookie: owner } })).json().threads).toHaveLength(1);
      content.title = 'Still lost'; await publish();
      const notifications = (await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie: owner } })).json().notifications;
      expect(notifications.filter((notification: { kind: string }) => notification.kind === 'anchor_lost')).toHaveLength(1);
      const relocate = (cookie: string) => app.inject({ method: 'POST', url: `/api/v1/comments/${commentId}/relocate`, headers: headers(cookie), payload: { anchor: { moduleId: secondModule.id } } });
      expect((await relocate(editor)).statusCode).toBe(403); expect((await relocate(owner)).statusCode).toBe(200);
      expect((await thread()).anchorState).toBe('ok');
      expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${id}/comments?status=relocate`, headers: { cookie: owner } })).json().threads).toHaveLength(0);
    } finally { await app.close(); }
  });
});
