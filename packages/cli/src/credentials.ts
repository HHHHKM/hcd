import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

export type Credential = { server: string; token: string; tokenId?: string; savedAt: string; expiresAt?: string };
export type Credentials = { servers: Credential[] };
export const credentialsPath = (): string => process.platform === 'win32'
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'mdoc', 'credentials.json')
  : join(homedir(), '.config', 'mdoc', 'credentials.json');
export function normalizeServer(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Server URL must be an origin without credentials or a path.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Server URL must use http or https.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS except for localhost development.');
  return url.origin;
}
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
async function ordinary(path: string, directory = false) {
  try { const stat = await lstat(path); if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw new Error('Credentials must use ordinary files and directories.'); }
  catch (error) { if (!absent(error)) throw error; }
}
function validCredential(value: Credential) {
  try { return value && value.server === normalizeServer(value.server) && typeof value.token === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value.token) && typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)) && (value.tokenId === undefined || typeof value.tokenId === 'string') && (value.expiresAt === undefined || Number.isFinite(Date.parse(value.expiresAt))); }
  catch { return false; }
}
export async function readCredentials(path = credentialsPath()): Promise<Credentials> {
  await ordinary(dirname(path), true); await ordinary(path);
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) { if (absent(error)) return { servers: [] }; throw error; }
  try {
    const value = JSON.parse(text) as Credentials;
    if (!value || !Array.isArray(value.servers) || value.servers.length > 100 || value.servers.some(item => !validCredential(item)) || new Set(value.servers.map(item => item.server)).size !== value.servers.length) throw new Error();
    return value;
  } catch { throw new Error('Saved credentials are invalid. Restore the file before changing login information.'); }
}
async function updateCredentials(path: string, update: (value: Credentials) => void) {
  const directory = dirname(path); await ordinary(directory, true); await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, 'credentials-lock.sqlite'); await ordinary(lockPath);
  try { const file = await open(lockPath, 'wx', 0o600); await file.close(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await chmod(lockPath, 0o600); const lock = new Database(lockPath, { timeout: 1000 });
  try {
    lock.exec('BEGIN IMMEDIATE');
    const value = await readCredentials(path); update(value);
    if (value.servers.length > 100 || value.servers.some(item => !validCredential(item))) throw new Error('Invalid credential update.');
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  } finally { if (lock.inTransaction) lock.exec('ROLLBACK'); lock.close(); }
}
export async function saveCredential(credential: Credential, path = credentialsPath()) {
  if (!validCredential(credential)) throw new Error('Invalid credential response.');
  await updateCredentials(path, value => { value.servers = [...value.servers.filter(item => item.server !== credential.server), credential]; });
}
/** Remove only the exact credential we revoked; concurrent replacement must survive logout. */
export async function removeCredential(credential: Credential, path = credentialsPath()) {
  await updateCredentials(path, value => { value.servers = value.servers.filter(item => item.server !== credential.server || item.token !== credential.token); });
}
