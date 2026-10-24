import { anchorText, relocateAnchor, type Anchor, type AnchorState } from '../../core/src/anchors';
import type { Document } from '../../core/src/model';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function findNode(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) { const found = findNode(child, id); if (found) return found; }
  } else if (isObject(value)) {
    if (value.id === id) return value;
    for (const child of Object.values(value)) { const found = findNode(child, id); if (found) return found; }
  }
  return undefined;
}

/** Validate a newly supplied selection against the exact version the reader saw.
 * Existing saved anchors continue to use the more permissive relocation algorithm. */
export function validateCommentAnchor(anchor: Anchor, snapshot: Document): 'ANCHOR_NOT_FOUND' | 'INVALID_ANCHOR_FIELD' | 'ANCHOR_QUOTE_MISMATCH' | undefined {
  const module = snapshot.modules.find((item) => item.id === anchor.moduleId);
  if (anchor.moduleId !== undefined && !module) return 'ANCHOR_NOT_FOUND';
  if (anchor.blockId === undefined) {
    if (anchor.field !== undefined || anchor.quote !== undefined || anchor.prefix !== undefined || anchor.suffix !== undefined) return 'INVALID_ANCHOR_FIELD';
    return undefined;
  }
  // When a module is supplied, searching only that module prevents a node from
  // another module or document silently turning into a module-level comment.
  const node = findNode(module ? module.blocks : snapshot.modules.map((item) => item.blocks), anchor.blockId);
  if (!node) return 'ANCHOR_NOT_FOUND';
  if (anchor.field === undefined && anchor.quote === undefined && anchor.prefix === undefined && anchor.suffix === undefined) return undefined;
  const text = anchorText(node, anchor.field ?? 'text');
  if (text === undefined) return 'INVALID_ANCHOR_FIELD';
  if (anchor.quote === undefined) return anchor.prefix !== undefined || anchor.suffix !== undefined ? 'ANCHOR_QUOTE_MISMATCH' : undefined;
  if (!anchor.quote) return 'ANCHOR_QUOTE_MISMATCH';
  for (let start = text.indexOf(anchor.quote); start !== -1; start = text.indexOf(anchor.quote, start + 1)) {
    const end = start + anchor.quote.length;
    if (text.slice(0, start).endsWith(anchor.prefix ?? '') && text.slice(end).startsWith(anchor.suffix ?? '')) return undefined;
  }
  return 'ANCHOR_QUOTE_MISMATCH';
}

/** Build a response-only anchor whose text and coordinates belong to the visible
 * snapshot. Failed relocation deliberately cannot return retained source text. */
export function projectCommentAnchor(input: Anchor, snapshot: Document, version: number, storedState: AnchorState = 'ok'): ReturnType<typeof relocateAnchor> {
  const located = relocateAnchor(input, snapshot);
  let state = storedState === 'block_deleted' && !input.blockId && located.state === 'ok' ? 'block_deleted' : located.state;
  const anchor: Anchor = { version };
  const module = snapshot.modules.find((item) => item.id === located.anchor.moduleId);
  if (module) anchor.moduleId = module.id;
  const node = module && located.anchor.blockId ? findNode(module.blocks, located.anchor.blockId) : undefined;
  if (node) anchor.blockId = located.anchor.blockId;
  const text = node ? anchorText(node, located.anchor.field ?? 'text') : undefined;
  if (text !== undefined && located.anchor.field !== undefined) anchor.field = located.anchor.field;
  if (node && located.anchor.field !== undefined && text === undefined && state === 'ok') state = 'text_changed';
  const range = located.range;
  if (state === 'ok' && text !== undefined && range && range.start >= 0 && range.end > range.start && range.end <= text.length) {
    anchor.quote = text.slice(range.start, range.end);
    anchor.prefix = text.slice(Math.max(0, range.start - 32), range.start);
    anchor.suffix = text.slice(range.end, range.end + 32);
    return { anchor, state, range: { ...range } };
  }
  return { anchor, state };
}
