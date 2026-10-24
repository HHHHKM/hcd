import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Document } from '../../core/src/model';
import type { HcdDatabase } from './db';
import { createAssetStore } from './assets';
import { buildExport, ExportError, maxExportBytes } from './export-content';

export type ExportJob = { id: string; doc_id: string; version: number; format: 'html' | 'pdf' | 'zip'; include_pending: number; snapshot: string | null; excluded_ids: string; locale: 'zh-CN' | 'en'; status: string; filename: string | null; mime: string | null; size: number | null; error: string | null; attempts: number; created_by: string; token_hash: string | null; created_at: string; expires_at: string };
export type ExportOptions = { exporterUrl?: string; request?: typeof fetch; now?: () => number };
export function canAccessExport(db: HcdDatabase, job: ExportJob, userId = job.created_by, now = Date.now()) {
  if (job.created_by !== userId || Date.parse(job.expires_at) <= now) return false;
  const user = db.prepare('SELECT is_admin FROM users WHERE id=? AND disabled_at IS NULL').get(userId) as { is_admin: number } | undefined;
  const doc = db.prepare('SELECT space_id,ai_enabled FROM documents WHERE id=?').get(job.doc_id) as { space_id: string; ai_enabled: number } | undefined;
  if (!user || !doc) return false;
  const roles = db.prepare('SELECT role FROM document_members WHERE doc_id=? AND user_id=? UNION SELECT role FROM space_members WHERE space_id=? AND user_id=?').all(job.doc_id, userId, doc.space_id, userId) as Array<{ role: string }>;
  if (!user.is_admin && !roles.some(({ role }) => !job.include_pending || role !== 'viewer')) return false;
  if (job.token_hash) {
    const token = db.prepare('SELECT scopes,doc_ids FROM api_tokens WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').get(job.token_hash, userId, new Date(now).toISOString()) as { scopes: string; doc_ids: string | null } | undefined;
    if (!token || !doc.ai_enabled || !(JSON.parse(token.scopes) as string[]).includes('read') || (token.doc_ids && !(JSON.parse(token.doc_ids) as string[]).includes(job.doc_id))) return false;
  }
  return true;
}
async function pdf(html: Buffer, options: ExportOptions) {
  if (!options.exporterUrl) throw new ExportError('EXPORTER_NOT_CONFIGURED');
  const origin = new URL(options.exporterUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new ExportError('EXPORTER_CONFIG_INVALID');
  const signal = AbortSignal.timeout(60000);
  const response = await (options.request ?? fetch)(new URL('/pdf', origin), { method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'text/html; charset=utf-8' }, body: new Uint8Array(html) });
  if (!response.ok || !/^application\/pdf(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new ExportError('EXPORTER_RESPONSE_INVALID');
  const reader = response.body?.getReader(); if (!reader) throw new ExportError('EXPORTER_RESPONSE_INVALID');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const value = await reader.read(); if (value.done) break; size += value.value.length; if (size > 50 * 1024 * 1024) { await reader.cancel(); throw new ExportError('EXPORT_TOO_LARGE'); } chunks.push(value.value); }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new ExportError('EXPORTER_RESPONSE_INVALID');
  return { bytes, mime: 'application/pdf' };
}
export function createExportWorker(db: HcdDatabase, dataDir: string, options: ExportOptions = {}) {
  const now = options.now ?? Date.now; const iso = () => new Date(now()).toISOString();
  const directory = join(dataDir, 'exports'); const assets = createAssetStore(db, dataDir);
  let running: Promise<number> | null = null; let stopping = false; let lastCleanup = 0;
  const filenameValid = (name: string) => /^ex_[a-z2-7]{12}\.[a-f0-9]{32}\.(?:html|pdf|zip)(?:\.tmp)?$/.test(name);
  async function cleanup() {
    db.prepare("UPDATE exports SET status='expired',snapshot=NULL,error='EXPORT_EXPIRED',lease_token=NULL,lease_until=NULL WHERE expires_at<=? AND status<>'expired'").run(iso());
    const expired = db.prepare("SELECT id,filename FROM exports WHERE status='expired' AND filename IS NOT NULL").all() as Array<{ id: string; filename: string }>;
    for (const job of expired) { if (filenameValid(job.filename)) await rm(join(directory, job.filename), { force: true }); db.prepare('UPDATE exports SET filename=NULL WHERE id=?').run(job.id); }
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of files) {
      if (!filenameValid(name)) continue;
      const file = join(directory, name); const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < now() - 86400000 && !db.prepare('SELECT 1 FROM exports WHERE filename=?').get(name)) await rm(file, { force: true });
    }
  }
  async function process() {
    if (now() - lastCleanup >= 60000) { await cleanup(); lastCleanup = now(); }
    let count = 0;
    for (let index = 0; index < 10 && !stopping; index++) {
      const lease = randomBytes(16).toString('hex');
      const job = db.transaction(() => {
        db.prepare("UPDATE exports SET status='failed',error='EXPORT_INTERRUPTED',lease_token=NULL,lease_until=NULL,snapshot=NULL WHERE status='running' AND lease_until<=? AND attempts>=3").run(iso());
        if (db.prepare("SELECT 1 FROM exports WHERE status='running' AND lease_until>?").get(iso())) return undefined;
        const row = db.prepare("SELECT * FROM exports WHERE (status='queued' OR (status='running' AND lease_until<=?)) AND expires_at>? ORDER BY created_at,id LIMIT 1").get(iso(), iso()) as ExportJob | undefined;
        if (!row) return undefined;
        db.prepare("UPDATE exports SET status='running',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?").run(lease, new Date(now() + 90000).toISOString(), row.id);
        return row;
      })();
      if (!job) break;
      const filename = `${job.id}.${lease}.${job.format}`; const file = join(directory, filename); let stored = false;
      const ownsLease = () => Boolean(db.prepare("SELECT 1 FROM exports WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").get(job.id, lease, iso()));
      const eligible = () => ownsLease() && canAccessExport(db, job, job.created_by, now());
      const heartbeat = setInterval(() => { try { db.prepare("UPDATE exports SET lease_until=? WHERE id=? AND status='running' AND lease_token=?").run(new Date(now() + 90000).toISOString(), job.id, lease); } catch { /* Finalization also requires the lease. */ } }, 20000); heartbeat.unref();
      try {
        if (!eligible()) throw new ExportError('EXPORT_ACCESS_REVOKED');
        if (!job.snapshot) throw new ExportError('EXPORT_SNAPSHOT_MISSING');
        const document = JSON.parse(job.snapshot) as Document;
        const rendered = await buildExport(document, job.version, job.format === 'zip' ? 'zip' : 'html', assets, job.locale, job.created_at, Boolean(job.include_pending));
        if (!eligible()) throw new ExportError('EXPORT_ACCESS_REVOKED');
        const result = job.format === 'pdf' ? await pdf(rendered.bytes, options) : rendered;
        if (!eligible()) throw new ExportError('EXPORT_ACCESS_REVOKED');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, result.bytes, { flag: 'wx', mode: 0o600 }); await rename(`${file}.tmp`, file);
        if (!eligible()) throw new ExportError('EXPORT_ACCESS_REVOKED');
        stored = Boolean(db.prepare("UPDATE exports SET status='done',filename=?,mime=?,size=?,snapshot=NULL,error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?").run(filename, result.mime, result.bytes.length, job.id, lease).changes);
        if (stored) count++;
      } catch (error) {
        const code = error instanceof ExportError ? error.code : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'EXPORT_TIMEOUT' : 'EXPORT_FAILED';
        db.prepare("UPDATE exports SET status='failed',error=?,snapshot=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?").run(code, job.id, lease);
      } finally {
        clearInterval(heartbeat);
        if (!stored) { await rm(file, { force: true }); await rm(`${file}.tmp`, { force: true }); }
      }
    }
    return count;
  }
  return {
    tick() { if (!running) running = process().finally(() => { running = null; }); return running; },
    async stop() { stopping = true; if (running) await running; }, cleanup,
    async read(job: ExportJob, userId: string) {
      if (job.status !== 'done' || !job.filename || !filenameValid(job.filename) || !job.mime || !canAccessExport(db, job, userId, now())) return null;
      const file = join(directory, job.filename); const info = await stat(file).catch(() => null);
      if (!info || info.size > maxExportBytes || info.size !== job.size) return null;
      const bytes = await readFile(file);
      if (!canAccessExport(db, job, userId, now())) return null;
      return { bytes, mime: job.mime, filename: `${job.doc_id}-v${job.version}${job.include_pending ? '-pending' : ''}.${job.format}` };
    },
  };
}
