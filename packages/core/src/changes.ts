import { canonicalJson, createCounterTmpIdSource, plainText, validateDocument, type Document, type Inline } from './model';
import { diffDocuments } from './diff';
import { tokenize, type Unit } from './text';
import { allowedInList, arrayFor, canonicalField, containsId, fieldInfo, locate, place, remapOp, setField, subtreeHash, typeValid, type AnyNode, type FieldValue, type Op, type ParentRef } from './ops';

export type ChangeSegment = { type: 'eq' | 'ins' | 'del'; value: Inline | string };
export type ChangePosition = { parent: ParentRef; after: string | null; parentLabel?: string; afterLabel?: string | null };
export type Change = {
  kind: 'text' | 'field' | 'insert' | 'delete' | 'move'; opIndex: number;
  moduleId: string | null; moduleTitle: string | null; targetId: string; targetType: string;
  field?: string; fieldLabel?: string; before?: FieldValue; after?: FieldValue;
  segments?: ChangeSegment[]; detail?: 'tokens' | 'replacement';
  nodeBefore?: AnyNode; nodeAfter?: AnyNode; from?: ChangePosition; to?: ChangePosition;
  coupledBefore?: Array<{ targetId: string; field: string; value: FieldValue }>;
  uncertain?: boolean; sources?: string[];
};
export type ChangeSet = { changes: Change[]; unavailable?: string };
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const clone = <T>(value: T): T => structuredClone(value);
const fail = (reason: string): never => { throw new Error(reason); };
const MAX_TEXT_WORK = 200_000;
const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
type Edit = { type: ChangeSegment['type']; unit: Unit };
const unitKey = (unit: Unit) => `${unit.text}\u0000${canonicalJson(unit.marks)}`;

/** Bounded Myers trace. Large or very different text falls back to an explicit replacement. */
function textEdits(before: Unit[], after: Unit[], beforeKeys: string[], afterKeys: string[]): Edit[] | null {
  const n = before.length; const m = after.length;
  const frontier = new Map<number, number>([[1, 0]]); const trace: Map<number, number>[] = [];
  let work = 0;
  for (let distance = 0; distance <= n + m; distance++) {
    work += frontier.size;
    if (work > MAX_TEXT_WORK) return null;
    trace.push(new Map(frontier));
    for (let k = -distance; k <= distance; k += 2) {
      if (++work > MAX_TEXT_WORK) return null;
      const previous = (key: number) => frontier.get(key) ?? -1;
      let x = k === -distance || k !== distance && previous(k - 1) < previous(k + 1) ? previous(k + 1) : previous(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && beforeKeys[x] === afterKeys[y]) {
        if (++work > MAX_TEXT_WORK) return null;
        x++; y++;
      }
      frontier.set(k, x);
      if (x < n || y < m) continue;
      const edits: Edit[] = []; let cursorX = n; let cursorY = m;
      for (let d = distance; d >= 0; d--) {
        const old = trace[d]!; const diagonal = cursorX - cursorY;
        const get = (key: number) => old.get(key) ?? -1;
        const previousK = diagonal === -d || diagonal !== d && get(diagonal - 1) < get(diagonal + 1) ? diagonal + 1 : diagonal - 1;
        const previousX = get(previousK); const previousY = previousX - previousK;
        while (cursorX > previousX && cursorY > previousY) { edits.push({ type: 'eq', unit: before[--cursorX]! }); cursorY--; }
        if (d === 0) break;
        if (cursorX === previousX) edits.push({ type: 'ins', unit: after[--cursorY]! });
        else edits.push({ type: 'del', unit: before[--cursorX]! });
      }
      return edits.reverse();
    }
  }
  return null;
}

// tokenize/detokenize for model text normalize whole-inline boundaries. Display
// fragments must not use that normalization: a fragment can consist only of spaces.
function displayUnits(value: Inline | string): Unit[] {
  if (typeof value === 'string') return tokenize(value);
  return value.flatMap(run => {
    if ('br' in run) return [{ text: '\n', marks: {} }];
    const { t, ...marks } = run;
    return tokenize(t).map(unit => ({ text: unit.text, marks: { ...marks } }));
  });
}
function displayInline(units: Unit[]): Inline {
  const result: Inline = [];
  for (const unit of units) {
    if (unit.text === '\n' && Object.keys(unit.marks).length === 0) { result.push({ br: true }); continue; }
    const previous = result.at(-1);
    if (previous && !('br' in previous)) {
      const { t: _text, ...marks } = previous;
      if (equal(marks, unit.marks)) { previous.t += unit.text; continue; }
    }
    result.push({ t: unit.text, ...unit.marks });
  }
  return result;
}

