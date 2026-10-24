import { z } from 'zod';
import {
  canonicalJson, canonicalizeDocument, canonicalizeInline, InlineSchema, validateDocument,
  type Block, type Document, type Inline, type LeafBlock, type ListItem, type Module,
  type Result, type IdSource, type ValidationIssue,
} from './model';
import { hashOf } from './hash';

export type Address = { id: string; field: string };
export type ListName = 'modules' | 'blocks' | 'items' | 'columns' | 'rows' | 'categories' | 'series' | 'cols';
export type ParentRef = { id: string; list: ListName };
export type FieldValue = Inline | string | number | boolean | null;
export type SetOp = { op: 'set'; at: Address; before: FieldValue; after: FieldValue; uncertain?: true };
export type InsertOp = { op: 'insert'; parent: ParentRef; after: string | null; node: AnyNode; uncertain?: true };
export type DeleteOp = { op: 'delete'; target: string; beforeHash: string; uncertain?: true };
export type MoveOp = { op: 'move'; target: string; parent: ParentRef; after: string | null; from?: { parent: ParentRef; after: string | null }; uncertain?: true };
export type Op = SetOp | InsertOp | DeleteOp | MoveOp;
export type AnyNode = Module | Block | ListItem | { id: string; header: Inline; align: string } | { id: string; cells: Record<string, Inline> }
  | { id: string; label: string } | { id: string; name: string; values: Record<string, number | null> }
  | { id: string; label: string; title: string; text: Inline } | { id: string; label: string; value: string; delta: string; tone: string }
  | { id: string; blocks: LeafBlock[] } | { id: string; title: string; blocks: LeafBlock[] };
export type OpError = { index: number; code: 'PRECONDITION_FAILED' | 'VALIDATION_FAILED'; details: unknown };
export type ApplyOpsResult = { doc: Document; ops: Op[]; idMap: Record<string, string> };

const addressSchema = z.object({ id: z.string().min(1), field: z.string().min(1) }).strict();
const parentSchema = z.object({ id: z.string().min(1), list: z.enum(['modules', 'blocks', 'items', 'columns', 'rows', 'categories', 'series', 'cols']) }).strict();
const fieldValueSchema = z.union([InlineSchema, z.string(), z.number().finite(), z.boolean(), z.null()]);
const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), at: addressSchema, before: fieldValueSchema, after: fieldValueSchema, uncertain: z.literal(true).optional() }).strict(),
  z.object({ op: z.literal('insert'), parent: parentSchema, after: z.string().nullable(), node: z.record(z.string(), z.unknown()), uncertain: z.literal(true).optional() }).strict(),
  z.object({ op: z.literal('delete'), target: z.string().min(1), beforeHash: z.string().regex(/^[a-f0-9]{64}$/), uncertain: z.literal(true).optional() }).strict(),
  z.object({ op: z.literal('move'), target: z.string().min(1), parent: parentSchema, after: z.string().nullable(), from: z.object({ parent: parentSchema, after: z.string().nullable() }).strict().optional(), uncertain: z.literal(true).optional() }).strict(),
]);
export const OpsSchema = z.array(opSchema).max(500);

type Location = { value: Record<string, any>; parent: Record<string, any>; list: ListName; array: any[]; index: number; parentId: string; after: string | null; depth?: number };
const tmpPattern = /^tmp_[a-z0-9_]{1,32}$/;
const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasId = (value: unknown): value is Record<string, any> => isObject(value) && typeof value.id === 'string';
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) as T;
  return value;
}

function children(parent: Record<string, any>): Array<[ListName, any[]]> {
  const result: Array<[ListName, any[]]> = [];
  const add = (name: ListName) => { if (Array.isArray(parent[name])) result.push([name, parent[name]]); };
  if ('schemaVersion' in parent) add('modules');
  else if (!('type' in parent)) {
    if (Array.isArray(parent.blocks)) add('blocks');
    else if (Array.isArray(parent.items) && 'text' in parent) add('items');
  }
  switch (parent.type) {
    case 'module': add('blocks'); break;
    case 'columns': add('cols'); break;
    case 'column': add('blocks'); break;
    case 'cards': add('items'); break;
    case 'card': add('blocks'); break;
    case 'list': case 'list-item': add('items'); break;
    case 'table': add('columns'); add('rows'); break;
    case 'chart': add('categories'); add('series'); break;
    case 'timeline': case 'kpis': add('items'); break;
  }
  return result;
}

