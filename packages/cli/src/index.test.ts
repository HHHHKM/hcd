import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareLocalModules, downloadQueuedExport, pullDocument, safeModuleFilename } from './index';
import { applyOpsStrict, createCounterIdSource, diffDocuments, createCounterTmpIdSource, serializeModule, validateDocument, type Document, type Module } from '../../core/src/index';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('mdoc local sync', () => {
  it('AT-28 creates stable, safe, unique module filenames', () => {
    const names = new Set<string>();
    expect(safeModuleFilename(0, '../策略/目标', names)).toBe('01-策略目标.html');
    expect(safeModuleFilename(1, '../策略/目标', names)).toBe('02-策略目标.html');
  });

  it('AT-28 detects changed, added, and deleted module files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hcd-mdoc-')); roots.push(root);
    await mkdir(join(root, '.mdoc', 'base'), { recursive: true });
    const baseModule: Module = { id: 'm_aaaaaaaa', title: 'Original', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'base' }] }] };
    const deletedModule: Module = { id: 'm_bbbbbbbb', title: 'Delete', blocks: [] };
    const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Doc', theme: { id: 'default', version: 1, overrides: {} }, modules: [baseModule, deletedModule] };
    const info = { version: 1 as const, server: 'http://localhost:3000', documentId: base.id, baseVersion: 1, title: base.title, files: [{ id: baseModule.id, name: '01-Original.html' }, { id: 'm_bbbbbbbb', name: '02-Delete.html' }] };
    await writeFile(join(root, '01-Original.html'), '<section data-module data-id="m_aaaaaaaa"><h2 data-role="module-title">Changed</h2><p data-id="n_aaaaaaaa">base</p></section>');
    await writeFile(join(root, '03-New.html'), '<section data-module><h2 data-role="module-title">New</h2><p>added</p></section>');
    const result = await compareLocalModules(root, info, base);
    expect(result.modified).toEqual(['01-Original.html']);
    expect(result.deleted).toEqual(['02-Delete.html']);
    expect(result.added).toEqual(['03-New.html']);
    expect(result.modules).toHaveLength(2);
  });
  it('AT-28 tracks renamed modules by ID, detects reorder-only changes and produces move ' +
     'operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hcd-mdoc-move-')); roots.push(root);
    const first: Module = { id: 'm_aaaaaaaa', title: 'First', blocks: [] };
    const second: Module = { id: 'm_bbbbbbbb', title: 'Second', blocks: [] };
    const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Doc', theme: { id: 'default', version: 1, overrides: {} }, modules: [first, second] };
    const info = { version: 1 as const, server: 'http://localhost:3000', documentId: base.id, baseVersion: 1, title: base.title, files: [{ id: first.id, name: '01-First.html' }, { id: second.id, name: '02-Second.html' }] };
    await writeFile(join(root, '01-First.html'), serializeModule(first)); await writeFile(join(root, '02-Second.html'), serializeModule(second));
    await rename(join(root, '02-Second.html'), join(root, '00-Second.html'));
    const status = await compareLocalModules(root, info, base);
    expect(status.deleted).toEqual([]); expect(status.added).toEqual([]); expect(status.modified).toEqual([]); expect(status.moved).toHaveLength(2); expect(status.renamed).toEqual(['00-Second.html']);
    const operations = diffDocuments(base, { ...base, modules: status.modules }, createCounterTmpIdSource('cli'));
    expect(operations).toEqual([expect.objectContaining({ op: 'move' })]);
    const applied = applyOpsStrict(base, operations, createCounterIdSource()); expect(applied.ok).toBe(true); if (applied.ok) expect(applied.value.doc.modules.map((module) => module.id)).toEqual([second.id, first.id]);
  });
  it('AT-28 assigns IDs to new nested blocks and refuses duplicate IDs instead of silently ' +
     'replacing identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hcd-mdoc-new-')); roots.push(root);
    const base: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Doc', theme: { id: 'default', version: 1, overrides: {} }, modules: [] };
    const info = { version: 1 as const, server: 'http://localhost:3000', documentId: base.id, baseVersion: 1, title: base.title, files: [] };
    await writeFile(join(root, '01-New.html'), '<section data-module><h2 data-role="module-title">New</h2><p>Added paragraph</p><ul><li>Nested item</li></ul></section>');
    const status = await compareLocalModules(root, info, base);
    expect(validateDocument({ ...base, modules: status.modules }).ok).toBe(true);
    await writeFile(join(root, '01-New.html'), '<section data-module data-id="m_aaaaaaaa"><p data-id="n_aaaaaaaa">One</p></section>');
    await writeFile(join(root, '02-Copy.html'), '<section data-module data-id="m_bbbbbbbb"><p data-id="n_aaaaaaaa">Copied ID</p></section>');
    await expect(compareLocalModules(root, info, base)).rejects.toThrow('Duplicate ID');
    await rm(join(root, '02-Copy.html'));
    await writeFile(join(root, '01-New.html'), '<section data-module><p data-id="n_aaaaaaaa">One</p><p data-id="n_aaaaaaaa">Two</p></section>');
    await expect(compareLocalModules(root, info, base)).rejects.toThrow('Duplicate IDs');
  });

});

