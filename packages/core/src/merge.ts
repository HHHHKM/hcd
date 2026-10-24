import { canonicalJson, canonicalizeDocument, InlineSchema, limits, validateDocument, type Document, type Inline } from './model';
import { hashOf } from './hash';
import { mergeText } from './text';
import { allowedInList, arrayFor, canonicalField, containsId, fieldInfo, locate, place, setField, subtreeHash, typeValid, type Op, type ParentRef } from './ops';

export type ResolutionChoice = 'keep_current' | 'take_incoming' | 'manual' | 'accept' | 'drop' | 'append_end' | 'place' | 'restore_and_apply';
export type MergeResolution = { choice: ResolutionChoice; value?: unknown; parent?: ParentRef; after?: string | null; fingerprint?: string; aiTaskId?: string };
export type MergeConflict = {
  id: string; submissionId: string; opIndex: number;
  kind: 'text_overlap' | 'field_changed' | 'target_deleted' | 'delete_modified' | 'parent_missing' | 'anchor_lost' | 'moved_elsewhere' | 'uncertain' | 'invalid_structure';
  path: string; moduleId: string | null; targetId: string | null; base: unknown; current: unknown; incoming: unknown;
  allowed: ResolutionChoice[]; fingerprint: string; resolution?: MergeResolution;
};
export type OperationOutcome = { index: number; outcome: 'applied' | 'merged' | 'duplicate' | 'conflict' | 'resolved' | 'dropped'; conflictId?: string; note?: 'same_field_merge' | 'same_anchor_insert' | 'dependency_dropped' | 'dependency_unresolved' };
export type MergeItem = { submissionId: string; status: 'clean' | 'resolved' | 'needs_resolution' | 'excluded'; conflictIds: string[]; ops: OperationOutcome[] };
export type OperationSubmission = { id: string; createdAt: string; baseVersion: number; ops: Op[] };
export class MergeValidationError extends Error { readonly status = 422; readonly code = 'INVALID_PREVIEW_CANDIDATE'; get details() { return { reason: this.message }; } }
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const copy = <T>(value: T): T => structuredClone(value);

function allIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(child => allIds(child, ids));
  else if (value && typeof value === 'object') { const node = value as Record<string, unknown>; if (typeof node.id === 'string') ids.add(node.id); Object.values(node).forEach(child => allIds(child, ids)); }
  return ids;
}
function moduleFor(doc: Document, id: string): string | null {
  let location = locate(doc, id);
  while (location) { if (location.list === 'modules') return String(location.value.id); location = locate(doc, location.parentId); }
  return null;
}
function dependencies(op: Op): string[] {
  if (op.op === 'set') return [op.at.id, ...(/^(cell|value):/.test(op.at.field) ? [op.at.field.split(':')[1]!] : [])];
  if (op.op === 'delete') return [op.target];
  const references: string[] = [];
  const scan = (value: unknown) => { if (Array.isArray(value)) value.forEach(scan); else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if ((key === 'cells' || key === 'values') && child && typeof child === 'object') references.push(...Object.keys(child)); else scan(child); } };
  if (op.op === 'insert') scan(op.node);
  return [...(op.op === 'move' ? [op.target] : []), op.parent.id, ...(op.after ? [op.after] : []), ...references];
}
function write(doc: Document, id: string, field: string, value: unknown) {
  const info = fieldInfo(doc, id, field);
  if (!info || !typeValid(field, value, info)) throw new MergeValidationError('Invalid field resolution');
  if (Array.isArray(value) && !InlineSchema.safeParse(value).success) throw new MergeValidationError('Invalid inline resolution');
  if (typeof value === 'string') {
    const maximum = field === 'title' ? limits.title : ['value', 'delta'].includes(field) || field === 'label' && ('text' in info.object || 'value' in info.object) ? 40 : limits.inline;
    if (value.length > maximum) throw new MergeValidationError('Field resolution is too long');
  }
  setField(doc, id, field, value);
}
function remove(doc: Document, id: string) {
  const location = locate(doc, id); if (!location) return;
  if (location.list === 'columns') for (const row of location.parent.rows) delete row.cells[id];
  if (location.list === 'categories') for (const series of location.parent.series) delete series.values[id];
  location.array.splice(location.index, 1);
}
function relocate(doc: Document, op: Extract<Op, { op: 'insert' | 'move' }>, parent: ParentRef, after: string | null, batchInserted: Set<string>): boolean {
  const destination = arrayFor(doc, parent); const source = op.op === 'move' ? locate(doc, op.target) : undefined;
  const node = op.op === 'insert' ? op.node : source?.value;
  if (!destination || !node || !allowedInList(destination.parent, destination.parentKind, parent.list, node) || containsId(node, parent.id) || (op.op === 'move' && after === op.target)) throw new MergeValidationError('Invalid destination');
  if (op.op === 'insert' && [...allIds(node)].some(id => containsId(doc, id))) throw new MergeValidationError('Inserted ID already exists');
  if (source) source.array.splice(source.index, 1);
  let position = place(destination.array, after); if (position === undefined) throw new MergeValidationError('Invalid anchor');
  const originalPosition = position;
  if (op.op === 'insert') while (position < destination.array.length && batchInserted.has(destination.array[position].id)) position++;
  destination.array.splice(position, 0, copy(node));
  return position !== originalPosition;
}
function restore(doc: Document, base: Document, op: Extract<Op, { op: 'set' }>, seed: string) {
  const target = locate(base, op.at.id); if (!target) throw new MergeValidationError('Cannot restore a target absent from the base');
  let top = target;
  while (top.list !== 'modules' && !(top.list === 'blocks' && locate(base, top.parentId)?.list === 'modules')) { const parent = locate(base, top.parentId); if (!parent) break; top = parent; }
  // Never replace a surviving container or overwrite its concurrent edits. Restore only missing paths inside it.
  const ensure = (id: string): void => {
    if (containsId(doc, id)) return;
    const original = locate(base, id); if (!original) throw new MergeValidationError('Missing restoration source');
    if (containsId(doc, original.parentId)) {
      const destination = arrayFor(doc, { id: original.parentId, list: original.list }); if (!destination) throw new MergeValidationError('Restoration parent changed type');
      if ([...allIds(original.value)].some(child => containsId(doc, child))) throw new MergeValidationError('Restoration would duplicate a moved descendant');
      destination.array.splice(place(destination.array, original.after) ?? 0, 0, copy(original.value));
      if (original.list === 'columns') for (const row of destination.parent.rows) { const old = original.parent.rows.find((item: { id: string }) => item.id === row.id); if (old?.cells[id]) row.cells[id] = copy(old.cells[id]); }
      if (original.list === 'categories') for (const series of destination.parent.series) { const old = original.parent.series.find((item: { id: string }) => item.id === series.id); if (old?.values[id] !== undefined) series.values[id] = old.values[id]; }
      return;
    }
    if (original.value.id === top.value.id && top.list === 'blocks') {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let salt = 0; let moduleId: string;
      do { moduleId = 'm_' + hashOf([seed, salt++]).slice(0, 8).split('').map(char => alphabet[parseInt(char, 16)]).join(''); } while (containsId(doc, moduleId) || containsId(base, moduleId));
      if ([...allIds(top.value)].some(child => containsId(doc, child))) throw new MergeValidationError('Restoration would duplicate a moved descendant');
      doc.modules.push({ id: moduleId, title: '已恢复的内容 / Restored', blocks: [copy(top.value) as Document['modules'][number]['blocks'][number]] }); return;
    }
    ensure(original.parentId); ensure(id);
  };
  ensure(String(top.value.id)); ensure(op.at.id);
  if (/^(cell|value):/.test(op.at.field)) ensure(op.at.field.split(':')[1]!);
  write(doc, op.at.id, op.at.field, op.after);
}