function walk(doc: Document, visit: (value: Record<string, any>, parent: Record<string, any>, list: ListName, array: any[], index: number, depth: number) => boolean): Location | undefined {
  const scan = (parent: Record<string, any>, depth: number): Location | undefined => {
    for (const [list, array] of children(parent)) {
      for (let index = 0; index < array.length; index += 1) {
        const value = array[index];
        if (!hasId(value)) continue;
        if (visit(value, parent, list, array, index, depth)) {
          const previous = index > 0 && hasId(array[index - 1]) ? array[index - 1].id : null;
          return { value, parent, list, array, index, parentId: String(parent.id ?? doc.id), after: previous, depth };
        }
        const isListItem = Array.isArray(parent.items) && 'text' in parent;
        const nested = scan(value, depth + (value.type === 'list' ? 1 : 0) + (list === 'items' && (parent.type === 'list' || isListItem) ? 1 : 0));
        if (nested) return nested;
      }
    }
    return undefined;
  };
  return scan(doc as unknown as Record<string, any>, 0);
}

export function locate(doc: Document, id: string): Location | undefined {
  return walk(doc, (value) => value.id === id);
}

export function arrayFor(doc: Document, parentRef: ParentRef): { parent: Record<string, any>; array: any[]; parentKind: 'document' | 'module' | 'column' | 'card' | string } | undefined {
  const parent = parentRef.id === doc.id ? doc as unknown as Record<string, any> : locate(doc, parentRef.id)?.value;
  if (!parent) return undefined;
  const parentLocation = parentRef.id === doc.id ? undefined : locate(doc, parentRef.id);
  const parentKind = parentRef.id === doc.id ? 'document'
    : parentLocation?.list === 'modules' ? 'module'
    : parentLocation?.list === 'cols' ? 'column'
    : parentLocation?.list === 'items' && parentLocation.parent.type === 'cards' ? 'card'
    : parentLocation?.list === 'items' && (parentLocation.parent.type === 'list' || parentLocation.parent.type === undefined) ? 'list-item'
    : String(parent.type ?? '');
  const allowed = Array.isArray(parent[parentRef.list]);
  if (!allowed) return undefined;
  if (parentRef.list === 'modules') return parentKind === 'document' ? { parent, array: parent.modules, parentKind } : undefined;
  if (parentRef.list === 'blocks' && ['module', 'column', 'card'].includes(parentKind)) return { parent, array: parent.blocks, parentKind };
  if (parentRef.list === 'cols' && parent.type === 'columns') return { parent, array: parent.cols, parentKind };
  if (parentRef.list === 'items' && (parent.type === 'cards' || parent.type === 'timeline' || parent.type === 'kpis' || parent.type === 'list' || (parent['text'] && Array.isArray(parent.items)))) {
    // Only first-level list items may contain the second level. Structural
    // parentage expresses this directly; walk() counts the list block itself.
    if (parent.type === undefined && parentLocation?.parent.type !== 'list') return undefined;
    return { parent, array: parent.items, parentKind };
  }
  if ((parentRef.list === 'columns' || parentRef.list === 'rows') && parent.type === 'table') return { parent, array: parent[parentRef.list], parentKind };
  if ((parentRef.list === 'categories' || parentRef.list === 'series') && parent.type === 'chart') return { parent, array: parent[parentRef.list], parentKind };
  return undefined;
}

