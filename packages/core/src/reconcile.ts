import type { Document } from './model';
import type { DocumentDraft } from './spec-html';
import type { Op } from './ops';

type Node = Record<string, unknown> & { id?: string };
const lists = new Set(['modules', 'blocks', 'items', 'cols', 'columns', 'rows', 'categories', 'series']);
const object = (value: unknown): value is Node => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const childLists = (node: Node): Array<[string, Node[]]> => Object.entries(node).filter(([key, value]) => lists.has(key) && Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).filter(object)]);
function kind(node: Node, list: string, parent: Node): string { return typeof node.type === 'string' ? `block:${node.type}` : `${list}:${parent.type ?? (list === 'modules' ? 'document' : '')}`; }
function plain(node: unknown): string {
  if (Array.isArray(node)) return node.map(plain).join(' ');
  if (!object(node)) return '';
  if (typeof node.t === 'string') return node.t;
  const cellText = (value: unknown): string => Array.isArray(value) ? value.map(plain).join(' ') : object(value) ? Object.values(value).map(cellText).join(' ') : '';
  const textFields = new Set(['title', 'text', 'label', 'name', 'caption', 'alt', 'header', 'value', 'delta', 'note']);
  return Object.entries(node).flatMap(([key, value]) => key === 'cells' ? [cellText(value)] : textFields.has(key) && typeof value === 'string' ? [value] : (lists.has(key) || key === 'cells' || textFields.has(key)) ? [plain(value)] : []).join(' ').replace(/\s+/g, ' ').trim();
}
/** Preserve explicit IDs globally; infer missing IDs only among siblings of the same kind. */
export function reconcile(base: Document, input: DocumentDraft, cellBudget = 4_000_000): { doc: DocumentDraft; uncertainIds: Set<string> } {
  const doc = structuredClone(input); const uncertainIds = new Set<string>();
  const existing = new Map<string, { node: Node; kind: string }>();
  const index = (parent: Node) => { for (const [list, children] of childLists(parent)) for (const node of children) { if (node.id) existing.set(node.id, { node, kind: kind(node, list, parent) }); index(node); } };
  index(base as unknown as Node);
  const used = new Set<string>(); const seen = new Set<string>(); const duplicates = new WeakSet<Node>(); const references = new Map<string, string>();
  const reserve = (parent: Node) => { for (const [list, children] of childLists(parent)) for (const node of children) {
    if (node.id && seen.has(node.id)) { delete node.id; duplicates.add(node); }
    else if (node.id) { seen.add(node.id); const old = existing.get(node.id); if (old) { if (old.kind !== kind(node, list, parent)) throw new Error('RECONCILE_ID_TYPE_MISMATCH'); used.add(node.id); } }
    reserve(node);
  } };
  reserve(doc as unknown as Node);
  let remaining = cellBudget; let comparisons = 0; const textCache = new WeakMap<Node, string>();
  const textOf = (node: Node) => { if (!textCache.has(node)) textCache.set(node, plain(node)); return textCache.get(node)!; };
  const similarity = (a: string, b: string) => {
    if (a === b) return a ? 1 : 0;
    const left = Array.from(a); const right = Array.from(b); const max = Math.max(left.length, right.length, 1);
    if (Math.min(left.length, right.length) / max < 0.3) return 0;
    remaining -= left.length * right.length;
    if (remaining < 0) throw new Error('RECONCILE_TOO_COMPLEX');
    let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let i = 0; i < left.length; i++) { const next = [i + 1]; for (let j = 0; j < right.length; j++) next.push(Math.min(next[j]! + 1, previous[j + 1]! + 1, previous[j]! + (left[i] === right[j] ? 0 : 1))); previous = next; }
    return 1 - previous[right.length]! / max;
  };
  const match = (oldParent: Node | undefined, newParent: Node) => {
    for (const [list, nodes] of childLists(newParent)) {
      const oldNodes = oldParent && Array.isArray(oldParent[list]) ? (oldParent[list] as Node[]) : [];
      const pairs: Array<{ score: number; old: Node; next: Node; oldIndex: number; newIndex: number; ambiguous?: boolean }> = [];
      nodes.forEach((next, newIndex) => {
        if ((next.id && existing.has(next.id)) || duplicates.has(next)) return;
        oldNodes.forEach((old, oldIndex) => { if (old.id && !used.has(old.id) && kind(old, list, oldParent!) === kind(next, list, newParent)) { if (++comparisons > 50_000) throw new Error('RECONCILE_TOO_COMPLEX'); const score = similarity(textOf(old), textOf(next)); if (score >= 0.3) pairs.push({ score, old, next, oldIndex, newIndex }); } });
      });
      pairs.sort((a, b) => b.score - a.score || a.oldIndex - b.oldIndex || a.newIndex - b.newIndex);
      const previousOld = new Map<Node, typeof pairs[number]>(); const previousNew = new Map<Node, typeof pairs[number]>();
      for (const pair of pairs) {
        for (const other of [previousOld.get(pair.old), previousNew.get(pair.next)]) if (other && other.score - pair.score < 0.05) { other.ambiguous = true; pair.ambiguous = true; }
        previousOld.set(pair.old, pair); previousNew.set(pair.next, pair);
      }
      const assigned = new WeakSet<Node>();
      for (const pair of pairs) {
        if (used.has(pair.old.id!) || assigned.has(pair.next)) continue;
        if (pair.next.id) references.set(pair.next.id, pair.old.id!);
        pair.next.id = pair.old.id; used.add(pair.old.id!); assigned.add(pair.next);
        if (pair.score < 0.6 || pair.ambiguous) uncertainIds.add(pair.old.id!);
      }
      for (const node of nodes) match(node.id ? existing.get(node.id)?.node : undefined, node);
    }
  };
  match(base as unknown as Node, doc as unknown as Node);
  const remap = (value: unknown) => { if (Array.isArray(value)) { value.forEach(remap); return; } if (!object(value)) return; for (const [key, child] of Object.entries(value)) { if ((key === 'cells' || key === 'values') && object(child)) value[key] = Object.fromEntries(Object.entries(child).map(([id, entry]) => [references.get(id) ?? id, entry])); else remap(child); } };
  remap(doc);
  return { doc, uncertainIds };
}
export function markUncertainOperations(ops: Op[], ids: Set<string>): Op[] {
  const touched = (value: unknown): boolean => Array.isArray(value) ? value.some(touched) : object(value) ? Object.entries(value).some(([key, child]) => (key === 'id' && typeof child === 'string' && ids.has(child)) || touched(child)) : false;
  return ops.map((op) => ((op.op === 'set' && ids.has(op.at.id)) || (op.op === 'delete' && ids.has(op.target)) || (op.op === 'insert' && (ids.has(op.parent.id) || touched(op.node))) || (op.op === 'move' && (ids.has(op.target) || ids.has(op.parent.id)))) ? { ...op, uncertain: true } : op);
}
