import { parseFragment } from 'parse5';
import { canonicalJson, canonicalizeDocument, createCounterIdSource, createCounterTmpIdSource, validateDocument, type Document, type Module } from '../../core/src/model';
import { parseSpecDocument, serializeModule, type DocumentDraft, type ModuleDraft } from '../../core/src/spec-html';
import { reconcile, markUncertainOperations } from '../../core/src/reconcile';
import { diffDocuments } from '../../core/src/diff';
import { applyOpsStrict, type Op } from '../../core/src/ops';
import { isImportTreeBounded, type ImportNode } from '../../core/src/import-patterns';

export type LocalSource = { name: string; html: string };
export type LocalFileIdentity = { name: string; id: string };
export type PlannedSubmissionInput = { ops: Op[] } | { moduleHtml: Array<{ moduleId?: string; html: string; after?: string | null }>; deleteModules: string[] };
export type SubmissionPlan = {
  input: PlannedSubmissionInput | null; submissionError?: string;
  document: Document; operations: Op[]; uncertainIds: string[]; opCount: number;
  files: Array<{ name: string; moduleId: string }>;
  status: { added: string[]; modified: string[]; deleted: string[]; moved: string[]; renamed: string[]; warnings: string[] };
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nodeLists = new Set(['modules', 'blocks', 'items', 'cols', 'columns', 'rows', 'categories', 'series']);
const attribute = (node: ImportNode, name: string) => node.attrs?.find(attr => attr.name === name)?.value;
function visitNodes(value: unknown, visit: (node: Record<string, unknown>, list: string) => void, list = ''): void {
  if (Array.isArray(value)) { value.forEach(child => visitNodes(child, visit, list)); return; }
  if (!object(value)) return;
  if (list) visit(value, list);
  for (const [key, child] of Object.entries(value)) if (nodeLists.has(key)) visitNodes(child, visit, key);
}
function identities(value: unknown): Set<string> {
  const ids = new Set<string>();
  visitNodes(value, node => {
    if (typeof node.id !== 'string' || !node.id) return;
    if (ids.has(node.id)) throw new Error(`Duplicate ID ${node.id} in local HTML files.`);
    ids.add(node.id);
  });
  return ids;
}
function parseTree(html: string, name: string): ImportNode {
  let parseError = false;
  const tree = parseFragment(html, { onParseError: () => { parseError = true; } }) as unknown as ImportNode;
  if (parseError || !isImportTreeBounded(tree, 20_000, 40)) throw new Error(`Invalid or overly complex Spec HTML in ${name}.`);
  const roots = (tree.childNodes ?? []).filter(node => node.tagName || node.nodeName === '#text' && node.value?.trim());
  if (roots.length !== 1 || roots[0]!.tagName !== 'section' || attribute(roots[0]!, 'data-module') === undefined) throw new Error(`Expected exactly one module section in ${name}.`);
  const pending: Array<{ node: ImportNode; parent?: ImportNode }> = [{ node: roots[0]! }];
  while (pending.length) {
    const { node, parent } = pending.pop()!;
    if (['style', 'iframe', 'object', 'embed', 'template'].includes(node.tagName ?? '') || (node.attrs ?? []).some(attr => attr.name.startsWith('on'))) throw new Error(`Unsupported executable content in ${name}.`);
    if (node.tagName === 'script') {
      const siblings = (parent?.childNodes ?? []).filter(child => child.tagName || child.nodeName === '#text' && child.value?.trim());
      if (parent?.tagName !== 'figure' || attribute(parent, 'data-block') !== 'chart' || siblings.length !== 1 || node.attrs?.length !== 1 || attribute(node, 'type') !== 'application/hcd+json') throw new Error(`Unsupported executable content in ${name}.`);
      try {
        const payload: unknown = JSON.parse((node.childNodes ?? []).map(child => child.value ?? '').join(''));
        const pendingValues: Array<[unknown, number]> = [[payload, 0]]; let count = 0;
        while (pendingValues.length) {
          const [value, depth] = pendingValues.pop()!;
          if (++count > 100_000 || depth > 16) throw new Error('Chart data is too complex');
          if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite chart number');
          if (value && typeof value === 'object') for (const child of Object.values(value)) pendingValues.push([child, depth + 1]);
        }
      } catch { throw new Error(`Invalid chart data in ${name}.`); }
    }
    for (const child of node.childNodes ?? []) pending.push({ node: child, parent: node });
  }
  return roots[0]!;
}
/** Reject information the permissive import parser would silently discard. */
function treeContent(node: ImportNode): unknown {
  if (node.nodeName === '#comment') return null;
  if (node.nodeName === '#text') return node.value?.replace(/\s+/g, ' ').trim() || null;
  const tag = node.tagName === 'b' ? 'strong' : node.tagName === 'i' ? 'em' : node.tagName;
  const attributes = Object.fromEntries((node.attrs ?? []).filter(attr => attr.name !== 'data-id').map(attr => {
    let value = attr.value;
    if (attr.name === 'href') { try { value = new URL(value).href; } catch { /* Round-trip comparison rejects unsupported links. */ } }
    return [attr.name, value];
  }));
  const children = tag === 'script'
    ? JSON.parse((node.childNodes ?? []).map(child => child.value ?? '').join(''))
    : (node.childNodes ?? []).map(treeContent).filter(child => child !== null);
  return { tag, attributes, children };
}
function parseSource(source: LocalSource, tree: ImportNode): ModuleDraft {
  if (!source.name || /[\\/]/.test(source.name) || !/\.html$/i.test(source.name) || source.html.length > 500_000) throw new Error('Invalid local module filename or oversized HTML file.');
  const parsed = parseSpecDocument(source.html);
  if (!parsed.ok || parsed.value.doc.modules.length !== 1) throw new Error(`Cannot parse ${source.name}.`);
  if (parsed.value.issues.some(issue => issue.code === 'doc.import.duplicate_id')) throw new Error(`Duplicate IDs in ${source.name}.`);
  if (parsed.value.issues.length) throw new Error(`Unsupported Spec HTML in ${source.name}: ${parsed.value.issues.map(issue => issue.code).join(', ')}.`);
  const module = parsed.value.doc.modules[0]!;
  // IDs do not affect the round-trip check: reconciliation happens only after all
  // source content has been checked, and missing IDs remain missing in the wire HTML.
  const serialized = parseTree(serializeModule(module as Module), source.name);
  if (canonicalJson(treeContent(tree)) !== canonicalJson(treeContent(serialized))) throw new Error(`Unsupported or lossy Spec HTML in ${source.name}; preserve the HCD module structure and supported fields.`);
  return module;
}
function remapIdentities(value: unknown, mapping: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(child => remapIdentities(child, mapping));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === 'id' && typeof child === 'string') return [key, mapping.get(child) ?? child];
    if ((key === 'cells' || key === 'values') && object(child)) return [key, Object.fromEntries(Object.entries(child).map(([id, entry]) => [mapping.get(id) ?? id, remapIdentities(entry, mapping)]))];
    return [key, remapIdentities(child, mapping)];
  }));
}