export function allowedInList(parent: Record<string, any>, parentKind: string, list: ListName, node: Record<string, any>): boolean {
  if (list === 'modules') return parentKind === 'document' && !('type' in node) && Array.isArray(node.blocks);
  if (list === 'blocks') {
    if (parentKind === 'module') return 'type' in node;
    if (parentKind === 'column' || parentKind === 'card') return ['heading', 'paragraph', 'list', 'quote', 'callout', 'divider', 'image', 'table', 'chart', 'timeline', 'kpis', 'raw'].includes(node.type);
  }
  if (list === 'items') {
    if (parent.type === 'cards') return !('type' in node) && Array.isArray(node.blocks) && typeof node.title === 'string';
    if (parent.type === 'timeline') return typeof node.label === 'string' && typeof node.text !== 'undefined';
    if (parent.type === 'kpis') return typeof node.value === 'string' && typeof node.tone === 'string';
    if (parent.type === 'list' || (parent.type === undefined && Array.isArray(parent.items))) return 'items' in node && 'text' in node;
  }
  if (list === 'cols') return parent.type === 'columns' && 'blocks' in node && !('type' in node);
  if (list === 'columns') return parent.type === 'table' && 'header' in node && 'align' in node;
  if (list === 'rows') return parent.type === 'table' && 'cells' in node;
  if (list === 'categories') return parent.type === 'chart' && 'label' in node && !('values' in node);
  if (list === 'series') return parent.type === 'chart' && 'values' in node;
  return false;
}

function mapKnownId(id: string, idMap: Record<string, string>): string { return idMap[id] ?? id; }
function mapRef(ref: ParentRef, idMap: Record<string, string>): ParentRef { return { ...ref, id: mapKnownId(ref.id, idMap) }; }

function remapNode(value: any, idMap: Record<string, string>): any {
  if (Array.isArray(value)) return value.map((item) => remapNode(item, idMap));
  if (!isObject(value)) return value;
  const result: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' && typeof child === 'string') result.id = mapKnownId(child, idMap);
    else if ((key === 'cells' || key === 'values') && isObject(child)) {
      result[key] = Object.fromEntries(Object.entries(child).map(([id, cell]) => [mapKnownId(id, idMap), remapNode(cell, idMap)]));
    } else result[key] = remapNode(child, idMap);
  }
  return result;
}

function collectInsertedIds(node: AnyNode, expectedPrefix: 'm' | 'n', ids: Set<string>): string[] {
  const found: string[] = [];
  const scan = (value: unknown, root = false): void => {
    if (Array.isArray(value)) { value.forEach((item) => scan(item)); return; }
    if (!isObject(value)) return;
    if (typeof value.id === 'string') {
      if (!tmpPattern.test(value.id)) throw new Error(`inserted node id must be temporary: ${value.id}`);
      if (root && expectedPrefix === 'm' && !Array.isArray(value.blocks)) throw new Error('module insert requires a module root');
      found.push(value.id);
    }
    for (const child of Object.values(value)) scan(child);
  };
  scan(node, true);
  for (const id of found) { if (ids.has(id)) throw new Error(`duplicate inserted temporary id: ${id}`); ids.add(id); }
  return found;
}

export function canonicalField(value: any): any {
  if (Array.isArray(value)) return canonicalizeInline(value as Inline);
  if (typeof value === 'string') return value.replace(/[\n\r\t]/g, ' ').trim();
  return value;
}