/** Text units include marks and each whitespace character; segments never trim them. */
export function textChangeSegments(before: Inline | string, after: Inline | string): { segments: ChangeSegment[]; detail: 'tokens' | 'replacement' } {
  if (typeof before !== typeof after) fail('DISPLAY_TEXT_TYPE_MISMATCH');
  const old = displayUnits(before); const next = displayUnits(after); const oldKeys = old.map(unitKey); const nextKeys = next.map(unitKey);
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && oldKeys[prefix] === nextKeys[prefix]) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < next.length - prefix && oldKeys[old.length - suffix - 1] === nextKeys[next.length - suffix - 1]) suffix++;
  const oldMiddle = old.slice(prefix, old.length - suffix); const nextMiddle = next.slice(prefix, next.length - suffix);
  const shortest = textEdits(oldMiddle, nextMiddle, oldKeys.slice(prefix, old.length - suffix), nextKeys.slice(prefix, next.length - suffix));
  const middle = shortest ?? [...oldMiddle.map(unit => ({ type: 'del' as const, unit })), ...nextMiddle.map(unit => ({ type: 'ins' as const, unit }))];
  const edits: Edit[] = [...old.slice(0, prefix).map(unit => ({ type: 'eq' as const, unit })), ...middle, ...old.slice(old.length - suffix).map(unit => ({ type: 'eq' as const, unit }))];
  const groups: Array<{ type: ChangeSegment['type']; units: Unit[] }> = [];
  for (const edit of edits) { const last = groups.at(-1); if (last?.type === edit.type) last.units.push(edit.unit); else groups.push({ type: edit.type, units: [edit.unit] }); }
  return { detail: shortest ? 'tokens' : 'replacement', segments: groups.map(group => ({ type: group.type, value: typeof before === 'string' ? group.units.map(unit => unit.text).join('') : displayInline(group.units) })) };
}

function moduleContext(doc: Document, id: string): { moduleId: string | null; moduleTitle: string | null } {
  let location = locate(doc, id);
  while (location) {
    if (location.list === 'modules') return { moduleId: location.value.id, moduleTitle: location.value.title };
    location = locate(doc, location.parentId);
  }
  return { moduleId: null, moduleTitle: null };
}
function nodeType(doc: Document, id: string): string {
  if (id === doc.id) return 'document';
  const location = locate(doc, id); if (!location) return fail('DISPLAY_TARGET_MISSING');
  if (typeof location.value.type === 'string') return location.value.type;
  const listType: Partial<Record<ParentRef['list'], string>> = { modules: 'module', columns: 'table-column', rows: 'table-row', categories: 'chart-category', series: 'chart-series', cols: 'column' };
  if (listType[location.list]) return listType[location.list]!;
  if (location.list === 'items') return location.parent.type === 'cards' ? 'card' : location.parent.type === 'timeline' ? 'timeline-item' : location.parent.type === 'kpis' ? 'kpi-item' : 'list-item';
  return fail('DISPLAY_NODE_TYPE_UNKNOWN');
}
function nodeLabel(doc: Document, id: string): string {
  if (id === doc.id) return doc.title || id;
  const node = locate(doc, id)?.value;
  if (!node) return id;
  for (const key of ['title', 'header', 'label', 'name', 'text', 'caption', 'alt']) {
    const value = node[key]; const label = typeof value === 'string' ? value : Array.isArray(value) ? plainText(value) : '';
    if (label) return label.slice(0, 160);
  }
  return id;
}
function position(doc: Document, parent: ParentRef, after: string | null): ChangePosition {
  return { parent: clone(parent), after, parentLabel: nodeLabel(doc, parent.id), afterLabel: after === null ? null : nodeLabel(doc, after) };
}
function insertedIds(node: AnyNode): string[] {
  const ids: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') { if ('id' in value && typeof value.id === 'string') ids.push(value.id); Object.values(value).forEach(walk); }
  };
  walk(node); return ids;
}

