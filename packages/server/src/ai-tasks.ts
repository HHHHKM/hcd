import type { Op } from '../../core/src/ops';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalJson, type Document } from '../../core/src/model';
import type { HcdDatabase } from './db';

export class AiTaskError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) { super(code); }
}
export type AiTask = {
  id: string; doc_id: string; requested_by: string | null; guest_id: string | null; kind: string; status: string;
  instruction: string; module_ids: string; result: string | null; claimed_by: string | null; claimed_token: string | null;
  claim_id: string | null; claim_expires_at: string | null; claimed_at: string | null; comment_id: string | null;
  preview_revision: number | null; preview_id: string | null; conflict_id: string | null; conflict_fingerprint: string | null; result_claim_id: string | null;
  approved_by: string | null; attempts: number; base_version: number | null; last_error: string | null; created_at: string; updated_at: string;
};
export type TaskWorker = { userId: string; tokenId: string };
const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex')}`;
export const taskStatuses = ['requested', 'approved', 'claimed', 'done', 'failed', 'rejected', 'cancelled'];
export function getAiTask(db: HcdDatabase, taskId: string): AiTask {
  const task = db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(taskId) as AiTask | undefined;
  if (!task) throw new AiTaskError(404, 'NOT_FOUND');
  return task;
}
export function publicAiTask(task: AiTask) {
  return { id: task.id, docId: task.doc_id, requestedBy: task.requested_by ?? task.guest_id, kind: task.kind,
    status: task.status, instruction: task.instruction, moduleIds: JSON.parse(task.module_ids) as string[],
    result: task.result ? JSON.parse(task.result) : undefined, claimedBy: task.claimed_by, approvedBy: task.approved_by,
    attempts: task.attempts, baseVersion: task.base_version, claimedAt: task.claimed_at, claimExpiresAt: task.claim_expires_at,
    previewRevision: task.preview_revision, previewId: task.preview_id, conflictId: task.conflict_id, commentId: task.comment_id, lastError: task.last_error, createdAt: task.created_at, updatedAt: task.updated_at };
}
function notify(db: HcdDatabase, task: AiTask, event: string, now: string, extra: Record<string, unknown> = {}) {
  if (task.requested_by) db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(id('nt'), task.requested_by, task.doc_id, event, JSON.stringify({ taskId: task.id, attempt: task.attempts, ...extra }), now);
}
export function addSystemReply(db: HcdDatabase, commentId: string, body: string, now: string, submissionId: string | null = null) {
  const root = db.prepare('SELECT * FROM comments WHERE id=? AND parent_id IS NULL AND deleted_at IS NULL').get(commentId) as { doc_id: string; thread_id: string; status: string } | undefined;
  if (root) db.prepare('INSERT INTO comments(id,doc_id,thread_id,parent_id,body,anchor,status,created_at,related_submission,created_version) VALUES(?,?,?,?,?,?,?,?,?,(SELECT current_version FROM documents WHERE id=?))').run(id('cm'), root.doc_id, root.thread_id, commentId, body, '{}', root.status, now, submissionId, root.doc_id);
}
function finishAttempt(db: HcdDatabase, task: AiTask, reason: string, at: string, status: 'failed' | 'expired') {
  db.prepare('UPDATE ai_task_attempts SET status=?,reason=?,finished_at=? WHERE claim_id=? AND status=\'claimed\'').run(status, reason, at, task.claim_id);
  db.prepare(`UPDATE ai_tasks SET status=?,last_error=?,updated_at=?,claim_id=NULL,claimed_token=NULL,claim_expires_at=NULL WHERE id=? AND status='claimed'`).run(task.attempts >= 3 ? 'failed' : 'approved', reason, at, task.id);
  notify(db, task, 'ai_task_failed', at, { reason, retrying: task.attempts < 3 });
}
/** Sweep separately from rejected worker transactions so an error cannot undo lease expiry. */
export function expireAiTasks(db: HcdDatabase, now = Date.now()) {
  const at = new Date(now).toISOString();
  return db.transaction(() => {
    const tasks = db.prepare("SELECT * FROM ai_tasks WHERE status='claimed' AND (claim_expires_at IS NULL OR claim_expires_at<=?)").all(at) as AiTask[];
    for (const task of tasks) finishAttempt(db, task, 'CLAIM_EXPIRED', at, 'expired');
    return tasks.length;
  })();
}
export function claimAiTask(db: HcdDatabase, taskId: string, worker: TaskWorker, now = Date.now()) {
  expireAiTasks(db, now);
  return db.transaction(() => {
    const task = getAiTask(db, taskId);
    if (task.status !== 'approved' || task.attempts >= 3) throw new AiTaskError(409, 'TASK_STATE_CONFLICT');
    if (!['edit', 'resolve'].includes(task.kind)) throw new AiTaskError(409, 'TASK_KIND_UNSUPPORTED');
    const conflict = task.kind === 'resolve' ? taskConflict(db, task).conflict : undefined;
    const source = db.prepare('SELECT d.current_version,v.content FROM documents d JOIN versions v ON v.doc_id=d.id AND v.version=d.current_version WHERE d.id=?').get(task.doc_id) as { current_version: number; content: string };
    const modules = JSON.parse(task.module_ids) as string[];
    const content = JSON.parse(source.content) as Document;
    if (task.kind === 'edit' && (!modules.length || new Set(modules).size !== modules.length || modules.some((moduleId) => !content.modules.some((module) => module.id === moduleId)))) throw new AiTaskError(409, 'TASK_MODULES_UNAVAILABLE');
    const claimId = id('cl'); const at = new Date(now).toISOString(); const until = new Date(now + 30 * 60000).toISOString();
    const changed = db.prepare(`UPDATE ai_tasks SET status='claimed',claimed_by=?,claimed_token=?,claim_id=?,claimed_at=?,claim_expires_at=?,base_version=?,attempts=attempts+1,last_error=NULL,result=NULL,result_claim_id=NULL,updated_at=? WHERE id=? AND status='approved' AND attempts<3`).run(worker.userId, worker.tokenId, claimId, at, until, source.current_version, at, taskId);
    if (!changed.changes) throw new AiTaskError(409, 'TASK_STATE_CONFLICT');
    db.prepare("INSERT INTO ai_task_attempts(claim_id,task_id,attempt,user_id,token_id,base_version,status,started_at,expires_at) VALUES(?,?,?,?,?,?,'claimed',?,?)").run(claimId, taskId, task.attempts + 1, worker.userId, worker.tokenId, source.current_version, at, until);
    return { task: publicAiTask(getAiTask(db, taskId)), claimId, ...(conflict ? { conflict } : {}) };
  })();
}
function assertWorker(task: AiTask, worker: TaskWorker, claimId: unknown) {
  if (typeof claimId !== 'string' || task.claimed_by !== worker.userId || task.claimed_token !== worker.tokenId || task.claim_id !== claimId) throw new AiTaskError(409, 'TASK_CLAIM_MISMATCH');
}
export function activeAiClaim(db: HcdDatabase, taskId: string, worker: TaskWorker, claimId: unknown, now = Date.now()) {
  const task = getAiTask(db, taskId);
  assertWorker(task, worker, claimId);
  if (task.status !== 'claimed' || !task.claim_expires_at || Date.parse(task.claim_expires_at) <= now) throw new AiTaskError(409, 'TASK_CLAIM_EXPIRED');
  return task;
}
export function validateTaskSubmission(db: HcdDatabase, taskId: string, worker: TaskWorker, claimId: unknown, docId: string, baseVersion: number, content: Document, ops?: Op[] | null) {
  const task = activeAiClaim(db, taskId, worker, claimId);
  if (task.doc_id !== docId || task.kind !== 'edit' || task.base_version !== baseVersion) throw new AiTaskError(409, 'TASK_BASE_MISMATCH');
  const base = JSON.parse((db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(docId, baseVersion) as { content: string }).content) as Document;
  const allowed = new Set(JSON.parse(task.module_ids) as string[]); const violations: string[] = [];
  const { modules: baseModules, ...baseMeta } = base; const { modules: nextModules, ...nextMeta } = content;
  if (canonicalJson(baseMeta) !== canonicalJson(nextMeta)) violations.push('/document');
  if (canonicalJson(baseModules.map((module) => module.id)) !== canonicalJson(nextModules.map((module) => module.id))) violations.push('/modules/order');
  for (const module of baseModules) if (!allowed.has(module.id) && canonicalJson(module) !== canonicalJson(nextModules.find((next) => next.id === module.id))) violations.push(`/modules/${module.id}`);
  if (ops) {
    const ancestry = new Map<string, string>();
    const scan = (value: unknown, moduleId: string) => { if (Array.isArray(value)) { value.forEach((item) => scan(item, moduleId)); return; } if (!value || typeof value !== 'object') return; const node = value as Record<string, unknown>; if (typeof node.id === 'string') ancestry.set(node.id, moduleId); Object.values(node).forEach((child) => scan(child, moduleId)); };
    base.modules.forEach((module) => scan(module, module.id));
    ops.forEach((op, index) => {
      const target = op.op === 'set' ? op.at.id : op.op === 'insert' ? op.parent.id : op.target;
      const destination = op.op === 'insert' || op.op === 'move' ? op.parent.id : undefined;
      if (!allowed.has(ancestry.get(target) ?? '') || (destination && !allowed.has(ancestry.get(destination) ?? '')) || ((op.op === 'delete' || op.op === 'move') && base.modules.some((module) => module.id === target)) || ((op.op === 'insert' || op.op === 'move') && op.parent.list === 'modules')) violations.push(`/ops/${index}`);
      if (op.op === 'insert') scan(op.node, ancestry.get(op.parent.id) ?? '');
      if (op.op === 'move' && destination && ancestry.has(destination)) ancestry.set(op.target, ancestry.get(destination)!);
    });
  }
  if (violations.length) throw new AiTaskError(403, 'TOKEN_SCOPE', { paths: violations, moduleIds: [...allowed] });
  return task;
}
export function completeAiTask(db: HcdDatabase, taskId: string, worker: TaskWorker, claimId: unknown, submissionId: unknown, now = Date.now()) {
  expireAiTasks(db, now);
  return db.transaction(() => {
    const task = getAiTask(db, taskId); assertWorker(task, worker, claimId);
    if (task.status === 'done' && task.result && (task.kind === 'resolve' ? submissionId === undefined : JSON.parse(task.result).submissionId === submissionId)) return publicAiTask(task);
    activeAiClaim(db, taskId, worker, claimId, now);
    if (task.kind === 'resolve') {
      if (submissionId !== undefined) throw new AiTaskError(400, 'VALIDATION_FAILED');
      taskConflict(db, task);
      if (!task.result || task.result_claim_id !== claimId) throw new AiTaskError(409, 'SUGGESTION_REQUIRED');
      const at = new Date(now).toISOString();
      db.prepare("UPDATE ai_tasks SET status='done',updated_at=? WHERE id=?").run(at, taskId);
      db.prepare("UPDATE ai_task_attempts SET status='done',finished_at=? WHERE claim_id=?").run(at, claimId);
      notify(db, task, 'ai_task_done', at);
      return publicAiTask(getAiTask(db, taskId));
    }
    if (typeof submissionId !== 'string') throw new AiTaskError(400, 'SUBMISSION_REQUIRED');
    const submission = db.prepare("SELECT 1 FROM submissions WHERE id=? AND doc_id=? AND author_id=? AND ai_task_id=? AND ai_claim_id=? AND created_token=? AND status IN ('pending','published')").get(submissionId, task.doc_id, worker.userId, taskId, claimId, worker.tokenId);
    if (!submission) throw new AiTaskError(422, 'TASK_SUBMISSION_MISMATCH');
    const at = new Date(now).toISOString();
    db.prepare("UPDATE ai_tasks SET status='done',result=?,updated_at=? WHERE id=?").run(JSON.stringify({ submissionId }), at, taskId);
    db.prepare("UPDATE ai_task_attempts SET status='done',submission_id=?,finished_at=? WHERE claim_id=?").run(submissionId, at, claimId);
    if (task.comment_id) addSystemReply(db, task.comment_id, `AI 已生成提交 ${submissionId}，等待人工审核。 / AI submission ${submissionId} is awaiting human review.`, at, submissionId);
    notify(db, task, 'ai_task_done', at, { submissionId });
    return publicAiTask(getAiTask(db, taskId));
  })();
}
export function failAiTask(db: HcdDatabase, taskId: string, worker: TaskWorker, claimId: unknown, reason: unknown, now = Date.now()) {
  expireAiTasks(db, now);
  return db.transaction(() => {
    const task = activeAiClaim(db, taskId, worker, claimId, now);
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new AiTaskError(400, 'VALIDATION_FAILED');
    finishAttempt(db, task, reason.trim(), new Date(now).toISOString(), 'failed');
    return publicAiTask(getAiTask(db, taskId));
  })();
}