/** Replay already validated, permanent-ID operations. An unresolved submission is atomically excluded. */
export function mergeOperationSubmission(current: Document, submission: OperationSubmission, resolutions: Record<string, MergeResolution>, base: Document, batchInserted = new Set<string>()) {
  let working = copy(current); const conflicts: MergeConflict[] = []; const outcomes: OperationOutcome[] = [];
  const droppedIds = new Set<string>(); const blockedIds = new Map<string, string>(); const inserted = new Set<string>();
  const addConflict = (op: Op, index: number, suffix: string, kind: MergeConflict['kind'], allowed: ResolutionChoice[], before: unknown, present: unknown, incoming: unknown): MergeConflict => {
    const targetId = op.op === 'set' ? op.at.id : op.op === 'insert' ? op.node.id : op.target;
    const id = `${submission.id}:${index}${suffix}`;
    const location = locate(working, targetId);
    const destination = op.op === 'insert' || op.op === 'move' ? arrayFor(working, op.parent) : undefined;
    const context = { position: location ? { parent: { id: location.parentId, list: location.list }, after: location.after } : null, targetHash: subtreeHash(working, targetId) ?? null, destination: destination?.array.map(node => node.id) ?? null, ...(allowed.includes('restore_and_apply') || kind === 'invalid_structure' ? { snapshotHash: hashOf(working) } : {}) };
    const fingerprint = hashOf({ id, kind, op, base: before, current: present, incoming, context });
    const choice = resolutions[id];
    const resolution = choice && (!choice.fingerprint || choice.fingerprint === fingerprint) ? choice : undefined;
    if (resolution && !allowed.includes(resolution.choice)) throw new MergeValidationError('Resolution is not allowed for this conflict');
    const conflict: MergeConflict = { id, submissionId: submission.id, opIndex: index, kind, path: `/ops/${index}`, moduleId: moduleFor(working, targetId) ?? moduleFor(base, targetId), targetId, base: copy(before), current: copy(present), incoming: copy(incoming), allowed, fingerprint, ...(resolution ? { resolution } : {}) };
    conflicts.push(conflict); return conflict;
  };
  const drop = (op: Op) => { if (op.op === 'insert') allIds(op.node).forEach(id => droppedIds.add(id)); };
  const block = (op: Op, conflictId: string) => { if (op.op === 'insert') allIds(op.node).forEach(id => blockedIds.set(id, conflictId)); };
  for (let index = 0; index < submission.ops.length; index++) {
    const op = submission.ops[index]!; const cid = `${submission.id}:${index}`;
    if (dependencies(op).some(id => droppedIds.has(id))) { drop(op); outcomes.push({ index, outcome: 'dropped', note: 'dependency_dropped' }); continue; }
    const blocked = dependencies(op).map(id => blockedIds.get(id)).find(Boolean);
    if (blocked) { block(op, blocked); outcomes.push({ index, outcome: 'conflict', conflictId: blocked, note: 'dependency_unresolved' }); continue; }
    let resolved = false;
    if (op.uncertain) {
      const uncertainty = addConflict(op, index, '', 'uncertain', ['accept', 'drop'], null, 'Identity match needs human review.', op);
      if (!uncertainty.resolution) { block(op, cid); outcomes.push({ index, outcome: 'conflict', conflictId: cid }); continue; }
      if (uncertainty.resolution.choice === 'drop') { drop(op); outcomes.push({ index, outcome: 'dropped', conflictId: cid }); continue; }
      resolved = true;
    }
    let conflict: MergeConflict | undefined; const suffix = op.uncertain ? ':2' : '';
    const conflictFor = (kind: MergeConflict['kind'], allowed: ResolutionChoice[], before: unknown, present: unknown, incoming: unknown) => conflict = addConflict(op, index, suffix, kind, allowed, before, present, incoming);
    const finish = (outcome: OperationOutcome['outcome'], note?: OperationOutcome['note']) => outcomes.push({ index, outcome: resolved ? 'resolved' : outcome, ...(note ? { note } : {}) });
    if (op.op === 'set') {
      const field = fieldInfo(working, op.at.id, op.at.field);
      if (!field) conflictFor('target_deleted', locate(base, op.at.id) ? ['keep_current', 'restore_and_apply'] : ['keep_current'], op.before, null, op.after);
      else if (field.kind === 'text' && field.special !== 'accent') {
        const merged = mergeText(canonicalField(op.before) as Inline | string, canonicalField(field.current) as Inline | string, canonicalField(op.after) as Inline | string);
        if (merged.status === 'conflict') conflictFor('text_overlap', ['keep_current', 'take_incoming', 'manual'], op.before, field.current, op.after);
        else { write(working, op.at.id, op.at.field, merged.value); finish(merged.status === 'clean' ? 'applied' : merged.status, merged.status === 'merged' ? 'same_field_merge' : undefined); continue; }
      } else if (equal(field.current, op.after)) { finish('duplicate'); continue; }
      else if (equal(field.current, op.before)) { write(working, op.at.id, op.at.field, op.after); finish('applied'); continue; }
      else conflictFor('field_changed', ['keep_current', 'take_incoming'], op.before, field.current, op.after);
    } else if (op.op === 'delete') {
      const location = locate(working, op.target);
      if (!location) { finish('duplicate'); continue; }
      if (subtreeHash(working, op.target) !== op.beforeHash) conflictFor('delete_modified', ['keep_current', 'take_incoming'], op.beforeHash, location.value, null);
      else { remove(working, op.target); finish('applied'); continue; }
    } else {
      const source = op.op === 'move' ? locate(working, op.target) : undefined;
      const destination = arrayFor(working, op.parent);
      if (op.op === 'move' && !source) conflictFor('target_deleted', ['keep_current'], op.from ?? null, null, { parent: op.parent, after: op.after });
      else if (op.op === 'move' && op.from && (!equal({ id: source!.parentId, list: source!.list }, op.from.parent))) conflictFor('moved_elsewhere', ['keep_current', 'take_incoming'], op.from, { parent: { id: source!.parentId, list: source!.list }, after: source!.after }, { parent: op.parent, after: op.after });
      else if (!destination) conflictFor('parent_missing', ['drop', 'place'], op.parent, null, op);
      else if (op.after !== null && place(destination.array, op.after) === undefined) conflictFor('anchor_lost', ['drop', 'append_end', 'place'], op.after, destination.array.map(node => node.id), op);
      else {
        try { const skipped = relocate(working, op, op.parent, op.after, batchInserted); if (op.op === 'insert') allIds(op.node).forEach(id => inserted.add(id)); finish('applied', skipped ? 'same_anchor_insert' : undefined); continue; }
        catch (error) { if (!(error instanceof MergeValidationError)) throw error; conflictFor('invalid_structure', ['drop'], null, error.message, op); }
      }
    }
    if (!conflict) throw new MergeValidationError('Missing operation outcome');
    const resolution = conflict.resolution;
    if (!resolution) { block(op, conflict.id); outcomes.push({ index, outcome: 'conflict', conflictId: conflict.id }); continue; }
    if (resolution.choice === 'keep_current' || resolution.choice === 'drop') { drop(op); outcomes.push({ index, outcome: 'dropped', conflictId: conflict.id }); continue; }
    if (op.op === 'set') {
      if (resolution.choice === 'restore_and_apply') restore(working, base, op, cid);
      else write(working, op.at.id, op.at.field, resolution.choice === 'manual' ? resolution.value : op.after);
    } else if (op.op === 'delete') remove(working, op.target);
    else {
      const parent = resolution.choice === 'place' ? resolution.parent : op.parent;
      if (!parent) throw new MergeValidationError('Placement requires a parent');
      const destination = arrayFor(working, parent);
      const after = resolution.choice === 'place' ? resolution.after : resolution.choice === 'append_end' || resolution.choice === 'take_incoming' && destination && op.after !== null && place(destination.array, op.after) === undefined ? destination?.array.filter(node => op.op !== 'move' || node.id !== op.target).at(-1)?.id ?? null : op.after;
      if (after === undefined) throw new MergeValidationError('Placement requires an anchor');
      relocate(working, op, parent, after, batchInserted); if (op.op === 'insert') allIds(op.node).forEach(id => inserted.add(id));
    }
    outcomes.push({ index, outcome: 'resolved', conflictId: conflict.id });
  }
  let unresolved = conflicts.some(conflict => !conflict.resolution);
  if (!unresolved) {
    const checked = validateDocument(working);
    if (!checked.ok) {
      const op = submission.ops.at(-1); if (!op) throw new MergeValidationError('Invalid empty submission');
      const conflict = addConflict(op, submission.ops.length, ':document', 'invalid_structure', ['drop'], null, checked.error, null);
      // Dropping an invalid combined result explicitly discards this entire submission.
      working = copy(current); inserted.clear(); unresolved = !conflict.resolution;
      outcomes.push({ index: submission.ops.length, outcome: unresolved ? 'conflict' : 'dropped', conflictId: conflict.id });
    } else working = checked.value;
  }
  if (unresolved) { working = copy(current); inserted.clear(); }
  const item: MergeItem = { submissionId: submission.id, status: unresolved ? 'needs_resolution' : conflicts.length ? 'resolved' : 'clean', conflictIds: conflicts.map(conflict => conflict.id), ops: outcomes };
  return { candidate: working, conflicts, item, inserted };
}

export function computePreview(input: { current: Document; submissions: OperationSubmission[]; resolutions?: Record<string, MergeResolution>; excluded?: string[]; snapshotAt: (version: number) => Document }) {
  let candidate = copy(input.current); const conflicts: MergeConflict[] = []; const items: MergeItem[] = []; const batchInserted = new Set<string>();
  for (const submission of [...input.submissions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (input.excluded?.includes(submission.id)) { items.push({ submissionId: submission.id, status: 'excluded', conflictIds: [], ops: [] }); continue; }
    const result = mergeOperationSubmission(candidate, submission, input.resolutions ?? {}, input.snapshotAt(submission.baseVersion), batchInserted);
    candidate = result.candidate; conflicts.push(...result.conflicts); items.push(result.item); result.inserted.forEach(id => batchInserted.add(id));
  }
  return { candidate: canonicalizeDocument(candidate), candidateHash: hashOf(candidate), conflicts, items, publishable: !items.some(item => item.status === 'needs_resolution') && items.some(item => item.status === 'clean' || item.status === 'resolved') };
}

export { allIds as documentNodeIds };
