import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
const tokenIn = (url: string) => new URL(url).pathname.split('/').at(-1)!;
describe('read-only document sharing', () => {
  let app: FastifyInstance; let db: HcdDatabase; let owner = ''; let dataDir = '';
  beforeEach(async () => { dataDir = mkdtempSync(join(tmpdir(), 'hcd-share-')); db = openDatabase(':memory:'); app = createApp({ dataDir, db, seed: true, secretKey: 'share-links-integration-secret', appUrl: 'http://localhost:5173' }); await app.ready(); owner = await login('d@example.com'); });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function login(email: string) { const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(response.statusCode).toBe(200); return String(response.headers['set-cookie']).split(';')[0]!; }
  async function create(body: Record<string, unknown> = {}) { const response = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/share-links', headers: headers(owner), payload: { role: 'viewer', ...body } }); return response; }

  it('AT-32 creates high-entropy one-time links, pins published versions and requires a document ' +
     'owner', async () => {
    const link = await create({ versionPin: 1, expiresInDays: 7, showComments: false });
    expect(link.statusCode).toBe(201); expect(link.json().link.url).toMatch(/^http:\/\/localhost:5173\/s\/[A-Za-z0-9_-]{43}$/);
    expect(link.json().link).toMatchObject({ versionPin: 1, showComments: false, commenterAvailable: false });
    const token = tokenIn(link.json().link.url); const stored = db.prepare('SELECT token_hash FROM share_links WHERE id=?').get(link.json().link.id) as { token_hash: string };
    expect(stored.token_hash).not.toBe(token); expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    const editor = await login('a@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/share-links', headers: { cookie: editor } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/share-links', headers: { ...headers(owner), authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { scopes: ['submit'] } })).json().token}` }, payload: { role: 'viewer' } })).statusCode).toBe(403);
    const mutate = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...headers(editor), 'idempotency-key': 'new-share-version' }, payload: { baseVersion: 1, content: { ...(await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { cookie: editor } })).json().content, title: 'New released title' } } });
    expect(mutate.statusCode).toBe(201);
    const preview = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: headers(owner), payload: { submissionIds: [mutate.json().submission.id] } });
    await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(owner), payload: { revision: preview.json().preview.revision } });
    const pinned = await app.inject({ method: 'GET', url: `/api/v1/s/${token}/doc` });
    expect(pinned.statusCode).toBe(200); expect(pinned.json().doc.version).toBe(1); expect(pinned.json().content.title).toBe('Q4 增长方案'); expect(pinned.json().doc.title).toBe('Q4 增长方案'); expect(pinned.headers['cache-control']).toBe('no-store'); expect(pinned.headers['referrer-policy']).toBe('no-referrer');
    expect((await app.inject({ method: 'GET', url: `/api/v1/s/${token}/comments` })).json().error.code).toBe('COMMENTS_HIDDEN');
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab' })).statusCode).toBe(401);
  });

  it('AT-32 renders current versions, exposes only open discussions and revokes every route ' +
     'immediately', async () => {
    const comment = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/comments', headers: headers(await login('a@example.com')), payload: { body: 'Visible to link readers' } });
    expect(comment.statusCode).toBe(201);
    const closed = await app.inject({ method: 'POST', url: `/api/v1/comments/${comment.json().comment.id}/resolve`, headers: headers(owner), payload: {} }); expect(closed.statusCode).toBe(200);
    const link = await create({ showComments: true }); const token = tokenIn(link.json().link.url);
    const document = await app.inject({ method: 'GET', url: `/api/v1/s/${token}/doc` });
    expect(document.json().doc.version).toBe(1); expect(document.json().doc.showComments).toBe(true);
    const discussions = await app.inject({ method: 'GET', url: `/api/v1/s/${token}/comments` }); expect(discussions.statusCode).toBe(200); expect(discussions.json().threads.some((thread: { root: { id: string } }) => thread.root.id === comment.json().comment.id)).toBe(false); expect(discussions.json().threads.every((thread: { root: { status: string } }) => thread.root.status === 'open')).toBe(true);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
    const multipart = Buffer.concat([Buffer.from('--img\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n'), image, Buffer.from('\r\n--img--\r\n')]);
    const upload = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/assets', headers: { ...headers(owner), 'content-type': 'multipart/form-data; boundary=img' }, payload: multipart });
    const asset = upload.json().asset.id;
    expect((await app.inject({ method: 'GET', url: `/api/v1/s/${token}/assets/${asset}` })).statusCode).toBe(404);
    const pin = tokenIn((await create({ versionPin: 1 })).json().link.url);
    const content = (await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { cookie: owner } })).json().content;
    content.modules[0].blocks.push({ id: 'n_zzzzzzzz', type: 'image', asset, alt: 'Published pixel', caption: '', width: 'small' });
    const submission = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...headers(owner), 'idempotency-key': 'shared-asset' }, payload: { baseVersion: 1, content } }); expect(submission.statusCode).toBe(201);
    const preview = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: headers(owner), payload: { submissionIds: [submission.json().submission.id] } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(owner), payload: { revision: preview.json().preview.revision } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/s/${pin}/assets/${asset}` })).statusCode).toBe(404);
    const publicAsset = await app.inject({ method: 'GET', url: `/api/v1/s/${token}/assets/${asset}` }); expect(publicAsset.rawPayload).toEqual(image); expect(publicAsset.headers['content-disposition']).toBe('inline');
    await app.inject({ method: 'POST', url: `/api/v1/docs/d_aaaaaaab/share-links/${link.json().link.id}`, headers: headers(owner), payload: {} }).then((result) => expect(result.statusCode).toBe(404));
    const revoked = await app.inject({ method: 'DELETE', url: `/api/v1/docs/d_aaaaaaab/share-links/${link.json().link.id}`, headers: headers(owner) }); expect(revoked.statusCode).toBe(204);
    for (const path of [`doc`, `comments`, `assets/${asset}`]) expect((await app.inject({ method: 'GET', url: `/api/v1/s/${token}/${path}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/share-links', headers: { cookie: owner } })).json().links.find((item: { id: string }) => item.id === link.json().link.id)).toMatchObject({ active: false });
  });

  it('AT-32 rejects impossible pins, malformed inputs, unsupported commenter links, and expiry', async () => {
    expect((await create({ role: 'invalid' })).statusCode).toBe(400);
    expect((await create({ versionPin: 999 })).json().error.code).toBe('VERSION_NOT_FOUND');
    expect((await create({ expiresInDays: 91 })).statusCode).toBe(400);
    expect((await create({ role: 'commenter' })).statusCode).toBe(503);
    const link = await create(); const token = tokenIn(link.json().link.url);
    db.prepare('UPDATE share_links SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', link.json().link.id);
    expect((await app.inject({ method: 'GET', url: `/api/v1/s/${token}/doc` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_zzzzzzzz/share-links', headers: { cookie: owner } })).statusCode).toBe(404);
  });
});