export function fieldInfo(doc: Document, id: string, field: string): { object: Record<string, any>; key: string; current: any; kind: 'text' | 'scalar'; special?: 'cell' | 'value' | 'accent' } | undefined {
  if (id === doc.id) {
    const document = doc as unknown as Record<string, any>;
    if (field === 'title') return { object: document, key: 'title', current: document.title, kind: 'text' };
    if (field === 'theme.overrides.accent') return { object: document.theme.overrides, key: 'accent', current: document.theme.overrides.accent ?? null, kind: 'text', special: 'accent' };
    return undefined;
  }
  const location = locate(doc, id);
  if (!location) return undefined;
  const object = location.value;
  if (field.startsWith('cell:') && object.cells) {
    const columnId = field.slice(5);
    const table = location.parent;
    if (location.list !== 'rows' || !table.columns.some((col: any) => col.id === columnId)) return undefined;
    return { object: object.cells, key: columnId, current: object.cells[columnId] ?? [], kind: 'text', special: 'cell' };
  }
  if (field.startsWith('value:') && object.values) {
    const categoryId = field.slice(6);
    const chart = location.parent;
    if (location.list !== 'series' || !chart.categories.some((cat: any) => cat.id === categoryId)) return undefined;
    return { object: object.values, key: categoryId, current: object.values[categoryId] ?? null, kind: 'scalar', special: 'value' };
  }
  const allowed: Record<string, { text?: string[]; scalar?: string[] }> = {
    module: { text: ['title'] }, heading: { text: ['text'], scalar: ['level'] }, paragraph: { text: ['text'] }, quote: { text: ['text'] }, list: { scalar: ['ordered'] },
    callout: { text: ['title', 'text'], scalar: ['tone'] }, image: { text: ['alt', 'caption'], scalar: ['asset', 'width'] }, table: { text: ['caption'] },
    'table-column': { text: ['header'], scalar: ['align'] }, chart: { text: ['title', 'unit'], scalar: ['kind'] }, 'chart-category': { text: ['label'] },
    'chart-series': { text: ['name'] }, timeline: { text: ['label', 'title', 'text'] }, kpis: { text: ['label', 'value', 'delta'], scalar: ['tone'] },
    columns: { scalar: ['ratio'] }, card: { text: ['title'] }, cards: { scalar: ['perRow'] }, raw: { text: ['note'], scalar: ['height', 'allowScripts'] },
    'list-item': { text: ['text'] }, divider: {}, 'table-row': {}, column: {},
  };
  const type = object.type ?? (location.list === 'modules' ? 'module' : location.list === 'columns' ? 'table-column' : location.list === 'rows' ? 'table-row' : location.list === 'categories' ? 'chart-category' : location.list === 'series' ? 'chart-series' : location.list === 'items' && location.parent.type === 'timeline' ? 'timeline' : location.list === 'items' && location.parent.type === 'kpis' ? 'kpis' : location.list === 'items' && location.parent.type === 'cards' ? 'card' : location.list === 'items' ? 'list-item' : location.list === 'cols' ? 'column' : '');
  const spec = allowed[type];
  if (!spec || (!spec.text?.includes(field) && !spec.scalar?.includes(field)) || !(field in object)) return undefined;
  return { object, key: field, current: object[field], kind: spec.text?.includes(field) ? 'text' : 'scalar' };
}

export function typeValid(field: string, value: any, info: NonNullable<ReturnType<typeof fieldInfo>>): boolean {
  if (info.kind === 'text') {
    if (info.special === 'accent') return value === null || (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value));
    if (field === 'text' || field === 'header' || field.startsWith('cell:')) return Array.isArray(value);
    return typeof value === 'string';
  }
  if (field === 'level') return value === 3 || value === 4;
  if (field === 'tone') return ['info', 'success', 'warn', 'danger', 'neutral', 'good', 'bad'].includes(value);
  if (field === 'width') return ['small', 'normal', 'wide', 'full'].includes(value);
  if (field === 'align') return ['left', 'center', 'right'].includes(value);
  if (field === 'kind') return ['bar', 'line', 'pie'].includes(value);
  if (field === 'ratio') return ['1:1', '1:2', '2:1', '1:1:1'].includes(value);
  if (field === 'perRow') return value === 2 || value === 3 || value === 4;
  if (field === 'height') return Number.isInteger(value);
  if (field === 'allowScripts' || field === 'ordered') return typeof value === 'boolean';
  if (field === 'asset') return value === null || (typeof value === 'string' && /^as_[a-z2-7]{12}$/.test(value));
  if (field.startsWith('value:')) return value === null || (typeof value === 'number' && Number.isFinite(value));
  return typeof value === 'number' && Number.isFinite(value);
}

export function setField(doc: Document, id: string, field: string, after: any): boolean {
  const info = fieldInfo(doc, id, field);
  if (!info) return false;
  if (info.special === 'cell') {
    const value = canonicalizeInline(after as Inline);
    if (value.length) info.object[info.key] = value; else delete info.object[info.key];
  } else if (info.special === 'value') {
    if (after === null) delete info.object[info.key]; else info.object[info.key] = after;
  } else if (info.special === 'accent' && after === null) delete info.object[info.key];
  else info.object[info.key] = info.kind === 'text' ? canonicalField(after) : after;
  return true;
}

