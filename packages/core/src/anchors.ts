import { z } from 'zod';
import { plainText, type Document, type Inline } from './model';

export const AnchorSchema = z.object({ moduleId: z.string().max(80).optional(), blockId: z.string().max(80).optional(), field: z.string().max(100).optional(), quote: z.string().max(500).optional(), prefix: z.string().max(32).optional(), suffix: z.string().max(32).optional(), version: z.number().int().positive().optional() }).strict();
export type Anchor = z.infer<typeof AnchorSchema>;
export type AnchorState = 'ok' | 'text_changed' | 'block_deleted' | 'lost';
type Range = { start: number; end: number };
type Located = { anchor: Anchor; state: AnchorState; range?: Range };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function findNode(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) { for (const child of value) { const found = findNode(child, id); if (found) return found; } }
  else if (object(value)) { if (value.id === id) return value; for (const child of Object.values(value)) { const found = findNode(child, id); if (found) return found; } }
  return undefined;
}
export function anchorText(node: Record<string, unknown>, field: string): string | undefined {
  const value = field.startsWith('cell:') && object(node.cells) ? node.cells[field.slice(5)] : ['text', 'title', 'label', 'header', 'caption', 'alt', 'value', 'delta', 'name'].includes(field) ? node[field] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((run) => object(run) && (typeof run.t === 'string' || run.br === true))) return plainText(value as Inline);
  return undefined;
}
function contextScore(text: string, start: number, end: number, prefix: string, suffix: string) {
  let score = 0;
  for (let i = 1; i <= prefix.length && start - i >= 0 && text[start - i] === prefix[prefix.length - i]; i++) score++;
  for (let i = 0; i < suffix.length && text[end + i] === suffix[i]; i++) score++;
  return score;
}

/** Approximate substring alignment, allowing insertions/deletions but never guessing below 70%. */
function fuzzyRange(pattern: string, text: string, quoteStart: number, quoteEnd: number): Range | undefined {
  if (!pattern || !text) return undefined;
  let previous = new Uint16Array(text.length + 1); let starts = Uint32Array.from({ length: text.length + 1 }, (_, i) => i);
  for (let i = 1; i <= pattern.length; i++) {
    const current = new Uint16Array(text.length + 1); const nextStarts = new Uint32Array(text.length + 1); current[0] = i;
    for (let j = 1; j <= text.length; j++) {
      const diagonal = previous[j - 1]! + (pattern[i - 1] === text[j - 1] ? 0 : 1); const deletion = previous[j]! + 1; const insertion = current[j - 1]! + 1;
      const best = Math.min(diagonal, deletion, insertion); current[j] = best;
      nextStarts[j] = best === diagonal ? starts[j - 1]! : best === deletion ? starts[j]! : nextStarts[j - 1]!;
    }
    previous = current; starts = nextStarts;
  }
  let end = 0; let distance = Infinity;
  for (let j = 1; j <= text.length; j++) { if (previous[j]! < distance) { distance = previous[j]!; end = j; } }
  const start = starts[end]!; const window = text.slice(start, end);
  if (1 - distance / Math.max(pattern.length, window.length) < .7) return undefined;
  // Trace this small window to map both selected-quote boundaries through the edits.
  const rows = Array.from({ length: pattern.length + 1 }, () => new Uint16Array(window.length + 1));
  for (let i = 0; i <= pattern.length; i++) rows[i]![0] = i;
  for (let j = 0; j <= window.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= pattern.length; i++) for (let j = 1; j <= window.length; j++) rows[i]![j] = Math.min(rows[i - 1]![j - 1]! + (pattern[i - 1] === window[j - 1] ? 0 : 1), rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1);
  let i = pattern.length; let j = window.length; const boundaries = new Map<number, number>(); boundaries.set(i, j);
  while (i || j) {
    if (i && j && rows[i]![j] === rows[i - 1]![j - 1]! + (pattern[i - 1] === window[j - 1] ? 0 : 1)) { i--; j--; }
    else if (i && rows[i]![j] === rows[i - 1]![j]! + 1) i--;
    else j--;
    boundaries.set(i, j);
  }
  const range = { start: start + (boundaries.get(quoteStart) ?? 0), end: start + (boundaries.get(quoteEnd) ?? window.length) };
  return range.end > range.start ? range : undefined;
}

export function relocateAnchor(input: Anchor, doc: Document): Located {
  const anchor = { ...input };
  if (!anchor.moduleId && !anchor.blockId) return { anchor, state: 'ok' };
  let module = doc.modules.find((item) => item.id === anchor.moduleId);
  if (!anchor.blockId) return { anchor, state: module ? 'ok' : 'lost' };
  let node: Record<string, unknown> | undefined;
  for (const candidate of doc.modules) { const found = findNode(candidate.blocks, anchor.blockId); if (found) { module = candidate; node = found; anchor.moduleId = candidate.id; break; } }
  if (!node) {
    if (!module) return { anchor, state: 'lost' };
    delete anchor.blockId; delete anchor.field; return { anchor, state: 'block_deleted' };
  }
  if (!anchor.quote) return { anchor, state: 'ok' };
  const text = anchorText(node, anchor.field ?? 'text'); if (text === undefined) return { anchor, state: 'text_changed' };
  const quote = anchor.quote; const prefix = anchor.prefix ?? ''; const suffix = anchor.suffix ?? '';
  let best: Range | undefined; let score = -1;
  for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) {
    const end = start + quote.length; const value = contextScore(text, start, end, prefix, suffix);
    if (value > score) { best = { start, end }; score = value; }
  }
  best ??= fuzzyRange(prefix + quote + suffix, text, prefix.length, prefix.length + quote.length);
  if (!best) return { anchor, state: 'text_changed' };
  return { anchor: { ...anchor, quote: text.slice(best.start, best.end), prefix: text.slice(Math.max(0, best.start - 32), best.start), suffix: text.slice(best.end, best.end + 32) }, state: 'ok', range: best };
}
