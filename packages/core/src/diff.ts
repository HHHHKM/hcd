import {
  canonicalJson, canonicalizeDocument, canonicalizeInline, type Document,
  type Inline, type TmpIdSource,
} from './model';
import { arrayFor, locate, place, setField, subtreeHash, type Op, type FieldValue, type ListName, type AnyNode } from './ops';
import type { DocumentDraft } from './spec-html';

/** Structural diff for documents. The output is ordered for strict sequential application. */
export function diffDocuments(a: Document, b: DocumentDraft, tmp: TmpIdSource, onNewId?: (original: string, temporary: string) => void): Op[] {
  const before = canonicalizeDocument(a);
  const after = canonicalizeDocument((b as Document));
  const beforeIndex = indexDocument(before);
  if (before.theme.id !== after.theme.id || before.theme.version !== after.theme.version) throw new Error('IMMUTABLE_THEME_REFERENCE');
  const idMap = new Map<string, string>();
  const missingIds = new WeakMap<object, string>();
  const usedTmp = new Set<string>();
  const allocate = (): string => {
    let id = tmp.next();
    while (usedTmp.has(id)) id = tmp.next();
    usedTmp.add(id);
    return id;
  };
  const nodeLists = new Set(['modules', 'blocks', 'items', 'columns', 'rows', 'categories', 'series', 'cols']);
  const allocateDraftIds = (value: any, isRoot = false, isNode = false): void => {
    if (Array.isArray(value)) { value.forEach((item) => allocateDraftIds(item, false, isNode)); return; }
    if (!value || typeof value !== 'object') return;
    if (!isRoot && isNode) {
      if (typeof value.id === 'string' && !beforeIndex.has(value.id) && !idMap.has(value.id)) {
        const temporary = allocate(); idMap.set(value.id, temporary); onNewId?.(value.id, temporary);
      }
      else if (typeof value.id !== 'string') missingIds.set(value, allocate());
    }
    for (const [key, child] of Object.entries(value)) allocateDraftIds(child, false, nodeLists.has(key));
  };
  allocateDraftIds(after, true);
  const mapId = (id: string): string => beforeIndex.has(id) ? id : idMap.get(id) ?? id;
  const normalizeDraft = (value: any, isRoot = false, isNode = false): any => {
    if (Array.isArray(value)) return value.map((item) => normalizeDraft(item, false, isNode));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, any> = {};
    if (isRoot) result.id = before.id;
    else if (isNode) result.id = typeof value.id === 'string' ? mapId(value.id) : missingIds.get(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id') continue;
      if ((key === 'cells' || key === 'values') && child && typeof child === 'object' && !Array.isArray(child)) {
        result[key] = Object.fromEntries(Object.entries(child).map(([ref, entry]) => [mapId(ref), normalizeDraft(entry)]));
      } else result[key] = normalizeDraft(child, false, nodeLists.has(key));
    }
    return result;
  };
  const draft: any = normalizeDraft(after, true);
  const opsSet: Op[] = [];
  const opsStructure: Op[] = [];
  const opsLateSet: Op[] = [];
  const bIndex = indexDocument(draft as Document);
  const canonicalField = (value: any): any => Array.isArray(value) ? canonicalizeInline(value as Inline) : value;
  const addSet = (id: string, field: string, oldValue: any, newValue: any): void => {
    if (canonicalJson(canonicalField(oldValue)) === canonicalJson(canonicalField(newValue))) return;
    opsSet.push({ op: 'set', at: { id, field }, before: canonicalField(oldValue) as FieldValue, after: canonicalField(newValue) as FieldValue });
  };
  const fields: Record<string, Array<{ name: string; kind: 'text' | 'scalar' }>> = {
    document: [{ name: 'title', kind: 'text' }], module: [{ name: 'title', kind: 'text' }], heading: [{ name: 'text', kind: 'text' }, { name: 'level', kind: 'scalar' }], paragraph: [{ name: 'text', kind: 'text' }], quote: [{ name: 'text', kind: 'text' }],
    list: [{ name: 'ordered', kind: 'scalar' }], callout: [{ name: 'tone', kind: 'scalar' }, { name: 'title', kind: 'text' }, { name: 'text', kind: 'text' }], image: [{ name: 'asset', kind: 'scalar' }, { name: 'alt', kind: 'text' }, { name: 'caption', kind: 'text' }, { name: 'width', kind: 'scalar' }], table: [{ name: 'caption', kind: 'text' }],
    'table-column': [{ name: 'header', kind: 'text' }, { name: 'align', kind: 'scalar' }], chart: [{ name: 'kind', kind: 'scalar' }, { name: 'title', kind: 'text' }, { name: 'unit', kind: 'text' }], 'chart-category': [{ name: 'label', kind: 'text' }], 'chart-series': [{ name: 'name', kind: 'text' }],
    timeline: [], 'timeline-item': [{ name: 'label', kind: 'text' }, { name: 'title', kind: 'text' }, { name: 'text', kind: 'text' }], kpis: [], 'kpi-item': [{ name: 'label', kind: 'text' }, { name: 'value', kind: 'text' }, { name: 'delta', kind: 'text' }, { name: 'tone', kind: 'scalar' }], columns: [{ name: 'ratio', kind: 'scalar' }], column: [], cards: [{ name: 'perRow', kind: 'scalar' }], card: [{ name: 'title', kind: 'text' }], raw: [{ name: 'asset', kind: 'scalar' }, { name: 'height', kind: 'scalar' }, { name: 'allowScripts', kind: 'scalar' }, { name: 'note', kind: 'text' }], 'list-item': [{ name: 'text', kind: 'text' }],
  };
  const typeOf = (node: any, location?: Location): string => {
    if (node === before || node === draft) return 'document';
    if (node.type) return node.type;
    if (location?.list === 'modules') return 'module';
    if (location?.list === 'columns') return 'table-column';
    if (location?.list === 'rows') return 'table-row';
    if (location?.list === 'categories') return 'chart-category';
    if (location?.list === 'series') return 'chart-series';
    if (location?.list === 'cols') return 'column';
    if (location?.list === 'items' && location.parent?.type === 'timeline') return 'timeline-item';
    if (location?.list === 'items' && location.parent?.type === 'kpis') return 'kpi-item';
    if (location?.list === 'items' && (location.parent?.type === 'list' || ('text' in (location.parent ?? {}) && Array.isArray(location.parent?.items)))) return 'list-item';
    if (location?.list === 'items' && location.parent?.type === 'cards') return 'card';
    return '';
  };
  const diffFields = (id: string, oldNode: any, newNode: any, oldLocation?: Location, newLocation?: Location): void => {
    const type = typeOf(newNode, newLocation) || typeOf(oldNode, oldLocation);
    if (typeOf(oldNode, oldLocation) !== type) throw new Error('NODE_KIND_CHANGED');
    if (type === 'raw' && oldNode.asset !== newNode.asset) throw new Error('IMMUTABLE_RAW_ASSET');
    for (const field of fields[type] ?? []) addSet(id, field.name, oldNode[field.name], newNode[field.name]);
    if (type === 'document') addSet(id, 'theme.overrides.accent', oldNode.theme?.overrides?.accent ?? null, newNode.theme?.overrides?.accent ?? null);
    if (type === 'table-row') {
      const keys = new Set([...Object.keys(oldNode.cells ?? {}), ...Object.keys(newNode.cells ?? {})]);
      for (const key of keys) {
        if (!bIndex.has(key) && oldLocation?.parentId === newLocation?.parentId) continue; // A same-parent column/category deletion removes coupled values.
        const opBefore = opsSet.length;
        addSet(id, `cell:${key}`, oldNode.cells?.[key] ?? [], newNode.cells?.[key] ?? []);
        if (!oldLocation?.parent?.columns?.some((column: { id: string }) => column.id === key) && opsSet.length > opBefore) opsLateSet.push(opsSet.pop()!);
      }
    }
    if (type === 'chart-series') {
      const keys = new Set([...Object.keys(oldNode.values ?? {}), ...Object.keys(newNode.values ?? {})]);
      for (const key of keys) {
        if (!bIndex.has(key) && oldLocation?.parentId === newLocation?.parentId) continue; // A same-parent column/category deletion removes coupled values.
        const opBefore = opsSet.length;
        addSet(id, `value:${key}`, oldNode.values?.[key] ?? null, newNode.values?.[key] ?? null);
        if (!oldLocation?.parent?.categories?.some((category: { id: string }) => category.id === key) && opsSet.length > opBefore) opsLateSet.push(opsSet.pop()!);
      }
    }
  };
  const insertedRoot = (node: any): AnyNode => {
    const copy: any = JSON.parse(JSON.stringify(node));
    const strip = (value: any, root = false): any => {
      if (Array.isArray(value)) return value.map((item) => strip(item));
      if (!value || typeof value !== 'object') return value;
      const child: any = { ...value };
      if (typeof child.id === 'string' && beforeIndex.has(child.id) && !root) return undefined;
      for (const [key, item] of Object.entries(child)) {
        if (Array.isArray(item)) child[key] = item.map((entry) => strip(entry)).filter((entry) => entry !== undefined);
        else if (item && typeof item === 'object' && key !== 'cells' && key !== 'values') child[key] = strip(item);
      }
      return child;
    };
    return strip(copy, true) as AnyNode;
  };
  const processList = (oldParent: any, newParent: any, parentId: string, list: ListName, embedded = false): void => {
    const oldArray: any[] = oldParent?.[list] ?? [];
    const newArray: any[] = newParent?.[list] ?? [];
    const oldById = new Map(oldArray.map((node) => [node.id, node]));
    const newPosition = new Map(newArray.map((node, index) => [node.id, index]));
    const commonOld = oldArray.map((node) => node.id).filter((id) => newPosition.has(id));
    const commonNew = newArray.map((node) => node.id).filter((id) => oldById.has(id));
    const stableIds = longestCommonSubsequence(commonOld, commonNew);
    for (const [position, node] of newArray.entries()) {
      const id = node.id;
      const sourceLocation = beforeIndex.get(id);
      const oldNode = oldById.get(id) ?? sourceLocation?.node;
      const previous = newArray[position - 1]?.id ?? null;
      const location = bIndex.get(id);
      if (!oldNode) {
        if (!embedded) opsStructure.push({ op: 'insert', parent: { id: parentId, list }, after: previous, node: insertedRoot(node) });
        processChildren({}, node, id, true);
      } else {
        const sameList = sourceLocation?.parentId === parentId && sourceLocation?.list === list;
        if (!sameList || !stableIds.has(id)) opsStructure.push({ op: 'move', target: id, parent: { id: parentId, list }, after: previous });
        diffFields(id, oldNode, node, sourceLocation, location);
        processChildren(oldNode, node, id, false);
      }
    }
  };
  const processChildren = (oldNode: any, newNode: any, id: string, embedded = false): void => {
    const lists: ListName[] = ['blocks', 'items', 'columns', 'rows', 'categories', 'series', 'cols'];
    for (const list of lists) if (Array.isArray(newNode?.[list]) || Array.isArray(oldNode?.[list])) processList(oldNode, newNode, id, list, embedded);
  };
  diffFields(before.id, before, draft);
  processList(before, draft, before.id, 'modules');
  const missing = [...beforeIndex.keys()].filter((id) => !bIndex.has(id));
  const removed = new Set(missing);
  for (const id of missing) {
    const location = beforeIndex.get(id)!;
    let ancestor = location.parentId;
    while (ancestor !== before.id) {
      if (removed.has(ancestor)) { removed.delete(id); break; }
      const parent = beforeIndex.get(ancestor);
      if (!parent) break;
      ancestor = parent.parentId;
    }
  }
  // Deletes of pure removed subtrees precede insertions. In particular, a column's
  // hash must not depend on IDs that the server will generate for newly inserted rows.
  // Containers with surviving descendants are removed only after those moves.
  const hasSurvivor = (node: any): boolean => {
    if (Array.isArray(node)) return node.some(hasSurvivor);
    if (!node || typeof node !== 'object') return false;
    return (typeof node.id === 'string' && bIndex.has(node.id)) || Object.values(node).some(hasSurvivor);
  };
  const early: string[] = []; const late: string[] = [];
  for (const id of removed) (hasSurvivor(beforeIndex.get(id)!.node) ? late : early).push(id);
  // Stage without final-document validation: intermediate container sizes may be
  // invalid. The caller must strictly replay the complete transaction before use.
  const staged = structuredClone(before);
  const result: Op[] = [];
  const append = (op: Op): void => {
    result.push(op);
    if (op.op === 'set') {
      if (!setField(staged, op.at.id, op.at.field, op.after)) throw new Error('DIFF_INVALID_FIELD');
    } else if (op.op === 'insert' || op.op === 'move') {
      const destination = arrayFor(staged, op.parent);
      if (!destination) throw new Error('DIFF_INVALID_PARENT');
      let node: AnyNode;
      if (op.op === 'move') {
        const source = locate(staged, op.target);
        if (!source) throw new Error('DIFF_INVALID_TARGET');
        node = source.array.splice(source.index, 1)[0];
      } else node = structuredClone(op.node);
      const position = place(destination.array, op.after);
      if (position === undefined) throw new Error('DIFF_INVALID_ANCHOR');
      destination.array.splice(position, 0, node);
    } else {
      const source = locate(staged, op.target);
      if (!source) throw new Error('DIFF_INVALID_TARGET');
      if (source.list === 'columns') for (const row of source.parent.rows) delete row.cells[op.target];
      if (source.list === 'categories') for (const series of source.parent.series) delete series.values[op.target];
      source.array.splice(source.index, 1);
    }
  };
  const remove = (id: string): void => append({ op: 'delete', target: id, beforeHash: hashOfNode(staged, id) });
  opsSet.forEach(append);
  const deepestFirst = (x: string, y: string): number => beforeIndex.get(y)!.depth - beforeIndex.get(x)!.depth;
  early.sort(deepestFirst).forEach(remove);
  opsStructure.forEach(append);
  opsLateSet.forEach(append);
  late.sort(deepestFirst).forEach(remove);
  return result;
}