export function containsId(root: unknown, id: string): boolean {
  if (Array.isArray(root)) return root.some((item) => containsId(item, id));
  if (!isObject(root)) return false;
  if (root.id === id) return true;
  return Object.values(root).some((value) => containsId(value, id));
}

export function subtreeHash(doc: Document, target: string): string | undefined {
  const normalized = canonicalizeDocument(doc);
  const loc = locate(normalized, target);
  if (!loc) return undefined;
  if (loc.list === 'columns') {
    const column = loc.value;
    return hashOf({ column, cells: loc.parent.rows.map((row: any) => [row.id, row.cells[column.id] ?? []]) });
  }
  if (loc.list === 'categories') {
    const category = loc.value;
    return hashOf({ category, values: loc.parent.series.map((series: any) => [series.id, series.values[category.id] ?? null]) });
  }
  return hashOf(loc.value);
}

export function place(array: any[], after: string | null): number | undefined {
  if (after === null) return 0;
  const index = array.findIndex((item) => hasId(item) && item.id === after);
  return index < 0 ? undefined : index + 1;
}

function failure(index: number, code: OpError['code'], details: unknown): Result<ApplyOpsResult, OpError> {
  return { ok: false, error: { index, code, details } };
}

export function remapOp(op: Op, idMap: Record<string, string>): Op {
  if (op.op === 'set') {
    const field = op.at.field.startsWith('cell:') ? `cell:${mapKnownId(op.at.field.slice(5), idMap)}` : op.at.field.startsWith('value:') ? `value:${mapKnownId(op.at.field.slice(6), idMap)}` : op.at.field;
    return { ...op, at: { ...op.at, id: mapKnownId(op.at.id, idMap), field } };
  }
  if (op.op === 'insert') return { ...op, parent: mapRef(op.parent, idMap), after: op.after ? mapKnownId(op.after, idMap) : null, node: remapNode(op.node, idMap) };
  if (op.op === 'delete') return { ...op, target: mapKnownId(op.target, idMap) };
  return { ...op, target: mapKnownId(op.target, idMap), parent: mapRef(op.parent, idMap), after: op.after ? mapKnownId(op.after, idMap) : null,
    ...(op.from ? { from: { parent: mapRef(op.from.parent, idMap), after: op.from.after ? mapKnownId(op.from.after, idMap) : null } } : {}) };
}

