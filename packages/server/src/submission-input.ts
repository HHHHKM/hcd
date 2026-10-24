import { parseFragment } from 'parse5';
import { z } from 'zod';
import { canonicalJson, createCounterTmpIdSource, limits, type Document, type IdSource } from '../../core/src/model';
import { SnapshotConversionError, snapshotToOperations } from '../../core/src/snapshot-ops';
import { applyOpsStrict, OpsSchema, type Op } from '../../core/src/ops';
import { diffDocuments } from '../../core/src/diff';
import { reconcile, markUncertainOperations } from '../../core/src/reconcile';
import { parseSpecDocument, type DocumentDraft, type ModuleDraft } from '../../core/src/spec-html';
import { isImportTreeBounded, type ImportNode } from '../../core/src/import-patterns';
export class SubmissionInputError extends Error { constructor(readonly status: number, readonly code: string, readonly details?: unknown) { super(code); } }
const moduleId = z.string().regex(/^m_[a-z2-7]{8}$/);
export const ModuleHtmlSchema = z.array(z.object({ moduleId: moduleId.optional(), html: z.string().min(1).max(500_000), after: moduleId.nullable().optional() }).strict()).max(100);
export const SubmissionInputSchema = z.object({ baseVersion: z.number().int().positive(), message: z.string().max(500).optional(), content: z.unknown().optional(), ops: OpsSchema.optional(), moduleHtml: ModuleHtmlSchema.optional(), deleteModules: z.array(moduleId).max(100).optional(), aiTaskId: z.string().optional(), claimId: z.string().optional(), idempotencyKey: z.string().min(1).max(100).optional() }).strict().superRefine((value, context) => {
  if (['content', 'ops', 'moduleHtml'].filter((key) => Object.hasOwn(value, key)).length !== 1) context.addIssue({ code: 'custom', message: 'Provide exactly one of content, ops or moduleHtml' });
  if (value.deleteModules && !value.moduleHtml) context.addIssue({ code: 'custom', message: 'deleteModules requires moduleHtml' });
  if (value.ops?.some((op) => op.uncertain)) context.addIssue({ code: 'custom', message: 'uncertainty is assigned by the server' });
});
export type SubmissionInput = z.infer<typeof SubmissionInputSchema>;
export function parseSubmissionInput(value: unknown): SubmissionInput {
  if (!boundedJson(value)) throw new SubmissionInputError(413, 'SUBMISSION_TOO_COMPLEX');
  const parsed = SubmissionInputSchema.safeParse(value);
  if (!parsed.success) throw new SubmissionInputError(400, 'VALIDATION_FAILED', parsed.error.issues);
  return parsed.data;
}
function boundedJson(value: unknown) { const pending: Array<[unknown, number]> = [[value, 0]]; let count = 0; while (pending.length) { const [item, depth] = pending.pop()!; if (++count > 100_000 || depth > 64) return false; if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, depth + 1]); } return true; }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function identities(value: unknown, seen = new Set<string>()) { if (Array.isArray(value)) { value.forEach((child) => identities(child, seen)); return seen; } if (!object(value)) return seen; if (typeof value.id === 'string' && value.id) { if (seen.has(value.id)) throw new SubmissionInputError(400, 'DUPLICATE_ID', { id: value.id }); seen.add(value.id); } Object.values(value).forEach((child) => identities(child, seen)); return seen; }
const chartIdentity = z.string().min(1).max(100).optional();
const chartPayload = z.object({
  title: z.string().max(limits.title), unit: z.string().max(limits.inline),
  categories: z.array(z.object({ id: chartIdentity, label: z.string().max(limits.inline) }).strict()).max(limits.chartCategories),
  series: z.array(z.object({ id: chartIdentity, name: z.string().max(limits.inline), values: z.array(z.number().finite().nullable()).max(limits.chartCategories) }).strict()).max(limits.chartSeries),
}).strict().superRefine((value, context) => {
  if (value.series.some(series => series.values.length !== value.categories.length)) context.addIssue({ code: 'custom', message: 'Each chart series must have one value per category' });
});
const attribute = (node: ImportNode | undefined, name: string) => node?.attrs?.find(attr => attr.name === name)?.value;
function allowChartPayload(node: ImportNode, ancestors: ImportNode[], root: ImportNode): ImportNode {
  const parent = ancestors.at(-1); const container = ancestors.at(-2);
  const inModule = parent === root;
  const inContainer = ancestors.length === 3 && ancestors[0] === root && parent?.tagName === 'div' && container?.tagName === 'div'
    && ((attribute(container, 'data-block') === 'columns' && attribute(parent, 'data-col') !== undefined)
      || (attribute(container, 'data-block') === 'cards' && attribute(parent, 'data-card') !== undefined));
  const children = (node.childNodes ?? []).filter(child => child.nodeName !== '#text' || Boolean(child.value?.trim()));
  const script = children[0];
  // This is the serializer's inert data block, never an exception for arbitrary scripts.
  if ((!inModule && !inContainer) || !['bar', 'line', 'pie'].includes(attribute(node, 'data-kind') ?? '') || children.length !== 1
    || script?.tagName !== 'script' || script.attrs?.length !== 1 || attribute(script, 'type') !== 'application/hcd+json'
    || (script.childNodes ?? []).some(child => child.nodeName !== '#text')) throw new SubmissionInputError(400, 'UNSUPPORTED_MODULE_HTML');
  let payload: unknown;
  try { payload = JSON.parse((script.childNodes ?? []).map(child => child.value ?? '').join('')); }
  catch { throw new SubmissionInputError(400, 'MODULE_HTML_INVALID'); }
  if (!chartPayload.safeParse(payload).success) throw new SubmissionInputError(400, 'MODULE_HTML_INVALID');
  return script;
}
function parseModule(html: string): ModuleDraft {
  let duplicateAttribute = false;
  const tree = parseFragment(html, { onParseError: error => { if (error.code === 'duplicate-attribute') duplicateAttribute = true; } }) as unknown as ImportNode;
  if (duplicateAttribute) throw new SubmissionInputError(400, 'UNSUPPORTED_MODULE_HTML');
  if (!isImportTreeBounded(tree, 20_000, 40)) throw new SubmissionInputError(413, 'SUBMISSION_TOO_COMPLEX');
  const elements = (tree.childNodes ?? []).filter((node) => node.tagName);
  if (elements.length !== 1 || elements[0]!.tagName !== 'section' || !(elements[0]!.attrs ?? []).some((attr) => attr.name === 'data-module') || (tree.childNodes ?? []).some((node) => node.nodeName === '#text' && node.value?.trim())) throw new SubmissionInputError(400, 'MODULE_HTML_WRAPPER');
  const root = elements[0]!; const allowedScripts = new Set<ImportNode>();
  const pending: Array<{ node: ImportNode; ancestors: ImportNode[] }> = [{ node: root, ancestors: [] }];
  while (pending.length) {
    const { node, ancestors } = pending.pop()!;
    if (node.tagName === 'figure' && attribute(node, 'data-block') === 'chart') allowedScripts.add(allowChartPayload(node, ancestors, root));
    if ((node.tagName === 'script' && !allowedScripts.has(node)) || ['style', 'iframe', 'object', 'embed', 'template'].includes(node.tagName ?? '') || (node.attrs ?? []).some(attr => attr.name.startsWith('on'))) throw new SubmissionInputError(400, 'UNSUPPORTED_MODULE_HTML');
    for (const child of node.childNodes ?? []) pending.push({ node: child, ancestors: [...ancestors, node] });
  }
  const parsed = parseSpecDocument(html);
  if (!parsed.ok || parsed.value.doc.modules.length !== 1) throw new SubmissionInputError(400, 'MODULE_HTML_INVALID', !parsed.ok ? parsed.error : undefined);
  if (parsed.value.issues.length) throw new SubmissionInputError(400, 'MODULE_HTML_INVALID', parsed.value.issues);
  return parsed.value.doc.modules[0]!;
}
export function materializeSubmission(base: Document, input: SubmissionInput, ids: IdSource) {
  if (input.content !== undefined) {
    try {
      const applied = snapshotToOperations(base, input.content);
      // JSON clients already supplied permanent IDs; keep their receipt contract.
      return { content: applied.doc, ops: applied.ops, idMap: {}, uncertain: [] as string[] };
    } catch (error) {
      if (error instanceof SnapshotConversionError) throw new SubmissionInputError(error.code === 'TOO_MANY_OPERATIONS' ? 413 : error.code === 'VALIDATION_FAILED' || error.code === 'DOCUMENT_ID_MISMATCH' ? 400 : 422, error.code, error.details);
      throw error;
    }
  }
  let ops: Op[]; let uncertain: string[] = [];
  if (input.ops) ops = input.ops as Op[];
  else {
    const entries = input.moduleHtml!; const deleted = new Set(input.deleteModules ?? []);
    if (deleted.size !== (input.deleteModules?.length ?? 0)) throw new SubmissionInputError(400, 'DUPLICATE_MODULE');
    if ([...deleted].some((id) => !base.modules.some((module) => module.id === id))) throw new SubmissionInputError(400, 'MODULE_NOT_FOUND');
    const draft: DocumentDraft = structuredClone(base); draft.modules = draft.modules.filter((module) => !deleted.has(module.id!));
    const edited = new Set<string>(); const insertedAfter = new Map<string | null, ModuleDraft>();
    for (const entry of entries) {
      const parsed = parseModule(entry.html); const inferredId = parsed.id;
      if (entry.moduleId && inferredId && inferredId !== entry.moduleId) throw new SubmissionInputError(400, 'MODULE_ID_MISMATCH');
      const targetId = entry.moduleId ?? (inferredId && base.modules.some((module) => module.id === inferredId) ? inferredId : undefined);
      if (entry.moduleId && !base.modules.some((module) => module.id === entry.moduleId)) throw new SubmissionInputError(400, 'MODULE_NOT_FOUND');
      if (targetId) {
        if (deleted.has(targetId) || edited.has(targetId) || entry.after !== undefined) throw new SubmissionInputError(400, 'MODULE_UPDATE_CONFLICT');
        edited.add(targetId); parsed.id = targetId;
        // ID-preserving updates may move nodes only inside the supplied module. Cross-module moves use ops.
        const own = identities(base.modules.find((module) => module.id === targetId)); const all = identities(base);
        for (const id of identities(parsed)) if (all.has(id) && !own.has(id)) throw new SubmissionInputError(400, 'FOREIGN_NODE_ID', { id });
        draft.modules[draft.modules.findIndex((module) => module.id === targetId)] = parsed;
      } else {
        if (inferredId && identities(base).has(inferredId)) throw new SubmissionInputError(400, 'MODULE_ID_MISMATCH');
        for (const id of identities(parsed)) if (identities(base).has(id)) throw new SubmissionInputError(400, 'FOREIGN_NODE_ID', { id });
        if (entry.after === undefined) draft.modules.push(parsed);
        else {
          if (entry.after && (!base.modules.some((module) => module.id === entry.after) || deleted.has(entry.after))) throw new SubmissionInputError(400, 'MODULE_ANCHOR_NOT_FOUND');
          const previous = insertedAfter.get(entry.after); const index = previous ? draft.modules.indexOf(previous) : entry.after === null ? -1 : draft.modules.findIndex((module) => module.id === entry.after);
          draft.modules.splice(index + 1, 0, parsed); insertedAfter.set(entry.after, parsed);
        }
      }
    }
    identities(draft);
    try {
      // Explicit new module entries must not be matched back to deleted modules.
      const matchingBase = { ...base, modules: base.modules.filter((module) => !deleted.has(module.id)) };
      const recovered = reconcile(matchingBase, draft); uncertain = [...recovered.uncertainIds];
      ops = markUncertainOperations(diffDocuments(base, recovered.doc, createCounterTmpIdSource('html')), recovered.uncertainIds);
    } catch (error) { throw new SubmissionInputError(422, error instanceof Error && error.message === 'RECONCILE_TOO_COMPLEX' ? 'SUBMISSION_TOO_COMPLEX' : 'MODULE_HTML_INVALID'); }
  }
  if (!ops.length) throw new SubmissionInputError(400, 'NO_CHANGES');
  if (ops.length > 500) throw new SubmissionInputError(413, 'TOO_MANY_OPERATIONS');
  const applied = applyOpsStrict(base, ops, ids);
  if (!applied.ok) throw new SubmissionInputError(422, applied.error.code, applied.error);
  return { content: applied.value.doc, ops: applied.value.ops, idMap: applied.value.idMap, uncertain };
}
export function submissionRequestFingerprint(input: SubmissionInput): string { const { idempotencyKey: _key, ...payload } = input; return canonicalJson({ formatVersion: 1, ...payload, message: payload.message ?? '' }); }
