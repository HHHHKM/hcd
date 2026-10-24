import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { unzipSync } from 'fflate';
import { parseSpecDocument } from '../../core/src/spec-html';
import { maxAssetBytes, prepareImage } from '../src/assets';
import type { Document } from '../../core/src/model';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
const multipartBody = (bytes: Buffer, mime: string) => Buffer.concat([Buffer.from(`--hcd-test-boundary\r\nContent-Disposition: form-data; name="file"; filename="../../image.bin"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from('\r\n--hcd-test-boundary--\r\n')]);
describe('document image assets', () => {
  let app: FastifyInstance; let dataDir: string; let owner: string;
  beforeEach(async () => { dataDir = mkdtempSync(join(tmpdir(), 'hcd-assets-')); app = createApp({ databasePath: ':memory:', dataDir, seed: true, appUrl: 'http://localhost:5173' }); await app.ready(); owner = await login('d@example.com'); });
  afterEach(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function login(email: string) { const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(result.statusCode).toBe(200); return String(result.headers['set-cookie']).split(';')[0]!; }
  const upload = (bytes = png, mime = 'image/png', cookie = owner, docId = 'd_aaaaaaab') => app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/assets`, headers: { ...headers(cookie), 'content-type': 'multipart/form-data; boundary=hcd-test-boundary' }, payload: multipartBody(bytes, mime) });

  it('AT-11 deduplicates content on disk while enforcing document and token access', async () => {
    const first = await upload(); expect(first.statusCode).toBe(201); const asset = first.json().asset;
    expect(asset).toMatchObject({ mime: 'image/png', size: png.length }); expect(asset.id).toMatch(/^as_[a-z2-7]{12}$/);
    expect((await upload()).json().asset.id).toBe(asset.id);
    const fileNames = readdirSync(join(dataDir, 'assets'), { recursive: true }).filter((name) => String(name).includes('/')); expect(fileNames).toHaveLength(1);
    const url = first.json().url;
    const fetched = await app.inject({ method: 'GET', url, headers: { cookie: owner } });
    expect(fetched.rawPayload).toEqual(png); expect(fetched.headers['content-type']).toBe('image/png'); expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const other = await app.inject({ method: 'POST', url: '/api/v1/docs', headers: headers(owner), payload: { title: 'Other', spaceId: 'sp_demo000000' } });
    const otherId = other.json().doc.id;
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${otherId}/assets/${asset.id}`, headers: { cookie: owner } })).statusCode).toBe(404);
    const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { scopes: ['read'], docIds: [otherId] } });
    expect((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token.json().token}` } })).statusCode).toBe(404);
    expect((await upload(png, 'image/png', await login('f@example.com'))).statusCode).toBe(403);
  });

  it('AT-09 rejects disguised images and oversized files and sanitizes SVG markup and references', async () => {
    expect((await upload(Buffer.from('<html><script>alert(1)</script></html>'))).statusCode).toBe(415);
    expect((await upload(png, 'image/jpeg')).statusCode).toBe(415);
    expect((await upload(Buffer.alloc(maxAssetBytes + 1), 'image/png')).statusCode).toBe(413);
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><foreignObject><p>unsafe</p></foreignObject><image href="https://evil.test/x"/><a href="javascript:alert(1)">link</a><rect width="10" height="10" fill="url(https://evil.test/x)"/><text x="1" y="9">Safe &amp; sound</text></svg>';
    const result = await upload(Buffer.from(source), 'image/svg+xml'); expect(result.statusCode).toBe(201);
    const cleaned = await app.inject({ method: 'GET', url: result.json().url, headers: { cookie: owner } });
    expect(cleaned.body).toContain('Safe &amp; sound'); expect(cleaned.body).toContain('viewBox="0 0 10 10"');
    expect(cleaned.body).not.toMatch(/script|onload|foreignObject|evil|href|unsafe/); expect(cleaned.headers['content-security-policy']).toContain('sandbox');
    expect(() => prepareImage(Buffer.from('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'), 'image/svg+xml')).toThrow();
  });

  it('AT-36 publishes attached images through review, rejects cross-document references, and ' +
     'embeds bytes in HTML export', async () => {
    const uploaded = await upload(); const asset = uploaded.json().asset.id;
    const fetched = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { cookie: owner } });
    const content = fetched.json().content as Document;
    content.modules[0]!.blocks.push({ id: 'n_zzzzzzzz', type: 'image', asset, alt: 'Uploaded pixel', caption: 'Caption', width: 'small' });
    const other = await app.inject({ method: 'POST', url: '/api/v1/docs', headers: headers(owner), payload: { spaceId: 'sp_demo000000', title: 'Other' } });
    const invalid = await app.inject({ method: 'PUT', url: `/api/v1/docs/${other.json().doc.id}/draft`, headers: headers(owner), payload: { baseVersion: 1, content } });
    expect(invalid.statusCode).toBe(400); expect(invalid.json().error.code).toBe('ASSET_NOT_FOUND');
    const submission = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/submissions', headers: { ...headers(owner), 'idempotency-key': 'with-image' }, payload: { baseVersion: 1, content } });
    expect(submission.statusCode).toBe(201);
    const preview = await app.inject({ method: 'POST', url: '/api/v1/docs/d_aaaaaaab/previews', headers: headers(owner), payload: { submissionIds: [submission.json().submission.id] } });
    expect(preview.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(owner), payload: { revision: preview.json().preview.revision } })).statusCode).toBe(200);
    const html = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/export?format=html', headers: { cookie: owner } });
    expect(html.statusCode).toBe(200); expect(html.body).toContain(`data:image/png;base64,${png.toString('base64')}`); expect(html.body).toContain('Uploaded pixel');
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/export?format=html&v=1', headers: { cookie: owner } })).body).not.toContain('Uploaded pixel');
    const zipped = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/export?format=zip', headers: { cookie: owner } });
    expect(zipped.statusCode).toBe(200); expect(zipped.headers['content-type']).toContain('application/zip'); expect(zipped.headers['content-disposition']).toContain('d_aaaaaaab-v2.zip');
    const archive = unzipSync(zipped.rawPayload); const manifest = JSON.parse(Buffer.from(archive['manifest.json']!).toString()) as { format: string; documentId: string; version: number; modules: Array<{ path: string }>; assets: Array<{ id: string; sha256: string }> };
    expect(manifest).toMatchObject({ format: 'hcd-archive', documentId: 'd_aaaaaaab', version: 2 }); expect(manifest.modules).toHaveLength(content.modules.length); expect(manifest.assets).toHaveLength(1);
    expect(Buffer.from(archive[`assets/${asset}`]!).equals(png)).toBe(true); expect(JSON.parse(Buffer.from(archive['document.json']!).toString())).toMatchObject({ title: 'Q4 增长方案' }); expect(archive['theme.css']).toBeTruthy();
    const moduleHtml = Buffer.from(archive[manifest.modules[0]!.path]!).toString(); const parsed = parseSpecDocument(moduleHtml); expect(parsed.ok).toBe(true); if (parsed.ok) expect(parsed.value.doc.modules).toHaveLength(1);
  });
});