/** One display row per recorded operation, in its original order. Never synthesizes receipt operations. */
export function toChanges(a: Document, b: Document, operations: Op[]): Change[] {
  const initial = validateDocument(a); const target = validateDocument(b);
  if (!initial.ok || !target.ok) return fail('DISPLAY_INVALID_DOCUMENT');
  if (a.id !== b.id) return fail('DISPLAY_DOCUMENT_ID_MISMATCH');
  const working = clone(initial.value); const changes: Change[] = []; const usedIds = new Set(insertedIds(working as unknown as AnyNode));
  let bytes = 0;
  const snapshot = (node: unknown): AnyNode => {
    const size = new TextEncoder().encode(JSON.stringify(node)).byteLength;
    bytes += size;
    if (bytes > MAX_PRESENTATION_BYTES) return fail('DISPLAY_TOO_LARGE');
    return clone(node) as AnyNode;
  };
  for (const [opIndex, op] of operations.entries()) {
    const targetId = op.op === 'set' ? op.at.id : op.op === 'insert' ? op.node.id : op.target;
    if (targetId.startsWith('tmp_')) return fail('DISPLAY_REQUIRES_PERMANENT_IDS');
    const common = { opIndex, targetId, ...(op.uncertain ? { uncertain: true } : {}) };
    let change: Change;
    if (op.op === 'set') {
      const info = fieldInfo(working, targetId, op.at.field);
      if (!info || !equal(canonicalField(info.current), canonicalField(op.before)) || !typeValid(op.at.field, op.after, info)) return fail('DISPLAY_SET_PRECONDITION');
      const text = info.kind === 'text' && info.special !== 'accent';
      const labelId = /^(cell|value):/.test(op.at.field) ? op.at.field.slice(op.at.field.indexOf(':') + 1) : null;
      change = { ...common, ...moduleContext(working, targetId), targetType: nodeType(working, targetId), kind: text ? 'text' : 'field', field: op.at.field, ...(labelId ? { fieldLabel: nodeLabel(working, labelId) } : {}), before: clone(op.before), after: clone(op.after), ...(text ? textChangeSegments(op.before as Inline | string, op.after as Inline | string) : {}) };
      if (!setField(working, targetId, op.at.field, op.after)) return fail('DISPLAY_FIELD_UNKNOWN');
    } else if (op.op === 'insert') {
      const destination = arrayFor(working, op.parent); const ids = insertedIds(op.node);
      if (!destination || !allowedInList(destination.parent, destination.parentKind, op.parent.list, op.node) || ids.some(id => usedIds.has(id) || id.startsWith('tmp_')) || new Set(ids).size !== ids.length) return fail('DISPLAY_INSERT_INVALID');
      const index = place(destination.array, op.after); if (index === undefined) return fail('DISPLAY_ANCHOR_MISSING');
      const to = position(working, op.parent, op.after);
      destination.array.splice(index, 0, clone(op.node)); ids.forEach(id => usedIds.add(id));
      change = { ...common, ...moduleContext(working, targetId), targetType: nodeType(working, targetId), kind: 'insert', nodeAfter: snapshot(op.node), to };
    } else {
      const source = locate(working, targetId); if (!source) return fail('DISPLAY_TARGET_MISSING');
      const from = position(working, { id: source.parentId, list: source.list }, source.after);
      const context = moduleContext(working, targetId); const targetType = nodeType(working, targetId); const nodeBefore = snapshot(source.value);
      if (op.op === 'delete') {
        if (subtreeHash(working, targetId) !== op.beforeHash) return fail('DISPLAY_DELETE_PRECONDITION');
        const coupledBefore: NonNullable<Change['coupledBefore']> = [];
        if (source.list === 'columns') for (const row of source.parent.rows) {
          if (row.cells[targetId] !== undefined) coupledBefore.push({ targetId: row.id, field: `cell:${targetId}`, value: clone(row.cells[targetId]) });
          delete row.cells[targetId];
        }
        if (source.list === 'categories') for (const series of source.parent.series) {
          if (series.values[targetId] !== undefined) coupledBefore.push({ targetId: series.id, field: `value:${targetId}`, value: series.values[targetId] });
          delete series.values[targetId];
        }
        source.array.splice(source.index, 1);
        change = { ...common, ...context, targetType, kind: 'delete', nodeBefore, from, ...(coupledBefore.length ? { coupledBefore } : {}) };
      } else {
        if (op.from && !equal(op.from, { parent: from.parent, after: from.after })) return fail('DISPLAY_MOVE_PRECONDITION');
        const destination = arrayFor(working, op.parent);
        if (!destination || !allowedInList(destination.parent, destination.parentKind, op.parent.list, source.value) || containsId(source.value, op.parent.id) || op.after === targetId) return fail('DISPLAY_MOVE_INVALID');
        const to = position(working, op.parent, op.after); const moving = source.array.splice(source.index, 1)[0];
        const index = place(destination.array, op.after); if (index === undefined) return fail('DISPLAY_ANCHOR_MISSING');
        destination.array.splice(index, 0, moving);
        change = { ...common, ...moduleContext(working, targetId), targetType, kind: 'move', nodeBefore, nodeAfter: snapshot(moving), from, to };
      }
    }
    // Text segments and repeated structural snapshots are bounded independently of document size.
    bytes += new TextEncoder().encode(JSON.stringify({ ...change, nodeBefore: undefined, nodeAfter: undefined })).byteLength;
    if (bytes > MAX_PRESENTATION_BYTES) return fail('DISPLAY_TOO_LARGE');
    changes.push(change);
  }
  const replayed = validateDocument(working);
  if (!replayed.ok || !equal(replayed.value, target.value)) return fail('DISPLAY_REPLAY_MISMATCH');
  return changes;
}

/** Read-only net comparison. It does not impose or weaken the 500-operation submission limit. */
export function compareDocumentChanges(a: Document, b: Document): ChangeSet {
  try {
    const before = validateDocument(a); const after = validateDocument(b);
    if (!before.ok || !after.ok) return { changes: [], unavailable: 'DISPLAY_INVALID_DOCUMENT' };
    if (before.value.id !== after.value.id) return { changes: [], unavailable: 'DISPLAY_DOCUMENT_ID_MISMATCH' };
    const ids: Record<string, string> = {};
    const operations = diffDocuments(before.value, after.value, createCounterTmpIdSource('display'), (original, temporary) => { ids[temporary] = original; });
    return { changes: toChanges(before.value, after.value, operations.map(op => remapOp(op, ids))) };
  } catch (error) {
    return { changes: [], unavailable: error instanceof Error ? error.message : 'DISPLAY_UNAVAILABLE' };
  }
}
