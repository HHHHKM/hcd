import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { generateLocalPreview } from './local-preview';
import type { Document } from '../../core/src/model';
import { serializeModule } from '../../core/src/spec-html';

const roots: string[] = [];
const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: '<Local title>', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Plan', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Unsaved local edit', b: true }] }] }] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
async function directory() { const root = await mkdtemp(join(tmpdir(), 'hcd-preview-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('local working-copy preview', () => {
  it('renders an offline standalone document, marks it local, escapes markup and writes privately', async () => {
    const root = await directory(); const before = structuredClone(base);
    const result = await generateLocalPreview({ root, document: base, baseVersion: 2, locale: 'en' });
    const html = await readFile(result.path, 'utf8');
    expect(html).toContain('Local working copy preview'); expect(html).toContain('Based on version v2');
    expect(html).toContain('&lt;Local title&gt;'); expect(html).toContain('<strong>Unsaved local edit</strong>');
    expect(html).toContain("script-src 'none'"); expect(result.assetCount).toBe(0); expect(base).toEqual(before);
    if (process.platform !== 'win32') expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  });

  it('downloads assets once per identity, sanitizes raw content, embeds assets and never leaks the token to signed URLs', async () => {
    const root = await directory(); let origin = ''; let imageReads = 0; let rawAuthorization: string | undefined; let revoked = false;
    const server = createServer((request, response) => {
      if (request.url === '/signed-raw') { rawAuthorization = request.headers.authorization; response.setHeader('content-type', 'text/html'); response.end('<h1 onclick="evil()">Raw note</h1><script>secret()</script><img src="https://outside.test/pixel">'); return; }
      expect(request.headers.authorization).toBe('Bearer fixture-token');
      if (revoked) { response.writeHead(403).end('denied'); return; }
      if (request.url?.endsWith('/url')) response.setHeader('content-type', 'application/json').end(JSON.stringify({ url: `${origin}/signed-raw` }));
      else { imageReads++; response.setHeader('content-type', 'image/png').end(png); }
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture failed'); origin = `http://127.0.0.1:${address.port}`;
    const document = structuredClone(base); document.modules[0]!.blocks.push(
      { id: 'n_aaaaaaab', type: 'image', asset: 'as_aaaaaaaaaaaa', alt: 'First', caption: '', width: 'normal' },
      { id: 'n_aaaaaaac', type: 'cards', perRow: 2, items: [{ id: 'n_aaaaaaad', title: 'Nested', blocks: [{ id: 'n_aaaaaaae', type: 'image', asset: 'as_aaaaaaaaaaaa', alt: 'Again', caption: '', width: 'normal' }, { id: 'n_aaaaaaaf', type: 'raw', asset: 'as_bbbbbbbbbbbb', height: 200, note: 'Static note', allowScripts: false }] }, { id: 'n_aaaaaaag', title: 'Second card', blocks: [] }] },
    );
    try {
      const options = { root, document, baseVersion: 1, credential: { server: origin, token: 'fixture-token' } };
      const result = await generateLocalPreview(options); const html = await readFile(result.path, 'utf8');
      expect(result.assetCount).toBe(2); expect(imageReads).toBe(1); expect(rawAuthorization).toBeUndefined();
      expect(html.match(/data:image\/png;base64/g)).toHaveLength(2); expect(html).toContain('Raw note'); expect(html).toContain('sandbox=""');
      for (const forbidden of ['fixture-token', '/signed-raw', 'outside.test', 'onclick', 'secret()']) expect(html).not.toContain(forbidden);
      const files = await readdir(join(root, '.mdoc/assets')); expect(files).toHaveLength(2);
      expect(await readFile(join(root, '.mdoc/assets', files.find(name => name.endsWith('.png'))!))).toEqual(png);
      revoked = true;
      await expect(generateLocalPreview(options)).rejects.toThrow('403');
      expect(await readFile(result.path, 'utf8')).toBe(html);
    } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  });

  it.each(['mime', 'oversized', 'redirect'] as const)('rejects %s image responses and preserves the prior preview', async mode => {
    const root = await directory(); const original = await generateLocalPreview({ root, document: base, baseVersion: 1 }); const before = await readFile(original.path);
    const server = createServer((_request, response) => {
      if (mode === 'redirect') { response.writeHead(302, { location: 'https://outside.test/asset' }).end(); return; }
      response.setHeader('content-type', mode === 'mime' ? 'text/html' : 'image/png');
      if (mode === 'oversized') response.setHeader('content-length', 11 * 1024 * 1024);
      response.end(png);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture failed');
    const document = structuredClone(base); document.modules[0]!.blocks.push({ id: 'n_aaaaaaab', type: 'image', asset: 'as_aaaaaaaaaaaa', alt: '', caption: '', width: 'normal' });
    try {
      await expect(generateLocalPreview({ root, document, baseVersion: 1, credential: { server: `http://127.0.0.1:${address.port}`, token: 'fixture' } })).rejects.toThrow();
      expect(await readFile(original.path)).toEqual(before);
    } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  });

  it('rejects symlinked preview metadata and requires credentials for referenced assets', async () => {
    const root = await directory(); const outside = await directory(); await symlink(outside, join(root, '.mdoc'));
    await expect(generateLocalPreview({ root, document: base, baseVersion: 1 })).rejects.toThrow('ordinary'); expect(await readdir(outside)).toEqual([]);
    const document = structuredClone(base); document.modules[0]!.blocks.push({ id: 'n_aaaaaaab', type: 'image', asset: 'as_aaaaaaaaaaaa', alt: '', caption: '', width: 'normal' });
    await expect(generateLocalPreview({ root: outside, document, baseVersion: 1 })).rejects.toThrow('Log in');
  });

  it('runs mdoc preview --no-open against edited checkout files without a browser', async () => {
    const root = await directory(); await mkdir(join(root, '.mdoc/base'), { recursive: true });
    await writeFile(join(root, '.mdoc/base/document.json'), JSON.stringify(base));
    await writeFile(join(root, '.mdoc/doc.json'), JSON.stringify({ version: 1, server: 'https://offline-preview.invalid', documentId: base.id, baseVersion: 3, title: base.title, files: [{ id: base.modules[0]!.id, name: '01-Plan.html' }] }));
    const html = serializeModule(base.modules[0]!).replace('Unsaved local edit', 'Changed on disk'); await writeFile(join(root, '01-Plan.html'), html);
    const result = await promisify(execFile)(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./index.ts', import.meta.url)), 'preview', '--no-open', '--locale', 'en'], { cwd: root });
    expect(result.stdout).toContain('Local preview:'); expect(result.stdout).toContain('Downloaded 0 unique asset(s)');
    const preview = await readFile(join(root, '.mdoc/preview.html'), 'utf8'); expect(preview).toContain('Changed on disk'); expect(preview).toContain('Based on version v3');
    expect(await readFile(join(root, '01-Plan.html'), 'utf8')).toBe(html);
    expect(JSON.parse(await readFile(join(root, '.mdoc/base/document.json'), 'utf8'))).toEqual(base);
  });
});