/** Analyze one frozen file snapshot. Source order is document order; no filesystem or network writes occur. */
export function prepareSubmissionPlan(options: { base: Document; sourceSnapshot: LocalSource[]; files?: LocalFileIdentity[] }): SubmissionPlan {
  const checked = validateDocument(options.base); if (!checked.ok) throw new Error('Invalid base document.');
  const base = checked.value; const files = options.files ?? [];
  if (options.sourceSnapshot.length > 200 || options.sourceSnapshot.reduce((total, source) => total + Buffer.byteLength(source.html), 0) > 16 * 1024 * 1024) throw new Error('Local HTML snapshot exceeds the document input limits.');
  if (new Set(options.sourceSnapshot.map(file => file.name)).size !== options.sourceSnapshot.length) throw new Error('Duplicate local HTML filename.');
  const trees = options.sourceSnapshot.map(source => {
    if (source.html.length > 500_000) throw new Error('Oversized local HTML file.');
    return parseTree(source.html, source.name);
  });
  // Check across the whole snapshot before fidelity checks. The import parser clears
  // duplicate IDs, which must never turn a copied node into an accidental insertion.
  const sourceIds = new Set<string>([base.id]);
  const reserveId = (id: unknown) => { if (typeof id === 'string' && id) { if (sourceIds.has(id)) throw new Error(`Duplicate IDs: ${id} in local HTML files.`); sourceIds.add(id); } };
  for (const root of trees) {
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!; reserveId(attribute(node, 'data-id'));
      if (node.tagName === 'script') {
        const payload = JSON.parse((node.childNodes ?? []).map(child => child.value ?? '').join('')) as { categories?: unknown; series?: unknown } | null;
        for (const list of [payload?.categories, payload?.series]) if (Array.isArray(list)) for (const item of list) if (object(item)) reserveId(item.id);
      }
      pending.push(...(node.childNodes ?? []));
    }
  }
  const byName = new Map(files.map(file => [file.name, file.id])); const baseById = new Map(base.modules.map(module => [module.id, module]));
  const parsed = options.sourceSnapshot.map((source, index) => {
    const module = parseSource(source, trees[index]!); const known = byName.get(source.name);
    if (!module.id && known && baseById.has(known)) module.id = known;
    return module;
  });
  const draft: DocumentDraft = { ...base, modules: parsed }; identities(draft);
  const recovered = reconcile(base, draft);
  // Only after inference, give remaining new nodes deterministic local handles.
  // These are not server IDs: diff allocates wire tmp IDs and the server owns final allocation.
  const used = new Set([base.id, ...identities(base), ...identities(recovered.doc)]); let nextDraft = 0;
  visitNodes(recovered.doc, node => { if (!node.id) { let id: string; do { id = `tmp_draft_${++nextDraft}`; } while (used.has(id)); node.id = id; used.add(id); } });
  const toTemporary = new Map<string, string>();
  const operations = diffDocuments(base, recovered.doc, createCounterTmpIdSource('cli'), (original, temporary) => toTemporary.set(original, temporary));
  if (operations.length > 500) throw new Error(`TOO_MANY_OPERATIONS: ${operations.length} operations exceed the 500-operation submission limit.`);
  const localIds = createCounterIdSource();
  const applied = applyOpsStrict(base, markUncertainOperations(operations, recovered.uncertainIds), { next: prefix => { let id: string; do { id = localIds.next(prefix); } while (used.has(id)); used.add(id); return id; } });
  if (!applied.ok) throw new Error(`Local changes cannot be applied safely: ${applied.error.code}.`);
  const permanent = new Map([...toTemporary].map(([original, temporary]) => [original, applied.value.idMap[temporary]!]));
  const expected = canonicalizeDocument(remapIdentities(recovered.doc, permanent) as Document);
  if (canonicalJson(expected) !== canonicalJson(applied.value.doc)) throw new Error('Local changes cannot be represented without data loss (REPLAY_MISMATCH).');
  const document = applied.value.doc;
  const planFiles = options.sourceSnapshot.map((source, index) => ({ name: source.name, moduleId: document.modules[index]!.id }));
  const finalIds = new Set(document.modules.map(module => module.id));
  const survived = base.modules.filter(module => finalIds.has(module.id)).map(module => module.id);
  const finalOldOrder = document.modules.filter(module => baseById.has(module.id)).map(module => module.id);
  const status: SubmissionPlan['status'] = { added: [], modified: [], deleted: [], moved: [], renamed: [], warnings: [] };
  for (const [index, file] of planFiles.entries()) {
    const previous = baseById.get(file.moduleId); const oldName = files.find(old => old.id === file.moduleId)?.name;
    if (!previous) status.added.push(file.name);
    else {
      if (canonicalJson(previous) !== canonicalJson(document.modules[index])) status.modified.push(file.name);
      if (oldName && oldName !== file.name) status.renamed.push(file.name);
      if (survived.indexOf(file.moduleId) !== finalOldOrder.indexOf(file.moduleId)) status.moved.push(file.name);
    }
  }
  const deleteModules = base.modules.filter(module => !finalIds.has(module.id)).map(module => module.id);
  status.deleted = deleteModules.map(id => files.find(file => file.id === id)?.name ?? id);
  const plan: SubmissionPlan = { input: { ops: operations }, document, operations: applied.value.ops, uncertainIds: [...recovered.uncertainIds], opCount: operations.length, files: planFiles, status };
  if (!recovered.uncertainIds.size || !operations.length) return plan;
  status.warnings.push(`${recovered.uncertainIds.size} identity match(es) require owner review; raw module HTML will be reconciled by the server.`);
  const failSubmission = (reason: string) => { plan.input = null; plan.submissionError = reason; status.warnings.push(reason); return plan; };
  if (base.modules.some(module => recovered.uncertainIds.has(module.id))) return failSubmission('Uncertain module identity cannot be submitted safely. Restore its original module data-id or original filename before submitting.');
  if (canonicalJson(survived) !== canonicalJson(finalOldOrder)) return failSubmission('Uncertain identity matches and existing-module reordering cannot be submitted atomically by the current protocol. Preserve the original module order or explicitly restore the missing IDs.');
  const baseOwner = new Map<string, string>();
  for (const module of base.modules) for (const id of identities({ modules: [module] })) baseOwner.set(id, module.id);
  for (const module of document.modules) for (const id of identities({ modules: [module] })) {
    if (baseOwner.has(id) && baseOwner.get(id) !== module.id) return failSubmission('Uncertain identity matches and cross-module node moves cannot be submitted atomically by the current protocol. Restore explicit IDs before submitting the combined change.');
  }
  let after: string | null = null;
  const moduleHtml: Extract<PlannedSubmissionInput, { moduleHtml: unknown }>['moduleHtml'] = [];
  for (const [index, module] of document.modules.entries()) {
    const source = options.sourceSnapshot[index]!; const original = parsed[index]!;
    if (baseById.has(module.id)) {
      if (original.id && original.id !== module.id) return failSubmission('Recovered module identity conflicts with its explicit HTML ID. Restore the original module data-id before submitting.');
      if (canonicalJson(module) !== canonicalJson(baseById.get(module.id))) moduleHtml.push({ moduleId: module.id, html: source.html });
      after = module.id;
    } else moduleHtml.push({ html: source.html, after });
  }
  if (moduleHtml.length > 100 || deleteModules.length > 100) return failSubmission('Uncertain HTML submissions support at most 100 module updates and 100 deletions per request.');
  plan.input = { moduleHtml, deleteModules };
  return plan;
}
