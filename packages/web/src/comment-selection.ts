import { anchorText, relocateAnchor, type Anchor } from '../../core/src/anchors';
import type { Document as HcdDocument } from '../../core/src/model';

export type CommentSelection =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: 'cross_field' | 'too_long' | 'unsupported' | 'changed' | 'unicode' | 'ambiguous' }
  | { kind: 'ready'; anchor: Anchor };
export type CommentSelectionSource = Pick<Selection, 'rangeCount' | 'isCollapsed' | 'getRangeAt'>;
const none: CommentSelection = { kind: 'none' };
const invalid = (reason: Extract<CommentSelection, { kind: 'invalid' }>['reason']): CommentSelection => ({
  kind: 'invalid',
  reason,
});
const lists = new Set(['blocks', 'items', 'cols', 'rows', 'columns', 'categories', 'series']);
function findNode(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const node = findNode(item, id);
      if (node) return node;
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.id === id) return record;
    for (const [key, child] of Object.entries(record))
      if (lists.has(key)) {
        const node = findNode(child, id);
        if (node) return node;
      }
  }
  return undefined;
}
const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const boundary = (text: string, offset: number) =>
  offset === 0 || offset === text.length || !(high(text.charCodeAt(offset - 1)) && low(text.charCodeAt(offset)));
function validUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (high(code)) {
      if (!low(text.charCodeAt(++i))) return false;
    } else if (low(code)) return false;
  }
  return true;
}

/** Offsets are UTF-16 code units, matching DOM Range and core anchor relocation. */
export function buildCommentAnchor(input: {
  document: HcdDocument;
  version: number;
  moduleId: string;
  nodeId: string;
  field: string;
  text: string;
  start: number;
  end: number;
}): CommentSelection {
  const { document, version, moduleId, nodeId, field, text, start, end } = input;
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    start >= end
  )
    return invalid('unsupported');
  const module = document.modules.find((item) => item.id === moduleId);
  const node = module && findNode(module.blocks, nodeId);
  if (!node || node.type === 'raw' || field.length > 100) return invalid('unsupported');
  const actual = anchorText(node, field);
  if (actual === undefined) return invalid('unsupported');
  if (actual !== text) return invalid('changed');
  if (!validUnicode(text) || !boundary(text, start) || !boundary(text, end)) return invalid('unicode');
  if (end - start > 500) return invalid('too_long');
  let prefixStart = Math.max(0, start - 32);
  let suffixEnd = Math.min(text.length, end + 32);
  if (!boundary(text, prefixStart)) prefixStart++;
  if (!boundary(text, suffixEnd)) suffixEnd--;
  const anchor: Anchor = {
    moduleId,
    blockId: nodeId,
    field,
    quote: text.slice(start, end),
    prefix: text.slice(prefixStart, start),
    suffix: text.slice(end, suffixEnd),
    version,
  };
  // The bounded context must reproduce this exact selection, including when
  // identical passages occur more than once in the same field.
  const located = relocateAnchor(anchor, document);
  if (located.state !== 'ok' || located.range?.start !== start || located.range.end !== end)
    return invalid('ambiguous');
  return { kind: 'ready', anchor };
}