it('AT-36 polls export jobs, preserves binary downloads and never forwards the PAT to the render ' +
   'URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hcd-cli-export-')); roots.push(root);
  const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff, 0x80]); let origin = ''; let failed = false; let polls = 0; const bodies: unknown[] = []; let leakedToken: string | undefined;
  const server = createServer(async (request, response) => {
    if (request.url === '/signed-download') { leakedToken = request.headers.authorization; response.end(bytes); return; }
    if (request.headers.authorization !== 'Bearer fixture-PAT') { response.writeHead(401).end(); return; }
    let body = ''; for await (const part of request) body += part.toString();
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST') { expect(request.headers['x-hcd-request']).toBe('1'); bodies.push(JSON.parse(body)); response.end(JSON.stringify({ export: { id: 'ex_fixture', status: failed ? 'failed' : 'queued', error: failed ? 'EXPORT_FAILED' : undefined } })); }
    else { polls++; response.end(JSON.stringify({ export: { id: 'ex_fixture', status: 'done', downloadUrl: `${origin}/signed-download` } })); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture'); origin = `http://127.0.0.1:${address.port}`;
  try {
    const path = join(root, 'document.zip'); await downloadQueuedExport({ server: origin, token: 'fixture-PAT' }, 'd_aaaaaaaa', 'zip', path, 3);
    expect(await readFile(path)).toEqual(bytes); expect(bodies).toEqual([{ format: 'zip', version: 3 }]); expect(polls).toBe(1); expect(leakedToken).toBeUndefined();
    failed = true; await expect(downloadQueuedExport({ server: origin, token: 'fixture-PAT' }, 'd_aaaaaaaa', 'zip', path)).rejects.toThrow('EXPORT_FAILED'); expect(await readFile(path)).toEqual(bytes); expect(await readdir(root)).toEqual(['document.zip']);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});


it('AT-28 pull refuses unrelated files or local reorders, refreshes removed modules, and honors ' +
   'force', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hcd-cli-pull-')); roots.push(root);
  const modules: Module[] = [{ id: 'm_aaaaaaaa', title: 'First', blocks: [] }, { id: 'm_bbbbbbbb', title: 'Second', blocks: [] }];
  let content: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Doc', theme: { id: 'default', version: 1, overrides: {} }, modules };
  const server = createServer((_request, response) => response.setHeader('content-type', 'application/json').end(JSON.stringify({ doc: { currentVersion: 1, title: content.title }, content })));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await writeFile(join(root, 'unrelated.txt'), 'Keep me');
    await expect(pullDocument(origin, 'fixture', content.id, root)).rejects.toThrow('not empty'); expect(await readFile(join(root, 'unrelated.txt'), 'utf8')).toBe('Keep me');
    await rm(join(root, 'unrelated.txt')); await pullDocument(origin, 'fixture', content.id, root);
    await rename(join(root, '02-Second.html'), join(root, '00-Second.html'));
    await expect(pullDocument(origin, 'fixture', content.id, root)).rejects.toThrow('Local changes');
    await pullDocument(origin, 'fixture', content.id, root, true); expect(await readdir(root)).not.toContain('00-Second.html');
    content = { ...content, modules: [modules[0]!] }; await pullDocument(origin, 'fixture', content.id, root);
    expect(await readdir(root)).not.toContain('02-Second.html'); expect(await readdir(root)).toContain('01-First.html');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('AT-28 refuses a symlinked module instead of silently interpreting it as a deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hcd-cli-symlink-')); roots.push(root);
  const document: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Doc', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [] }] };
  const info = { version: 1 as const, server: 'http://localhost:3000', documentId: document.id, baseVersion: 1, title: document.title, files: [{ id: 'm_aaaaaaaa', name: '01-Main.html' }] };
  await writeFile(join(root, 'source.txt'), serializeModule(document.modules[0]!));
  await symlink(join(root, 'source.txt'), join(root, '01-Main.html'));
  await expect(compareLocalModules(root, info, document)).rejects.toThrow('ordinary files');
  expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe(serializeModule(document.modules[0]!));
});
