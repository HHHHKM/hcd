import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { readCredentials, saveCredential, removeCredential, normalizeServer, type Credential } from './credentials';
const roots: string[] = [];
async function path() { const root = await mkdtemp(join(tmpdir(), 'hcd-credentials-')); roots.push(root); return join(root, 'credentials.json'); }
const first: Credential = { server: 'https://first.test', token: 'hcd_pat_fixturefirst', savedAt: '2026-10-23T00:00:00Z' };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('private CLI credential storage', () => {
  it('reads legacy records and atomically preserves other servers with private permissions', async () => {
    const file = await path(); expect(await readCredentials(file)).toEqual({ servers: [] });
    await writeFile(file, JSON.stringify({ servers: [first] }));
    const second = { ...first, server: 'https://second.test', token: 'hcd_pat_second', tokenId: 'tok_fixture', expiresAt: '2026-11-23T00:00:00Z' };
    await saveCredential(second, file); expect((await readCredentials(file)).servers).toEqual([first, second]);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    await saveCredential({ ...first, token: 'hcd_pat_replacement' }, file);
    await removeCredential(first, file);
    expect((await readCredentials(file)).servers).toEqual([second, { ...first, token: 'hcd_pat_replacement' }]);
    await removeCredential(second, file); expect((await readCredentials(file)).servers).toHaveLength(1);
  });
  it('preserves corrupt or duplicate credentials instead of silently overwriting them', async () => {
    const file = await path();
    for (const content of ['broken', JSON.stringify({ servers: [first, first] }), JSON.stringify({ servers: [{ ...first, server: 'https://user:secret@first.test' }] })]) {
      await writeFile(file, content);
      await expect(saveCredential(first, file)).rejects.toThrow('invalid'); expect(await readFile(file, 'utf8')).toBe(content);
    }
  });
  it('refuses symlinked credential files and directories without touching their targets', async () => {
    const file = await path(); const target = await path(); await writeFile(target, 'keep'); await symlink(target, file);
    await expect(saveCredential(first, file)).rejects.toThrow('ordinary'); expect(await readFile(target, 'utf8')).toBe('keep');
    await rm(file); await symlink(join(target, '..'), file);
    await expect(saveCredential(first, join(file, 'other.json'))).rejects.toThrow('ordinary');
  });
  it('does not replace secrets while another process holds the credential lock', async () => {
    const file = await path(); await saveCredential(first, file); const before = await readFile(file);
    const lock = new Database(join(file, '..', 'credentials-lock.sqlite')); lock.exec('BEGIN IMMEDIATE');
    try { await expect(saveCredential({ ...first, token: 'other' }, file)).rejects.toThrow(); expect(await readFile(file)).toEqual(before); }
    finally { lock.exec('ROLLBACK'); lock.close(); }
  });
  it('pins server origins and permits cleartext only on loopback', () => {
    expect(normalizeServer('https://example.test/')).toBe('https://example.test'); expect(normalizeServer('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234');
    for (const value of ['http://example.test', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?token=secret']) expect(() => normalizeServer(value)).toThrow();
  });
});
