import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import type { Document } from '../../core/src/model';

const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
describe('inline image import', () => {
  let app: FastifyInstance; let dataDir: string; let owner: string;
  beforeEach(async () => { dataDir = mkdtempSync(join(tmpdir(), 'hcd-import-images-')); app = createApp({ databasePath: ':memory:', dataDir, seed: true, appUrl: 'http://localhost:5173' }); await app.ready(); owner = await login('d@example.com'); });
  afterEach(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function login(email: string) { const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(result.statusCode).toBe(200); return String(result.headers['set-cookie']).split(';')[0]!; }
  const prepare = (html: string) => app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'images.html', html } });
  it('AT-18 previews deduplicated inline images privately, preserves captions and exports after ' +
     'confirmation', async () => {
    const src = `data:image/png;base64,${png.toString('base64')}`;
    const html = `<h1>Images</h1><p>Before<img src="${src}" alt="First">After</p><figure><img src="${src}" alt="Second"><figcaption>Original caption</figcaption></figure>`;
    const pending = await prepare(html); expect(pending.statusCode, pending.body).toBe(201);
    expect(pending.json().import.report.images).toEqual({ imported: 2, external: 0, missing: 0 });
    const content = pending.json().import.content as Document; const blocks = content.modules.flatMap((module) => module.blocks);
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'image', 'paragraph', 'image']);
    const images = blocks.filter((block) => block.type === 'image'); expect(images[0]!.asset).toBe(images[1]!.asset); expect(images[1]!.caption).toBe('Original caption');
    const url = `/api/v1/imports/${pending.json().import.id}/assets/${images[0]!.asset}`;
    expect((await app.inject({ method: 'GET', url, headers: { cookie: owner } })).rawPayload).toEqual(png);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { cookie: await login('a@example.com') } })).statusCode).toBe(404);
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/imports/${pending.json().import.id}/confirm`, headers: headers(owner), payload: {} }); expect(confirmed.statusCode).toBe(201);
    const exported = await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/export?format=html`, headers: { cookie: owner } }); expect(exported.statusCode).toBe(200); expect(exported.body).toContain(src);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/source`, headers: { cookie: owner } })).body).toBe(html);
  });
  it('AT-09 sanitizes SVG and reports external, missing, invalid and unrelated asset references', async () => {
    const svg = Buffer.from('<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>').toString('base64');
    const pending = await prepare(`<img src="data:image/svg+xml;base64,${svg}"><img src="https://example.invalid/unfetched.png"><img src="asset:as_aaaaaaaaaaaa"><img src="data:image/png;base64,YmFk"><img src="missing.png">`);
    expect(pending.statusCode, pending.body).toBe(201); expect(pending.json().import.report.images).toEqual({ imported: 1, external: 1, missing: 3 });
    const content = pending.json().import.content as Document; const images = content.modules[0]!.blocks.filter((block) => block.type === 'image');
    expect(images.slice(1).every((image) => image.asset === null)).toBe(true);
    const cleaned = await app.inject({ method: 'GET', url: `/api/v1/imports/${pending.json().import.id}/assets/${images[0]!.asset}`, headers: { cookie: owner } });
    expect(cleaned.body).toContain('<rect'); expect(cleaned.body).not.toMatch(/script|onload|alert/);
  });
  it('revokes preview assets when an import is discarded', async () => {
    const pending = await prepare(`<img src="data:image/png;base64,${png.toString('base64')}">`); expect(pending.statusCode).toBe(201);
    const value = pending.json().import;
    expect((await app.inject({ method: 'POST', url: `/api/v1/imports/${value.id}/discard`, headers: headers(owner) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/imports/${value.id}/assets/${value.content.modules[0].blocks[0].asset}`, headers: { cookie: owner } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/imports/${value.id}/confirm`, headers: headers(owner), payload: {} })).statusCode).toBe(409);
  });
});
