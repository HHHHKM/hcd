import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serializeModule } from '../../core/src/spec-html';
import type { Document } from '../../core/src/model';
import { describe, expect, it } from 'vitest';
import { formatChanges } from './change-format';
import type { Change } from '../../core/src/changes';
const base: Change = { kind: 'text', opIndex: 0, moduleId: 'm_aaaaaaaa', moduleTitle: 'Main', targetId: 'n_aaaaaaaa', targetType: 'paragraph', field: 'text' };
describe('mdoc readable changes', () => {
  it('preserves spaces and marks, distinguishes additions/deletions and escapes terminal controls', () => {
    const output = formatChanges({ changes: [{ ...base, segments: [{ type: 'eq', value: [{ t: 'Hello ' }] }, { type: 'del', value: [{ t: 'old' }] }, { type: 'ins', value: [{ t: '\x1b[31mnew', b: true }] }, { type: 'eq', value: [{ t: ' world' }] }] }] });
    expect(output).toContain('Hello [-old-][+**\\u001b[31mnew**+] world'); expect(output).not.toContain('\x1b');
  });
  it('prints move positions, scalar values and coupled data removals', () => {
    const output = formatChanges({ changes: [{ ...base, kind: 'move', from: { parent: { id: 'm_aaaaaaaa', list: 'blocks' }, parentLabel: 'Old', after: null }, to: { parent: { id: 'm_bbbbbbbb', list: 'blocks' }, parentLabel: 'New', after: 'n_bbbbbbbb', afterLabel: 'Anchor' } }, { ...base, kind: 'field', opIndex: 1, before: false, after: true }, { ...base, kind: 'delete', opIndex: 2, coupledBefore: [{ targetId: 'n_cccccccc', field: 'value:n_dddddddd', value: 0 }] }] });
    expect(output).toContain('From: Old / blocks / start'); expect(output).toContain('To: New / blocks / after Anchor'); expect(output).toContain('- false\n+ true'); expect(output).toContain('Also removed:\nn_cccccccc / value:n_dddddddd: 0');
  });
  it('does not call an unavailable comparison unchanged', () => {
    expect(formatChanges({ changes: [], unavailable: 'DISPLAY_REPLAY_MISMATCH' })).toContain('comparison unavailable'); expect(formatChanges({ changes: [] })).toBe('No content differences.\n');
  });
  it.each(['insert', 'delete', 'move'] as const)('escapes C1 terminal controls in %s node snapshots', kind => {
    const node = { id: 'n_bbbbbbbb', type: 'paragraph' as const, text: [{ t: 'before\u009b2Jafter' }] };
    const output = formatChanges({ changes: [{ ...base, kind, nodeBefore: node, nodeAfter: node }] });
    expect(output).toContain('before\\u009b2Jafter'); expect(output).not.toContain('\u009b');
  });
});

it('runs real CLI diff commands with readable output and standalone JSON modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hcd-change-cli-'));
  const document: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'CLI', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Main', blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Hello old world' }] }] }] };
  try {
    await mkdir(join(directory, '.mdoc/base'), { recursive: true });
    await writeFile(join(directory, '.mdoc/base/document.json'), JSON.stringify(document));
    await writeFile(join(directory, '.mdoc/doc.json'), JSON.stringify({ version: 1, server: 'offline-fixture', documentId: document.id, baseVersion: 1, files: [{ id: document.modules[0]!.id, name: '01-Main.html' }] }));
    const edited = structuredClone(document.modules[0]!); edited.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Hello new world' }] }; await writeFile(join(directory, '01-Main.html'), serializeModule(edited));
    const run = async (flags: string[]) => (await promisify(execFile)(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./index.ts', import.meta.url)), 'diff', ...flags], { cwd: directory })).stdout;
    expect(await run([])).toContain('Hello [-old-][+new+] world');
    const json = JSON.parse(await run(['--json'])); expect(json.changes[0]).toMatchObject({ kind: 'text', targetId: 'n_aaaaaaaa' });
    const operations = JSON.parse(await run(['--ops'])); expect(operations[0]).toMatchObject({ op: 'set', at: { id: 'n_aaaaaaaa', field: 'text' } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