type Location = { id: string; parentId: string; list: ListName; index: number; after: string | null; depth: number; parent?: any; node?: any };
function indexDocument(doc: any): Map<string, Location> {
  const result = new Map<string, Location>();
  const visit = (parent: any, parentId: string, depth: number): void => {
    const lists: ListName[] = parent.schemaVersion ? ['modules'] : ['blocks', 'items', 'columns', 'rows', 'categories', 'series', 'cols'];
    for (const list of lists) {
      const values = parent[list]; if (!Array.isArray(values)) continue;
      values.forEach((node, index) => {
        if (!node || typeof node.id !== 'string') return;
        result.set(node.id, { id: node.id, parentId, list, index, after: values[index - 1]?.id ?? null, depth: depth + 2, parent, node });
        visit(node, node.id, depth + 2);
      });
    }
  };
  visit(doc, doc.id, 0);
  return result;
}
function longestCommonSubsequence(left: string[], right: string[]): Set<string> {
  const positions = new Map(right.map((id, index) => [id, index]));
  const values = left.filter(id => positions.has(id));
  const tails: number[] = []; const previous = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i += 1) {
    const position = positions.get(values[i]!)!;
    let low = 0; let high = tails.length;
    while (low < high) { const mid = (low + high) >>> 1; if (positions.get(values[tails[mid]!]!)! < position) low = mid + 1; else high = mid; }
    if (low) previous[i] = tails[low - 1]!;
    tails[low] = i;
  }
  const result = new Set<string>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]!) result.add(values[i]!);
  return result;
}
function hashOfNode(doc: Document, id: string): string {
  const source = locate(doc, id);
  if (!source) return '';
  if (source.list === 'modules') return subtreeHash({ ...doc, modules: [source.value as Document['modules'][number]] }, id) ?? '';
  // Hash the current staged value, retaining the container that determines its
  // canonical form. A table column/chart category still includes every coupled
  // row/series; a row/series still sees all current columns/categories. Unrelated
  // modules and sibling blocks need not be normalized for each deletion.
  const block = source.list === 'blocks' ? source.value
    : source.parent.type ? { ...source.parent, [source.list]: [source.value] }
    : { id: doc.id, type: 'list', ordered: false, items: [source.value] };
  const compact = { ...doc, modules: [{ ...doc.modules[0]!, blocks: [block as Document['modules'][number]['blocks'][number]] }] };
  return subtreeHash(compact, id) ?? '';
}