export function applyOpsStrict(input: Document, operations: Op[], ids: IdSource): Result<ApplyOpsResult, OpError> {
  const parsedOps = OpsSchema.safeParse(operations);
  if (!parsedOps.success) {
    const index = typeof parsedOps.error.issues[0]?.path[0] === 'number' ? parsedOps.error.issues[0]!.path[0] as number : -1;
    return failure(index, 'VALIDATION_FAILED', { issues: parsedOps.error.issues });
  }
  const initial = validateDocument(input);
  if (!initial.ok) return failure(-1, 'VALIDATION_FAILED', { issues: initial.error });
  const doc = cloneValue(initial.value);
  const tmpIds = new Set<string>();
  try {
    for (const op of operations) if (op.op === 'insert') collectInsertedIds(op.node, op.parent.list === 'modules' ? 'm' : 'n', tmpIds);
  } catch (error) { return failure(-1, 'VALIDATION_FAILED', { message: error instanceof Error ? error.message : String(error) }); }
  const idMap: Record<string, string> = {};
  const used = new Set<string>([doc.id]);
  const gatherExisting = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(gatherExisting); return; }
    if (!isObject(value)) return;
    if (typeof value.id === 'string') used.add(value.id);
    Object.values(value).forEach(gatherExisting);
  };
  gatherExisting(doc);
  for (const tempId of tmpIds) {
    const moduleId = operations.some((op) => op.op === 'insert' && op.parent.list === 'modules' && op.node.id === tempId);
    const prefix = moduleId ? 'm' : 'n';
    const formal = ids.next(prefix, tempId);
    const pattern = prefix === 'm' ? /^m_[a-z2-7]{8}$/ : /^n_[a-z2-7]{8}$/;
    if (!pattern.test(formal) || used.has(formal)) return failure(-1, 'VALIDATION_FAILED', { message: `IdSource returned invalid or duplicate id for ${tempId}` });
    used.add(formal);
    idMap[tempId] = formal;
  }
  const mapped = operations.map((op) => remapOp(op, idMap));
  for (let index = 0; index < mapped.length; index += 1) {
    const op = mapped[index]!;
    if (op.op === 'set') {
      const info = fieldInfo(doc, op.at.id, op.at.field);
      if (!info) return failure(index, 'VALIDATION_FAILED', { message: 'Unknown target or field', at: op.at });
      if (canonicalJson(canonicalField(info.current)) !== canonicalJson(canonicalField(op.before))) return failure(index, 'PRECONDITION_FAILED', { message: 'Current field value differs from before', at: op.at });
      if (!typeValid(op.at.field, op.after, info)) return failure(index, 'VALIDATION_FAILED', { message: 'Invalid field value', at: op.at });
      setField(doc, op.at.id, op.at.field, op.after);
      continue;
    }
    if (op.op === 'insert') {
      const destination = arrayFor(doc, op.parent);
      if (!destination || !allowedInList(destination.parent, destination.parentKind, op.parent.list, op.node as unknown as Record<string, any>)) return failure(index, 'VALIDATION_FAILED', { message: 'Invalid insertion parent or node type', parent: op.parent });
      const position = place(destination.array, op.after);
      if (position === undefined) return failure(index, 'PRECONDITION_FAILED', { message: 'Insertion anchor is not in target list', after: op.after });
      destination.array.splice(position, 0, cloneValue(op.node));
      continue;
    }
    const location = locate(doc, op.target);
    if (!location) return failure(index, 'VALIDATION_FAILED', { message: 'Unknown target', target: op.target });
    if (op.op === 'delete') {
      const actualHash = subtreeHash(doc, op.target);
      if (actualHash !== op.beforeHash) return failure(index, 'PRECONDITION_FAILED', { message: 'Target subtree hash differs from beforeHash', target: op.target, actualHash });
      if (location.list === 'columns') for (const row of location.parent.rows) delete row.cells[op.target];
      if (location.list === 'categories') for (const series of location.parent.series) delete series.values[op.target];
      location.array.splice(location.index, 1);
      continue;
    }
    if (op.target === doc.id) return failure(index, 'VALIDATION_FAILED', { message: 'Document cannot be moved' });
    const destination = arrayFor(doc, op.parent);
    if (!destination || !allowedInList(destination.parent, destination.parentKind, op.parent.list, location.value)) return failure(index, 'VALIDATION_FAILED', { message: 'Invalid move parent or node type', parent: op.parent });
    if (containsId(location.value, op.parent.id)) return failure(index, 'VALIDATION_FAILED', { message: 'Cannot move a node into its descendant', target: op.target, parent: op.parent });
    if (op.after === op.target) return failure(index, 'VALIDATION_FAILED', { message: 'Move anchor cannot be the target itself', target: op.target });
    const oldAfter = location.after;
    const from: MoveOp['from'] = { parent: { id: location.parentId, list: location.list }, after: oldAfter };
    const oldArray = location.array;
    const oldIndex = location.index;
    const [moving] = oldArray.splice(oldIndex, 1);
    const position = place(destination.array, op.after);
    if (position === undefined) {
      oldArray.splice(oldIndex, 0, moving);
      return failure(index, 'PRECONDITION_FAILED', { message: 'Move anchor is not in target list', after: op.after });
    }
    destination.array.splice(position, 0, moving);
    mapped[index] = { ...op, from };
  }
  // Validate references before canonicalization; normalization must not erase invalid cells/values.
  const checked = validateDocument(doc);
  if (!checked.ok) return failure(Math.max(mapped.length - 1, 0), 'VALIDATION_FAILED', { issues: checked.error as ValidationIssue[] });
  return { ok: true, value: { doc: checked.value, ops: mapped, idMap } };
}
