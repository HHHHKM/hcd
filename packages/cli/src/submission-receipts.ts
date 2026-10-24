import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalJson, validateDocument, type Document } from '../../core/src/model';
import { OpsSchema, type Op } from '../../core/src/ops';
export type SubmissionBody = { baseVersion: number; message: string } & (
  | { content: Document; ops?: never; moduleHtml?: never; deleteModules?: never }
  | { ops: Op[]; content?: never; moduleHtml?: never; deleteModules?: never }
  | { moduleHtml: Array<{ moduleId?: string; html: string; after?: string | null }>; deleteModules?: string[]; content?: never; ops?: never }
);
export type ReceiptState = 'pending' | 'submitted' | 'cancelling' | 'cancelled';
export type SubmissionStatus = 'pending' | 'published' | 'rejected' | 'withdrawn';
type Receipt = { fingerprint: string; key: string; server: string; documentId: string; authorId?: string; state: ReceiptState; body: SubmissionBody; submissionId?: string; createdAt: string; completedAt?: string; cancellationRequestedAt?: string; cancelledAt?: string; serverStatus?: SubmissionStatus };
type Ledger = { version: 2; entries: Receipt[]; legacyReceipts?: unknown[] };
export type ReceiptSummary = Omit<Receipt, 'body'> & { baseVersion: number; message: string };
export type SubmissionReceiptResponse = { submission: { id: string; docId: string; authorId: string } };
export type CancellationResponse = { submission: SubmissionReceiptResponse['submission'] & { status: SubmissionStatus } };
export type CancellationResult = { key: string; submissionId: string; status: Exclude<SubmissionStatus, 'pending'> };
export const requestFingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const validId = (value: unknown): value is string => typeof value === 'string' && /^sub_[a-zA-Z0-9_-]{8,80}$/.test(value);
const validActor = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validModule = (value: unknown): value is string => typeof value === 'string' && /^m_[a-z2-7]{8}$/.test(value);
function boundedWireJson(value: unknown) {
  const pending: Array<[unknown, number]> = [[value, 0]]; let count = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++count > 100_000 || depth > 64) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') { if (!Number.isFinite(item)) return false; continue; }
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) return false;
      for (const child of item) pending.push([child, depth + 1]);
    } else if (object(item)) {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null || Object.getOwnPropertySymbols(item).length) return false;
      for (const child of Object.values(item)) pending.push([child, depth + 1]);
    } else return false;
  }
  return true;
}
function validBody(value: unknown, documentId: string, mode: 'stored' | 'new') {
  if (!object(value) || !Number.isInteger(value.baseVersion) || (value.baseVersion as number) < 1 || typeof value.message !== 'string') return false;
  const formats = ['content', 'ops', 'moduleHtml'].filter(key => Object.hasOwn(value, key));
  if (formats.length !== 1) return false;
  const format = formats[0]!;
  const keys = new Set(['baseVersion', 'message', format, ...(format === 'moduleHtml' ? ['deleteModules'] : [])]);
  if (Object.keys(value).some(key => !keys.has(key))) return false;
  // Older content receipts could persist long messages or valid documents beyond the newer
  // wire-complexity budget. They must remain inspectable and replayable without transformation,
  // even when the server rejects that exact saved request. JSON.parse has already read the wire value.
  if (!(format === 'content' && mode === 'stored') && (!boundedWireJson(value) || value.message.length > 500)) return false;
  // Validation must never replace the frozen payload with schema output or derive another wire format.
  if (format === 'content') return validateDocument(value.content).ok && object(value.content) && value.content.id === documentId;
  if (format === 'ops') return OpsSchema.safeParse(value.ops).success && !(value.ops as Op[]).some(op => op.uncertain);
  if (!Array.isArray(value.moduleHtml) || value.moduleHtml.length > 100 || value.moduleHtml.some(entry => !object(entry) || Object.keys(entry).some(key => !['moduleId', 'html', 'after'].includes(key)) || typeof entry.html !== 'string' || !entry.html.length || entry.html.length > 500_000 || Object.hasOwn(entry, 'moduleId') && !validModule(entry.moduleId) || Object.hasOwn(entry, 'after') && entry.after !== null && !validModule(entry.after))) return false;
  return !Object.hasOwn(value, 'deleteModules') || Array.isArray(value.deleteModules) && value.deleteModules.length <= 100 && value.deleteModules.every(validModule);
}
async function regularOrAbsent(path: string) { try { if (!(await lstat(path)).isFile()) throw new Error('Submission metadata must be a regular file.'); } catch (error) { if (!absent(error)) throw error; } }
async function directoryFor(root: string, create: boolean) {
  const directory = join(root, '.mdoc');
  if (create) await mkdir(directory, { recursive: true });
  try { const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Refusing symlinked submission metadata.'); }
  catch (error) { if (!create && absent(error)) return null; throw error; }
  return directory;
}
function validReceipt(entry: Receipt, mode: 'stored' | 'new' = 'stored') {
  if (!entry || typeof entry !== 'object' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || typeof entry.key !== 'string' || !entry.key.trim() || entry.key.length > 100 || !['pending', 'submitted', 'cancelling', 'cancelled'].includes(entry.state) || typeof entry.server !== 'string' || !entry.server.trim() || typeof entry.documentId !== 'string' || !/^d_[a-z2-7]{8}$/.test(entry.documentId) || !validBody(entry.body, entry.documentId, mode) || !timestamp(entry.createdAt)) return false;
  if (entry.submissionId !== undefined && !validId(entry.submissionId)) return false;
  if (entry.authorId !== undefined && !validActor(entry.authorId)) return false;
  if (entry.completedAt !== undefined && !timestamp(entry.completedAt) || entry.cancellationRequestedAt !== undefined && !timestamp(entry.cancellationRequestedAt) || entry.cancelledAt !== undefined && !timestamp(entry.cancelledAt)) return false;
  if (entry.serverStatus !== undefined && !['pending', 'published', 'rejected', 'withdrawn'].includes(entry.serverStatus)) return false;
  if (entry.state === 'pending') return entry.submissionId === undefined && entry.completedAt === undefined && entry.cancellationRequestedAt === undefined && entry.cancelledAt === undefined && entry.serverStatus === undefined;
  if (entry.state === 'cancelling') return timestamp(entry.cancellationRequestedAt) && entry.cancelledAt === undefined && (entry.serverStatus === undefined || entry.serverStatus === 'pending');
  if (entry.state === 'cancelled') return validId(entry.submissionId) && timestamp(entry.cancellationRequestedAt) && timestamp(entry.cancelledAt) && entry.serverStatus === 'withdrawn';
  return validId(entry.submissionId) && entry.cancelledAt === undefined && entry.serverStatus !== 'withdrawn';
}
async function load(path: string): Promise<Ledger> {
  await regularOrAbsent(path);
  let value: unknown; try { value = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (absent(error)) return { version: 2, entries: [] }; throw new Error('Submission receipts are unreadable; restore them before retrying.'); }
  if (Array.isArray(value)) return { version: 2, entries: [], legacyReceipts: value };
  const ledger = value as Ledger;
  if (!ledger || ledger.version !== 2 || !Array.isArray(ledger.entries) || ledger.entries.some(entry => !validReceipt(entry)) || ledger.legacyReceipts !== undefined && !Array.isArray(ledger.legacyReceipts) || new Set(ledger.entries.map(entry => entry.key)).size !== ledger.entries.length || ledger.entries.filter(entry => entry.state === 'pending' || entry.state === 'cancelling').length > 1) throw new Error('Submission receipts are invalid; restore them before retrying.');
  return ledger;
}
async function save(path: string, ledger: Ledger) {
  const temporary = `${path}.${randomUUID()}.tmp`; const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(ledger, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  try { await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
}
async function acquire(path: string) {
  try { const file = await open(path, 'wx', 0o600); await file.close(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await regularOrAbsent(path); await chmod(path, 0o600);
  const lock = new Database(path, { timeout: 0 });
  try { lock.exec('BEGIN IMMEDIATE'); }
  catch (error) { lock.close(); if ((error as { code?: string }).code === 'SQLITE_BUSY') throw new Error('Another submit is running for this checkout.'); throw error; }
  // Keep the lock file: unlinking it would let another process lock a different inode.
  return () => { try { lock.exec('ROLLBACK'); } finally { lock.close(); } };
}
/** Inspection does not create files, modify permissions, or expose the frozen document payload. */
export async function inspectSubmissionReceipts(root: string): Promise<{ receipts: ReceiptSummary[]; legacyReceiptCount: number }> {
  const directory = await directoryFor(root, false);
  const ledger = directory ? await load(join(directory, 'submissions.json')) : { version: 2 as const, entries: [] };
  return { receipts: ledger.entries.map(({ body, ...receipt }) => ({ ...receipt, baseVersion: body.baseVersion, message: body.message })), legacyReceiptCount: ledger.legacyReceipts?.length ?? 0 };
}
/** Persist the exact request and key before network I/O; a lost response retries that same request. */
export async function submitWithReceipt(options: { root: string; server: string; documentId: string; actorId: string; fingerprint: string; body: SubmissionBody; retry?: boolean; existingOnly?: boolean; send: (body: SubmissionBody, key: string) => Promise<SubmissionReceiptResponse> }): Promise<string> {
  if (!validActor(options.actorId)) throw new Error('A verified submitting account is required.');
  const directory = (await directoryFor(options.root, true))!;
  const path = join(directory, 'submissions.json'); const release = await acquire(join(directory, 'submission-lock.sqlite'));
  try {
    const ledger = await load(path); const cancelling = ledger.entries.find(entry => entry.state === 'cancelling');
    if (cancelling) { requireReceiptAuthor(cancelling, options.actorId); throw new Error(`Cancellation has an unknown outcome. Run mdoc cancel ${cancelling.key} --yes to finish it before submitting.`); }
    const pending = ledger.entries.find(entry => entry.state === 'pending');
    if (pending && (pending.server !== options.server || pending.documentId !== options.documentId)) throw new Error('Pending receipt belongs to another document or server. Restore the original checkout before retrying.');
    if (pending) requireReceiptAuthor(pending, options.actorId);
    if (pending && !options.retry && pending.fingerprint !== options.fingerprint) throw new Error('An earlier submission has an unknown outcome. Run mdoc submit --retry --yes to resend its saved request before submitting newer edits.');
    if (options.retry && !pending) throw new Error('There is no pending submission to retry.');
    let receipt = pending ?? ledger.entries.find(entry => entry.fingerprint === options.fingerprint && entry.server === options.server && entry.documentId === options.documentId);
    if (receipt) requireReceiptAuthor(receipt, options.actorId);
    if (receipt?.state === 'submitted') return receipt.submissionId!;
    if (receipt?.state === 'cancelled') throw new Error(`This exact request was cancelled (${receipt.submissionId}). It will not be submitted again. Change the local content or message to create a new request.`);
    if (!receipt) {
      if (options.existingOnly) throw new Error('The matching saved request is no longer present. Inspect receipts before submitting again.');
      receipt = { fingerprint: options.fingerprint, key: randomUUID(), server: options.server, documentId: options.documentId, authorId: options.actorId, state: 'pending', body: structuredClone(options.body), createdAt: new Date().toISOString() };
      if (!validReceipt(receipt, 'new')) throw new Error('The submission request cannot be saved as a valid receipt.');
      ledger.entries.push(receipt); await save(path, ledger);
    }
    const result = await options.send(structuredClone(receipt.body), receipt.key);
    if (!result || !validId(result.submission?.id) || result.submission.docId !== options.documentId || result.submission.authorId !== options.actorId) throw new Error('Server returned a mismatched submission receipt; the saved request is still pending.');
    receipt.state = 'submitted'; receipt.submissionId = result.submission.id; receipt.completedAt = new Date().toISOString(); await save(path, ledger);
    return receipt.submissionId;
  } finally { release(); }
}
function requireReceiptAuthor(receipt: Receipt, actorId: string) {
  if (!receipt.authorId) throw new Error('This legacy receipt has no recorded author. Its original account cannot be verified, so the saved request will not be replayed automatically. Keep its payload and key for manual investigation.');
  if (receipt.authorId !== actorId) throw new Error(`Receipt belongs to another account (${receipt.authorId}). Sign in as the original submitting account before retrying or cancelling.`);
}
function checkCancellationResponse(value: CancellationResponse, documentId: string, actorId: string, submissionId?: string) {
  const submission = value?.submission;
  if (!submission || !validId(submission.id) || submission.docId !== documentId || submission.authorId !== actorId || submissionId !== undefined && submission.id !== submissionId || !['pending', 'published', 'rejected', 'withdrawn'].includes(submission.status)) throw new Error('Server returned a mismatched cancellation receipt; cancellation remains unresolved.');
  return submission;
}
/** Resolve the original request before withdrawing it. Never erase an unknown server outcome. */
export async function cancelWithReceipt(options: { root: string; server: string; documentId: string; actorId: string; key: string; recover: (body: SubmissionBody, key: string) => Promise<CancellationResponse>; read: (submissionId: string) => Promise<CancellationResponse>; withdraw: (submissionId: string) => Promise<CancellationResponse> }): Promise<CancellationResult> {
  if (!validActor(options.actorId)) throw new Error('A verified submitting account is required.');
  const directory = await directoryFor(options.root, false);
  if (!directory) throw new Error('Submission receipt not found.');
  const path = join(directory, 'submissions.json'); const release = await acquire(join(directory, 'submission-lock.sqlite'));
  try {
    const ledger = await load(path); const receipt = ledger.entries.find(entry => entry.key === options.key);
    if (!receipt) throw new Error('Submission receipt not found.');
    if (receipt.server !== options.server || receipt.documentId !== options.documentId) throw new Error('Receipt belongs to another document or server. Restore the original checkout before cancelling.');
    if (receipt.authorId) requireReceiptAuthor(receipt, options.actorId);
    else if (!receipt.submissionId) requireReceiptAuthor(receipt, options.actorId);
    const unresolved = ledger.entries.find(entry => entry !== receipt && (entry.state === 'pending' || entry.state === 'cancelling'));
    if (unresolved) throw new Error(`Another request has an unknown outcome. Resolve receipt ${unresolved.key} first.`);
    let verified: CancellationResponse['submission'] | undefined;
    if (!receipt.authorId) {
      // A known immutable submission ID can prove an old receipt's author without replaying its key.
      verified = checkCancellationResponse(await options.read(receipt.submissionId!), receipt.documentId, options.actorId, receipt.submissionId);
      if (receipt.state === 'cancelled' && verified.status !== 'withdrawn') throw new Error('The saved cancellation conflicts with the server state. Keep this receipt for manual investigation.');
      receipt.authorId = options.actorId;
      await save(path, ledger);
    }
    if (receipt.state === 'cancelled') return { key: receipt.key, submissionId: receipt.submissionId!, status: 'withdrawn' };
    receipt.state = 'cancelling'; receipt.cancellationRequestedAt ??= new Date().toISOString(); delete receipt.serverStatus;
    await save(path, ledger);
    if (!receipt.submissionId) {
      const recovered = checkCancellationResponse(await options.recover(structuredClone(receipt.body), receipt.key), receipt.documentId, options.actorId);
      receipt.submissionId = recovered.id; receipt.completedAt ??= new Date().toISOString(); await save(path, ledger);
    }
    let current = verified ?? checkCancellationResponse(await options.read(receipt.submissionId), receipt.documentId, options.actorId, receipt.submissionId);
    if (current.status === 'pending') {
      let withdrawal: CancellationResponse;
      try {
        withdrawal = await options.withdraw(receipt.submissionId);
      } catch (error) {
        // A withdrawal response can be lost, or publication can win the race. Only a verified read settles either case.
        const observed = checkCancellationResponse(await options.read(receipt.submissionId), receipt.documentId, options.actorId, receipt.submissionId);
        if (observed.status === 'pending') throw error;
        withdrawal = { submission: observed };
      }
      current = checkCancellationResponse(withdrawal, receipt.documentId, options.actorId, receipt.submissionId);
    }
    if (current.status === 'pending') throw new Error('The server did not confirm withdrawal; cancellation remains unresolved.');
    receipt.serverStatus = current.status;
    if (current.status === 'withdrawn') { receipt.state = 'cancelled'; receipt.cancelledAt = new Date().toISOString(); }
    else { receipt.state = 'submitted'; }
    await save(path, ledger);
    return { key: receipt.key, submissionId: receipt.submissionId, status: current.status };
  } finally { release(); }
}
