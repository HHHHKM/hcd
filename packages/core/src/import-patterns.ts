import type { KpisBlock, TimelineBlock } from './model';

export type ImportNode = { nodeName: string; tagName?: string; value?: string; childNodes?: ImportNode[]; attrs?: Array<{ name: string; value: string }> };
const excluded = new Set(['script', 'style', 'template', 'noscript']);
const children = (node: ImportNode) => (node.childNodes ?? []).filter((child) => child.tagName && !excluded.has(child.tagName));
const rawText = (node: ImportNode): string => excluded.has(node.tagName ?? '') ? '' : node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(rawText).join(' ');
const text = (node: ImportNode) => rawText(node).replace(/\s+/g, ' ').trim();
const descendants = (node: ImportNode): ImportNode[] => children(node).flatMap((child) => [child, ...descendants(child)]);
const valuePattern = /^[¥$€£]?\s*[\d.,]+\s*(%|万|亿|千|k|K|M|B|x|倍|人|元|次|天|ms|s)?\+?$/;
const deltaPattern = /^[+\-↑↓▲▼]\s*[\d.,]+\s*%?$/;
const timePattern = /^(Q[1-4]|H[12]|\d{4}(年(\d{1,2}月(\d{1,2}日)?)?|[-./]\d{1,2}([-./]\d{1,2})?)?|\d{1,2}\s*月(\d{1,2}\s*日)?|第[一二三四五六七八九十\d]+(阶段|周|月|期|步)|阶段\s*[一二三四五六七八九十\d]+|(Phase|Stage|Step|Week|Sprint)\s*\d+|W\d{1,2}|M\d{1,2})/i;
function repeated(nodes: ImportNode[]) {
  const first = nodes[0]; if (!first) return false;
  const classOf = (node: ImportNode) => node.attrs?.find((attribute) => attribute.name === 'class')?.value ?? '';
  return nodes.every((node) => node.tagName === first.tagName && classOf(node) === classOf(first));
}
function without(node: ImportNode, omitted: Set<ImportNode>): string {
  if (omitted.has(node) || excluded.has(node.tagName ?? '')) return '';
  return node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map((child) => without(child, omitted)).join(' ');
}

/** Check before recursive interpretation so adversarial nesting cannot exhaust the call stack. */
export function isImportTreeBounded(root: ImportNode, maxNodes = 100_000, maxDepth = 64): boolean {
  const pending: Array<[ImportNode, number]> = [[root, 0]]; let count = 0;
  while (pending.length) { const [node, depth] = pending.pop()!; if (++count > maxNodes || depth > maxDepth) return false; for (const child of node.childNodes ?? []) pending.push([child, depth + 1]); }
  return true;
}

/** Conservative, deterministic recognition. Failure leaves ordinary import handling in control. */
export function recognizeDataGroup(node: ImportNode, nextId: () => string): KpisBlock | TimelineBlock | null {
  if (!['div', 'section', 'article', 'ul', 'ol'].includes(node.tagName ?? '')) return null;
  const items = children(node);
  if (repeated(items) && items.length <= 12) {
    const kpis = items.map((item) => {
      if (text(item).length > 80) return null;
      // Inspect deepest text-bearing elements, avoiding counting wrapper spans twice.
      const leaves = descendants(item).filter((child) => !children(child).some((nested) => text(nested)));
      const values = leaves.filter((child) => valuePattern.test(text(child)));
      const deltas = leaves.filter((child) => deltaPattern.test(text(child)));
      if (values.length !== 1 || deltas.length > 1) return null;
      const label = without(item, new Set([...values, ...deltas])).replace(/\s+/g, ' ').trim();
      if (!label) return null;
      const delta = deltas[0] ? text(deltas[0]) : '';
      return { label, value: text(values[0]!), delta, tone: /^[+↑▲]/.test(delta) ? 'good' as const : /^[-↓▼]/.test(delta) ? 'bad' as const : 'neutral' as const };
    });
    if (kpis.length && kpis.every((item) => item !== null)) return { id: nextId(), type: 'kpis', items: kpis.map((item) => ({ id: nextId(), ...item! })) };
  }
  const list = node.tagName === 'ol' || node.tagName === 'ul';
  if (items.length < (list ? 2 : 3) || items.length > 50 || !repeated(items) || (list && items.some((item) => item.tagName !== 'li'))) return null;
  const timeline = items.map((item) => {
    const all = text(item); const label = timePattern.exec(all)?.[0]; if (!label) return null;
    const heading = descendants(item).find((child) => /^(h[1-6]|strong|b)$/.test(child.tagName ?? '') && text(child).replace(timePattern, '').trim());
    const title = heading ? text(heading).replace(timePattern, '').replace(/^\s*[:：—–-]\s*/, '').trim() : '';
    let rest = without(item, new Set(heading ? [heading] : [])).replace(/\s+/g, ' ').trim();
    if (rest.startsWith(label)) rest = rest.slice(label.length).replace(/^\s*[:：—–-]\s*/, '').trim();
    return { label, title, text: rest ? [{ t: rest }] : [] };
  });
  return timeline.every((item) => item !== null) ? { id: nextId(), type: 'timeline', items: timeline.map((item) => ({ id: nextId(), ...item! })) } : null;
}