type StoredConflict = { id: string; moduleId: string | null; allowed: string[]; base?: unknown; current?: unknown; incoming?: unknown };
type StoredPreview = { id: string; doc_id: string; base_version: number; revision: number; status: string; submission_ids: string; resolutions: string; conflicts: string };
export type SuggestedResolution = { choice: 'keep_current' | 'take_incoming' | 'manual'; value?: unknown; aiTaskId?: string };
function currentConflict(db: HcdDatabase, previewId: string, conflictId: string) {
  const preview = db.prepare('SELECT * FROM previews WHERE id=?').get(previewId) as StoredPreview | undefined;
  if (!preview) throw new AiTaskError(404, 'NOT_FOUND');
  const doc = db.prepare('SELECT current_version FROM documents WHERE id=?').get(preview.doc_id) as { current_version: number };
  if (preview.status !== 'open' || preview.base_version !== doc.current_version || (JSON.parse(preview.submission_ids) as string[]).some((id) => !db.prepare("SELECT 1 FROM submissions WHERE id=? AND doc_id=? AND status='pending'").get(id, preview.doc_id))) throw new AiTaskError(409, 'PREVIEW_STALE');
  const conflict = (JSON.parse(preview.conflicts) as StoredConflict[]).find((item) => item.id === conflictId);
  if (!conflict || Object.hasOwn(JSON.parse(preview.resolutions), conflictId)) throw new AiTaskError(409, 'PREVIEW_STALE');
  const fingerprint = createHash('sha256').update(canonicalJson({ previewId, docId: preview.doc_id, baseVersion: preview.base_version, revision: preview.revision, submissionIds: JSON.parse(preview.submission_ids), resolutions: JSON.parse(preview.resolutions), conflict })).digest('hex');
  return { preview, conflict, fingerprint };
}
export function taskConflict(db: HcdDatabase, task: AiTask) {
  if (task.kind !== 'resolve' || !task.preview_id || !task.conflict_id) throw new AiTaskError(409, 'TASK_KIND_MISMATCH');
  const value = currentConflict(db, task.preview_id, task.conflict_id);
  if (value.preview.doc_id !== task.doc_id || value.fingerprint !== task.conflict_fingerprint) throw new AiTaskError(409, 'PREVIEW_STALE');
  return value;
}
export function createResolveAiTask(db: HcdDatabase, previewId: string, conflictId: string, userId: string, instruction: string, revision: unknown) {
  return db.transaction(() => {
    const { preview, conflict, fingerprint } = currentConflict(db, previewId, conflictId);
    if (conflict.allowed.includes('accept')) throw new AiTaskError(409, 'HUMAN_IDENTITY_REVIEW_REQUIRED');
    if (!conflict.allowed.some(choice => ['keep_current', 'take_incoming', 'manual'].includes(choice))) throw new AiTaskError(409, 'HUMAN_STRUCTURE_REVIEW_REQUIRED');
    if (revision !== preview.revision) throw new AiTaskError(409, 'PREVIEW_REVISION_STALE');
    const existing = db.prepare("SELECT id FROM ai_tasks WHERE preview_id=? AND conflict_id=? AND conflict_fingerprint=? AND status IN ('approved','claimed','done') ORDER BY created_at DESC LIMIT 1").get(previewId, conflictId, fingerprint) as { id: string } | undefined;
    if (existing) return publicAiTask(getAiTask(db, existing.id));
    const taskId = id('at'); const now = new Date().toISOString();
    db.prepare("INSERT INTO ai_tasks(id,doc_id,requested_by,kind,status,instruction,module_ids,preview_id,conflict_id,conflict_fingerprint,preview_revision,approved_by,created_at,updated_at) VALUES(?,?,?,'resolve','approved',?,?,?,?,?,?,?,?,?)").run(taskId, preview.doc_id, userId, instruction, JSON.stringify(conflict.moduleId ? [conflict.moduleId] : []), previewId, conflictId, fingerprint, preview.revision, userId, now, now);
    return publicAiTask(getAiTask(db, taskId));
  })();
}
function resolutionFor(conflict: StoredConflict, value: unknown): SuggestedResolution {
  if (canonicalJson(value) === canonicalJson(conflict.current) && conflict.allowed.includes('keep_current')) return { choice: 'keep_current' };
  if (canonicalJson(value) === canonicalJson(conflict.incoming) && conflict.allowed.includes('take_incoming')) return { choice: 'take_incoming' };
  if (conflict.allowed.includes('manual') && (typeof value === 'string' || Array.isArray(value))) return { choice: 'manual', value };
  throw new AiTaskError(422, 'INVALID_SUGGESTION');
}
export function suggestAiResolution(db: HcdDatabase, taskId: string, worker: TaskWorker, claimId: unknown, value: unknown, rationale: unknown, validate: (preview: StoredPreview, conflict: StoredConflict, resolution: SuggestedResolution) => void) {
  expireAiTasks(db);
  return db.transaction(() => {
    const task = activeAiClaim(db, taskId, worker, claimId); const current = taskConflict(db, task);
    if (value === undefined || typeof rationale !== 'string' || !rationale.trim() || rationale.length > 2000 || Buffer.byteLength(JSON.stringify(value)) > 64000) throw new AiTaskError(400, 'VALIDATION_FAILED');
    const resolution = resolutionFor(current.conflict, value); validate(current.preview, current.conflict, resolution);
    db.prepare('UPDATE ai_tasks SET result=?,result_claim_id=?,updated_at=? WHERE id=?').run(JSON.stringify({ value, rationale: rationale.trim() }), claimId, new Date().toISOString(), taskId);
    return publicAiTask(getAiTask(db, taskId));
  })();
}
export function adoptAiResolution(db: HcdDatabase, taskId: string, previewId: string, conflictId: string) {
  const task = getAiTask(db, taskId);
  if (task.kind !== 'resolve' || task.status !== 'done' || !task.result || task.result_claim_id !== task.claim_id || task.preview_id !== previewId || task.conflict_id !== conflictId) throw new AiTaskError(409, 'PREVIEW_STALE');
  const { conflict } = taskConflict(db, task);
  return { ...resolutionFor(conflict, JSON.parse(task.result).value), aiTaskId: taskId };
}
