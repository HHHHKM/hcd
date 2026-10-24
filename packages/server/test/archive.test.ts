import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { archiveLimits, inspectArchive, sha256 } from '../src/archive';
import { serializeDocument } from '../../core/src/spec-html';
import type { Document } from '../../core/src/model';

const headers = (cookie = '') => ({ cookie, origin: 'http://localhost:5173', 'x-hcd-request': '1' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
const zipped = (files: Record<string, Uint8Array>) => Buffer.from(zipSync(files));
const central = (bytes: Buffer) => bytes.readUInt32LE(bytes.length - 6);

describe('bounded ZIP decoding', () => {
  it('AT-09 rejects unsafe paths and ambiguous file headers', () => {
    for (const path of ['../secret', '/secret', 'a/../secret', 'a\\secret', 'a\x00b', 'e\u0301']) expect(() => inspectArchive(zipped({ [path]: Buffer.from('x') }))).toThrow('IMPORT_ARCHIVE_INVALID');
    const source = zipped({ 'safe.txt': Buffer.from('hello') });
    const mismatched = Buffer.from(source); mismatched[30] = 0x78;
    expect(() => inspectArchive(mismatched)).toThrow();
    const count = Buffer.from(source); count.writeUInt16LE(0, count.length - 14);
    expect(() => inspectArchive(count)).toThrow();
    const corrupted = Buffer.from(source); corrupted.writeUInt32LE(0, central(corrupted) + 16); corrupted.writeUInt32LE(0, 14);
    expect(() => inspectArchive(corrupted)).toThrow();
    const prototypePath = zipped({ 'safe-name': Buffer.from('safe'), 'empty.txt': new Uint8Array() });
    prototypePath.write('__proto__', 30); prototypePath.write('__proto__', central(prototypePath) + 46);
    const files = inspectArchive(prototypePath);
    expect(Object.getPrototypeOf(files)).toBeNull(); expect(Buffer.from(files['__proto__']!).toString()).toBe('safe'); expect(files['empty.txt']).toHaveLength(0);
  });
  it('AT-09 rejects declared and actual inflated sizes above the limit', () => {
    const source = zipped({ 'bomb.txt': Buffer.alloc(2 * 1024 * 1024, 65) });
    source.writeUInt32LE(10, 22); source.writeUInt32LE(10, central(source) + 24);
    expect(() => inspectArchive(source)).toThrow('IMPORT_ARCHIVE_INVALID');
    const excessive = zipped({ 'huge.txt': Buffer.from('x') });
    excessive.writeUInt32LE(archiveLimits.fileBytes + 1, central(excessive) + 24);
    expect(() => inspectArchive(excessive)).toThrow('IMPORT_ARCHIVE_INVALID');
  });
});

describe('HCD archive import and export', () => {
  let app: FastifyInstance; let db: HcdDatabase; let dataDir: string; let owner: string; let base: Document;
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hcd-archive-')); db = openDatabase(':memory:');
    app = createApp({ db, dataDir, seed: true, appUrl: 'http://localhost:5173' }); await app.ready();
    owner = await login('d@example.com');
    base = (await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { cookie: owner } })).json().content;
  });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function login(email: string) { const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } }); expect(result.statusCode).toBe(200); return String(result.headers['set-cookie']).split(';')[0]!; }
  const prepare = (source: Buffer, cookie = owner) => app.inject({ method: 'POST', url: '/api/v1/imports/archive', headers: headers(cookie), payload: { spaceId: 'sp_demo000000', filename: 'document.zip', archiveBase64: source.toString('base64') } });
  function fixture() {
    const first = 'as_aaaaaaaaaaaa'; const second = 'as_bbbbbbbbbbbb'; const content = structuredClone(base);
    content.modules[0]!.blocks.push({ id: 'n_zzzzzzzy', type: 'image', asset: first, alt: 'First', caption: '', width: 'small' }, { id: 'n_zzzzzzzz', type: 'image', asset: second, alt: 'Same bytes', caption: '', width: 'wide' });
    const files: Record<string, Uint8Array> = { 'document.json': Buffer.from(JSON.stringify(content)), 'theme.css': Buffer.from('body{}'), [`assets/${first}`]: png, [`assets/${second}`]: png };
    const modules = content.modules.map((module, i) => { const path = `modules/${i}.html`; files[path] = Buffer.from(serializeDocument({ ...content, modules: [module] })); return { id: module.id, path }; });
    files['manifest.json'] = Buffer.from(JSON.stringify({ format: 'hcd-archive', archiveVersion: 1, documentFile: 'document.json', themeFile: 'theme.css', modules, assets: [first, second].map((id) => ({ id, mime: 'image/png', size: png.length, sha256: sha256(png) })) }));
    return { files, content };
  }
  it('AT-36 stages images, confirms atomically and preserves a complete export/reimport round trip', async () => {
    const { files, content } = fixture(); const source = zipped(files); const pending = await prepare(source);
    expect(pending.statusCode, pending.body).toBe(201);
    expect((db.prepare('SELECT COUNT(*) count FROM assets').get() as { count: number }).count).toBe(0);
    expect(pending.json().import.report.archiveAssets).toBe(1);
    const confirmUrl = `/api/v1/imports/${pending.json().import.id}/confirm`;
    const confirmed = await app.inject({ method: 'POST', url: confirmUrl, headers: headers(owner), payload: {} }); expect(confirmed.statusCode, confirmed.body).toBe(201);
    const imported = confirmed.json().content as Document; expect(imported.id).not.toBe(content.id);
    const images = imported.modules[0]!.blocks.filter((block) => block.type === 'image');
    expect(images).toHaveLength(2); expect(images[0]!.asset).toBe(images[1]!.asset); expect(images[0]!.asset).not.toBe('as_aaaaaaaaaaaa');
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${imported.id}/assets/${images[0]!.asset}`, headers: { cookie: owner } })).rawPayload).toEqual(png);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${imported.id}/source`, headers: { cookie: owner } })).rawPayload).toEqual(source);
    expect((await app.inject({ method: 'POST', url: confirmUrl, headers: headers(owner), payload: {} })).statusCode).toBe(200);
    const exported = await app.inject({ method: 'GET', url: `/api/v1/docs/${imported.id}/export?format=zip`, headers: { cookie: owner } }); expect(exported.statusCode).toBe(200);
    const again = await prepare(exported.rawPayload); expect(again.statusCode, again.body).toBe(201);
    const restored = again.json().import.content as Document;
    const normalize = (doc: Document) => { const copy = structuredClone(doc); copy.id = 'd_aaaaaaaa'; for (const block of copy.modules[0]!.blocks) if (block.type === 'image') block.asset = null; return copy; };
    expect(normalize(restored)).toEqual(normalize(imported));
  });
  it('AT-09 rejects mismatched module content and asset hashes without creating imports', async () => {
    const { files } = fixture(); const corrupt = { ...files, 'assets/as_aaaaaaaaaaaa': Buffer.from('bad') };
    expect((await prepare(zipped(corrupt))).statusCode).toBe(422);
    const content = JSON.parse(Buffer.from(files['document.json']!).toString()) as Document; content.modules[0]!.title = 'Tampered';
    expect((await prepare(zipped({ ...files, 'document.json': Buffer.from(JSON.stringify(content)) }))).statusCode).toBe(422);
    expect((db.prepare('SELECT COUNT(*) count FROM imports').get() as { count: number }).count).toBe(0);
  });
  it('AT-11 rechecks permission at confirmation and prevents scoped tokens from reading imports', async () => {
    const editor = await login('a@example.com'); const pending = await prepare(zipped(fixture().files), editor); expect(pending.statusCode, pending.body).toBe(201);
    db.prepare("DELETE FROM space_members WHERE space_id='sp_demo000000' AND user_id=(SELECT id FROM users WHERE email='a@example.com')").run();
    const confirmation = await app.inject({ method: 'POST', url: `/api/v1/imports/${pending.json().import.id}/confirm`, headers: headers(editor), payload: {} }); expect(confirmation.statusCode).toBe(403);
    const pat = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(editor), payload: { scopes: ['read'] } });
    expect((await app.inject({ method: 'GET', url: `/api/v1/imports/${pending.json().import.id}`, headers: { authorization: `Bearer ${pat.json().token}` } })).statusCode).toBe(403);
  });
});