const fieldSelector = '[data-hcd-node-id][data-hcd-field]';
const blockedSelector = [
  '[contenteditable]:not([contenteditable="false"])',
  'input,textarea,select,button,iframe,object,embed,script,style,template,svg,canvas',
  '[data-hcd-selection-ignore],[data-hcd-raw],[hidden],[inert],[aria-hidden="true"]',
].join(',');
const elementAt = (node: Node) => (node.nodeType === 1 ? (node as Element) : node.parentElement);
function safeElement(element: Element): boolean {
  if (element.matches(blockedSelector)) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    style?.display !== 'none' &&
    style?.visibility !== 'hidden' &&
    style?.visibility !== 'collapse' &&
    style?.opacity !== '0' &&
    style?.getPropertyValue('content-visibility') !== 'hidden'
  );
}
function safeAncestors(element: Element): boolean {
  let child: Element | undefined;
  let depth = 0;
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (++depth > 80 || !safeElement(ancestor)) return false;
    // Only the first summary is visible inside closed details. A Range can
    // otherwise include its hidden content even though native dragging cannot.
    if (
      ancestor.tagName.toLowerCase() === 'details' &&
      !ancestor.hasAttribute('open') &&
      (!child || child.tagName.toLowerCase() !== 'summary' || child !== ancestor.querySelector(':scope > summary'))
    )
      return false;
    child = ancestor;
  }
  return true;
}
type FieldBoundary = { field: Element; container: Node; offset: number };
function fieldBoundary(container: Node, offset: number, side: 'start' | 'end'): FieldBoundary | undefined {
  const element = elementAt(container);
  if (!element || !safeAncestors(element)) return undefined;
  const field = element.closest(fieldSelector);
  if (field) return { field, container, offset };
  if (container.nodeType !== 1) return undefined;
  let child: Node | null | undefined = container.childNodes[side === 'start' ? offset : offset - 1];
  for (let depth = 0; child && depth < 40; depth++) {
    // Parent boundaries are equivalent to a field edge only along an exact
    // first/last-child path. Never skip whitespace, empty controls or hidden
    // siblings to make an otherwise unsupported selection appear valid.
    if (child.nodeType !== 1) return undefined;
    const candidate = child as Element;
    if (!safeElement(candidate) || (candidate.tagName.toLowerCase() === 'details' && !candidate.hasAttribute('open')))
      return undefined;
    if (candidate.matches(fieldSelector))
      return { field: candidate, container: candidate, offset: side === 'start' ? 0 : candidate.childNodes.length };
    child = side === 'start' ? child.firstChild : child.lastChild;
  }
  return undefined;
}
function fieldRange(
  field: Element,
  range: Pick<Range, 'startContainer' | 'startOffset' | 'endContainer' | 'endOffset'>,
): { text: string; start: number; end: number } | undefined {
  let text = '';
  let start = -1;
  let end = -1;
  let safe = true;
  let count = 0;
  const record = (node: Node, offset: number) => {
    if (range.startContainer === node && range.startOffset === offset) start = text.length;
    if (range.endContainer === node && range.endOffset === offset) end = text.length;
  };
  const walk = (node: Node, depth: number) => {
    if (!safe || ++count > 20_000 || depth > 40) {
      safe = false;
      return;
    }
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? '';
      if (range.startContainer === node && range.startOffset >= 0 && range.startOffset <= value.length)
        start = text.length + range.startOffset;
      if (range.endContainer === node && range.endOffset >= 0 && range.endOffset <= value.length)
        end = text.length + range.endOffset;
      text += value;
      return;
    }
    if (node.nodeType !== 1) {
      if (node.nodeType !== 8) safe = false;
      return;
    }
    const element = node as Element;
    if (
      !safeElement(element) ||
      (element !== field && element.matches(fieldSelector)) ||
      (element.tagName.toLowerCase() === 'details' && !element.hasAttribute('open'))
    ) {
      safe = false;
      return;
    }
    record(node, 0);
    if (element.tagName.toLowerCase() === 'br') {
      text += '\n';
      return;
    }
    for (let index = 0; index < node.childNodes.length; index++) {
      walk(node.childNodes[index]!, depth + 1);
      record(node, index + 1);
    }
  };
  walk(field, 0);
  return safe && start >= 0 && end > start ? { text, start, end } : undefined;
}

/** Read only the marked field. Never trust Selection.toString(), which omits BR semantics. */
export function commentSelectionFromDom(input: {
  root: HTMLElement;
  selection: CommentSelectionSource | null;
  document: HcdDocument;
  version: number;
}): CommentSelection {
  const { root, selection, document, version } = input;
  if (!selection || !selection.rangeCount || selection.isCollapsed) return none;
  if (selection.rangeCount !== 1) return invalid('cross_field');
  const range = selection.getRangeAt(0);
  const startInside = root.contains(range.startContainer);
  const endInside = root.contains(range.endContainer);
  if (!startInside && !endInside) return none;
  if (!startInside || !endInside) return invalid('cross_field');
  const start = fieldBoundary(range.startContainer, range.startOffset, 'start');
  const end = fieldBoundary(range.endContainer, range.endOffset, 'end');
  if (!start || !end) return invalid('unsupported');
  const field = start.field;
  const finalField = end.field;
  if (field !== finalField || !root.contains(field)) return invalid('cross_field');
  const module = field.closest('[data-hcd-module-id]');
  if (!module || !root.contains(module) || module !== finalField.closest('[data-hcd-module-id]'))
    return invalid('cross_field');
  const value = fieldRange(field, {
    startContainer: start.container,
    startOffset: start.offset,
    endContainer: end.container,
    endOffset: end.offset,
  });
  if (!value) return invalid('unsupported');
  return buildCommentAnchor({
    document,
    version,
    moduleId: module.getAttribute('data-hcd-module-id')!,
    nodeId: field.getAttribute('data-hcd-node-id')!,
    field: field.getAttribute('data-hcd-field')!,
    ...value,
  });
}
