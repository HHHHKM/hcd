import { parseFragment } from 'parse5';
import {
  canonicalizeDocument, canonicalizeInline, validateDocument,
  type Block, type Document, type Inline, type LeafBlock, type Module, type Result,
  type TextRun, type ValidationIssue,
} from './model';

type TreeNode = { nodeName?: string; tagName?: string; value?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: TreeNode[] };
export type DocumentDraft = Omit<Document, 'id' | 'modules'> & { id?: string; modules: ModuleDraft[] };
export type ModuleDraft = Omit<Module, 'id' | 'blocks'> & { id?: string; blocks: BlockDraft[] };
type DraftOf<T> = T extends { id: string } ? Omit<T, 'id'> & { id?: string } : T;
export type BlockDraft = DraftOf<Block>;
export type SpecHtmlResult<T> = Result<{ doc: T; issues: ValidationIssue[] }, ValidationIssue[]>;
export type SerializeOptions = { includeRawSource?: (asset: string) => string | undefined };

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attrs = (values: Record<string, string | number | boolean | null | undefined>): string => Object.entries(values)
  .filter(([, value]) => value !== undefined && value !== null && value !== false)
  .map(([name, value]) => ` ${name}="${esc(String(value))}"`).join('');
const pad = (depth: number): string => '  '.repeat(depth);

function inlineHtml(inline: Inline): string {
  return canonicalizeInline(inline).map((run) => {
    if ('br' in run) return '<br>';
    let text = esc(run.t);
    if (run.sup) text = `<sup>${text}</sup>`;
    else if (run.sub) text = `<sub>${text}</sub>`;
    if (run.code) text = `<code>${text}</code>`;
    if (run.i) text = `<em>${text}</em>`;
    if (run.b) text = `<strong>${text}</strong>`;
    if (run.href) text = `<a href="${esc(run.href)}">${text}</a>`;
    return text;
  }).join('');
}

function line(depth: number, value: string): string { return `${pad(depth)}${value}`; }

function serializeListItems(items: Array<{ id: string; text: Inline; items: Array<{ id: string; text: Inline; items: any[] }> }>, ordered: boolean, depth: number): string[] {
  const tag = ordered ? 'ol' : 'ul';
  const out = [line(depth, `<${tag}>`)];
  for (const item of items) {
    out.push(line(depth + 1, `<li${attrs({ 'data-id': item.id })}>${inlineHtml(item.text)}`));
    if (item.items.length) out.push(...serializeListItems(item.items, ordered, depth + 2));
    out.push(line(depth + 1, '</li>'));
  }
  out.push(line(depth, `</${tag}>`));
  return out;
}

function serializeLeaf(block: LeafBlock, depth: number, opts: SerializeOptions): string[] {
  const id = { 'data-id': block.id };
  switch (block.type) {
    case 'heading': { const tag = `h${block.level}`; return [line(depth, `<${tag}${attrs(id)}>${inlineHtml(block.text)}</${tag}>`)]; }
    case 'paragraph': return [line(depth, `<p${attrs(id)}>${inlineHtml(block.text)}</p>`)];
    case 'quote': return [line(depth, `<blockquote${attrs(id)}>${inlineHtml(block.text)}</blockquote>`)];
    case 'list': return [line(depth, `<${block.ordered ? 'ol' : 'ul'}${attrs(id)}>`), ...block.items.flatMap((item) => {
      const result = [line(depth + 1, `<li${attrs({ 'data-id': item.id })}>${inlineHtml(item.text)}`)];
      if (item.items.length) result.push(...serializeListItems(item.items, block.ordered, depth + 2));
      result.push(line(depth + 1, '</li>')); return result;
    }), line(depth, `</${block.ordered ? 'ol' : 'ul'}>` )];
    case 'callout': return [line(depth, `<aside${attrs({ 'data-block': 'callout', 'data-id': block.id, 'data-tone': block.tone })}>`), line(depth + 1, `<p data-role="title">${esc(block.title)}</p>`), line(depth + 1, `<p data-role="body">${inlineHtml(block.text)}</p>`), line(depth, '</aside>')];
    case 'divider': return [line(depth, `<hr${attrs(id)}>` )];
    case 'image': return [line(depth, `<figure${attrs({ 'data-block': 'image', 'data-id': block.id, 'data-width': block.width })}>`), line(depth + 1, `<img${attrs({ src: block.asset ? `asset:${block.asset}` : '', alt: block.alt })}>`), line(depth + 1, `<figcaption>${esc(block.caption)}</figcaption>`), line(depth, '</figure>')];
    case 'table': {
      const out = [line(depth, `<table${attrs(id)}>`), line(depth + 1, `<caption>${esc(block.caption)}</caption>`), line(depth + 1, '<thead>'), line(depth + 2, '<tr>')];
      for (const col of block.columns) out.push(line(depth + 3, `<th${attrs({ 'data-id': col.id, 'data-align': col.align })}>${inlineHtml(col.header)}</th>`));
      out.push(line(depth + 2, '</tr>'), line(depth + 1, '</thead>'), line(depth + 1, '<tbody>'));
      for (const row of block.rows) {
        out.push(line(depth + 2, `<tr${attrs({ 'data-id': row.id })}>`));
        for (const col of block.columns) out.push(line(depth + 3, `<td>${inlineHtml(row.cells[col.id] ?? [])}</td>`));
        out.push(line(depth + 2, '</tr>'));
      }
      out.push(line(depth + 1, '</tbody>'), line(depth, '</table>')); return out;
    }
    case 'chart': {
      const data = { title: block.title, unit: block.unit, categories: block.categories.map(({ id: categoryId, label }) => ({ id: categoryId, label })), series: block.series.map((series) => ({ id: series.id, name: series.name, values: block.categories.map((category) => series.values[category.id] ?? null) })) };
      const safeJson = JSON.stringify(data).replace(/[<>&]/g, (char) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[char]!);
      return [line(depth, `<figure${attrs({ 'data-block': 'chart', 'data-id': block.id, 'data-kind': block.kind })}>`), line(depth + 1, `<script type="application/hcd+json">${safeJson}</script>`), line(depth, '</figure>')];
    }
    case 'timeline': return [line(depth, `<ol${attrs({ 'data-block': 'timeline', 'data-id': block.id })}>`), ...block.items.flatMap((item) => [line(depth + 1, `<li${attrs({ 'data-id': item.id, 'data-label': item.label })}>`), line(depth + 2, `<p data-role="title">${esc(item.title)}</p>`), line(depth + 2, `<p data-role="body">${inlineHtml(item.text)}</p>`), line(depth + 1, '</li>')]), line(depth, '</ol>')];
    case 'kpis': return [line(depth, `<div${attrs({ 'data-block': 'kpis', 'data-id': block.id })}>`), ...block.items.flatMap((item) => [line(depth + 1, `<div${attrs({ 'data-kpi': '', 'data-id': item.id, 'data-tone': item.tone })}>`), line(depth + 2, `<p data-role="label">${esc(item.label)}</p>`), line(depth + 2, `<p data-role="value">${esc(item.value)}</p>`), line(depth + 2, `<p data-role="delta">${esc(item.delta)}</p>`), line(depth + 1, '</div>')]), line(depth, '</div>')];
    case 'raw': {
      const source = opts.includeRawSource?.(block.asset);
      return [line(depth, `<div${attrs({ 'data-block': 'raw', 'data-id': block.id, 'data-asset': block.asset, 'data-height': block.height, 'data-allow-scripts': String(block.allowScripts), 'data-note': block.note })}>${source === undefined ? '' : `<template data-raw-source>${esc(source)}</template>`}</div>`)];
    }
  }
}

function serializeBlock(block: Block, depth: number, opts: SerializeOptions): string[] {
  if (block.type !== 'columns' && block.type !== 'cards') return serializeLeaf(block, depth, opts);
  if (block.type === 'columns') return [line(depth, `<div${attrs({ 'data-block': 'columns', 'data-id': block.id, 'data-ratio': block.ratio })}>`), ...block.cols.flatMap((col) => [line(depth + 1, `<div${attrs({ 'data-col': '', 'data-id': col.id })}>`), ...col.blocks.flatMap((child) => serializeLeaf(child, depth + 2, opts)), line(depth + 1, '</div>')]), line(depth, '</div>')];
  return [line(depth, `<div${attrs({ 'data-block': 'cards', 'data-id': block.id, 'data-per-row': block.perRow })}>`), ...block.items.flatMap((card) => [line(depth + 1, `<div${attrs({ 'data-card': '', 'data-id': card.id })}>`), line(depth + 2, `<p data-role="card-title">${esc(card.title)}</p>`), ...card.blocks.flatMap((child) => serializeLeaf(child, depth + 2, opts)), line(depth + 1, '</div>')]), line(depth, '</div>')];
}

export function serializeModule(module: Module, opts: SerializeOptions = {}): string {
  return [`<section data-module${attrs({ 'data-id': module.id })}>`, `  <h2 data-role="module-title">${esc(module.title)}</h2>`, ...module.blocks.flatMap((block) => serializeBlock(block, 1, opts)), '</section>'].join('\n');
}

export function serializeDocument(document: Document, opts: SerializeOptions = {}): string {
  const doc = canonicalizeDocument(document);
  const [themeId, version] = [doc.theme.id, doc.theme.version];
  return [`<article${attrs({ 'data-hcd': '1', 'data-id': doc.id, 'data-title': doc.title, 'data-theme': `${themeId}@${version}`, 'data-accent': doc.theme.overrides.accent })}>`, ...doc.modules.flatMap((module) => serializeModule(module, opts).split('\n').map((entry) => `  ${entry}`)), '</article>'].join('\n');
}

function attr(node: TreeNode, name: string): string | undefined { return node.attrs?.find((item) => item.name === name)?.value; }
function tag(node: TreeNode): string { return node.tagName ?? node.nodeName ?? ''; }
function children(node: TreeNode): TreeNode[] { return (node.childNodes ?? []).filter((child) => child.nodeName === '#text' ? Boolean(child.value?.trim()) : !child.nodeName?.startsWith('#')); }
function textContent(node: TreeNode): string { if (node.nodeName === '#text') return node.value ?? ''; return (node.childNodes ?? []).map(textContent).join(''); }
function find(node: TreeNode, predicate: (child: TreeNode) => boolean): TreeNode | undefined { for (const child of node.childNodes ?? []) { if (predicate(child)) return child; const nested = find(child, predicate); if (nested) return nested; } return undefined; }
function issue(path: string, code: string, params?: Record<string, unknown>): ValidationIssue { return { path, code, ...(params ? { params } : {}) }; }

function parseInline(node: TreeNode, baseMarks: Omit<TextRun, 't'> = {}, preserveSpace = false): Inline {
  const result: Inline = [];
  const append = (text: string, marks: Omit<TextRun, 't'>) => {
    if (!text) return;
    const normalizedText = preserveSpace ? text : text.replace(/\s*\n\s*/g, ' ');
    if (!normalizedText) return;
    const previous = result.at(-1);
    const run: TextRun = { t: normalizedText, ...marks };
    if (previous && !('br' in previous) && JSON.stringify(Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 't'))) === JSON.stringify(marks)) previous.t += normalizedText;
    else result.push(run);
  };
  const walk = (current: TreeNode, marks: Omit<TextRun, 't'>): void => {
    if (current.nodeName === '#text') { append(current.value ?? '', marks); return; }
    const currentTag = tag(current).toLowerCase();
    if (currentTag === 'br') { result.push({ br: true }); return; }
    const next: Omit<TextRun, 't'> = { ...marks };
    if (currentTag === 'strong' || currentTag === 'b') next.b = true;
    if (currentTag === 'em' || currentTag === 'i') next.i = true;
    if (currentTag === 'code') next.code = true;
    if (currentTag === 'sup') { next.sup = true; delete next.sub; }
    if (currentTag === 'sub') { if (!next.sup) next.sub = true; }
    if (currentTag === 'a') { const href = attr(current, 'href'); if (href) next.href = href; }
    for (const child of current.childNodes ?? []) walk(child, next);
  };
  walk(node, baseMarks);
  return canonicalizeInline(result);
}

function parseLeaf(node: TreeNode, path: string, issues: ValidationIssue[]): LeafBlock | undefined {
  const name = tag(node).toLowerCase();
  const id = attr(node, 'data-id');
  const requiredId = id ?? '';
  const inline = () => parseInline(node);
  const childrenOf = children(node);
  if (name === 'h3' || name === 'h4') return { id: requiredId, type: 'heading', level: Number(name.slice(1)) as 3 | 4, text: inline() };
  if (name === 'h2') { issues.push(issue(path, 'doc.import.h2_as_heading')); return { id: requiredId, type: 'heading', level: 3, text: inline() }; }
  if (name === 'p') return { id: requiredId, type: 'paragraph', text: inline() };
  if (name === 'blockquote') return { id: requiredId, type: 'quote', text: inline() };
  if ((name === 'ul' || name === 'ol') && attr(node, 'data-block') !== 'timeline') {
    const parseItems = (list: TreeNode, depth: number): any[] => children(list).filter((item) => tag(item).toLowerCase() === 'li').map((item) => {
      const nested = children(item).find((child) => ['ul', 'ol'].includes(tag(child).toLowerCase()));
      const inlineChildren = (item.childNodes ?? []).filter((child) => !nested || child !== nested);
      const textNode: TreeNode = { nodeName: 'span', childNodes: inlineChildren };
      return { id: attr(item, 'data-id') ?? '', text: parseInline(textNode), items: nested && depth < 2 ? parseItems(nested, depth + 1) : [] };
    });
    return { id: requiredId, type: 'list', ordered: name === 'ol', items: parseItems(node, 1) };
  }
  if (name === 'aside' && attr(node, 'data-block') === 'callout') {
    const title = find(node, (child) => attr(child, 'data-role') === 'title');
    const body = find(node, (child) => attr(child, 'data-role') === 'body');
    const tone = attr(node, 'data-tone') ?? 'info';
    return { id: requiredId, type: 'callout', tone: (['info', 'success', 'warn', 'danger'].includes(tone) ? tone : 'info') as any, title: title ? textContent(title).trim() : '', text: body ? parseInline(body) : [] };
  }
  if (name === 'hr') return { id: requiredId, type: 'divider' };
  if (name === 'figure' && attr(node, 'data-block') === 'image') {
    const image = find(node, (child) => tag(child).toLowerCase() === 'img'); const caption = find(node, (child) => tag(child).toLowerCase() === 'figcaption');
    const source = image ? attr(image, 'src') ?? '' : '';
    return { id: requiredId, type: 'image', asset: source.startsWith('asset:') ? source.slice(6) : null, alt: image ? attr(image, 'alt') ?? '' : '', caption: caption ? textContent(caption).trim() : '', width: (['small', 'normal', 'wide', 'full'].includes(attr(node, 'data-width') ?? '') ? attr(node, 'data-width') : 'normal') as any };
  }
  if (name === 'table') {
    const columns: any[] = []; const rows: any[] = [];
    const head = find(node, (child) => tag(child).toLowerCase() === 'thead');
    const headRow = head && find(head, (child) => tag(child).toLowerCase() === 'tr');
    for (const th of headRow?.childNodes ?? []) if (tag(th).toLowerCase() === 'th') columns.push({ id: attr(th, 'data-id') ?? '', header: parseInline(th), align: (['left', 'center', 'right'].includes(attr(th, 'data-align') ?? '') ? attr(th, 'data-align') : 'left') });
    const body = find(node, (child) => tag(child).toLowerCase() === 'tbody');
    for (const row of body?.childNodes ?? []) if (tag(row).toLowerCase() === 'tr') {
      const cells: Record<string, Inline> = {}; let index = 0;
      for (const cell of row.childNodes ?? []) if (tag(cell).toLowerCase() === 'td') { const col = columns[index]; if (col) { const value = parseInline(cell); if (value.length) cells[col.id] = value; } index += 1; }
      rows.push({ id: attr(row, 'data-id') ?? '', cells });
    }
    const caption = find(node, (child) => tag(child).toLowerCase() === 'caption');
    return { id: requiredId, type: 'table', caption: caption ? textContent(caption).trim() : '', columns, rows };
  }
  if (name === 'figure' && attr(node, 'data-block') === 'chart') {
    const script = find(node, (child) => tag(child).toLowerCase() === 'script' && attr(child, 'type') === 'application/hcd+json');
    try {
      const parsed = JSON.parse(script ? textContent(script) : '{}') as any;
      const categories = Array.isArray(parsed.categories) ? parsed.categories.map((item: any) => ({ id: item.id ?? '', label: String(item.label ?? '') })) : [];
      const series = Array.isArray(parsed.series) ? parsed.series.map((item: any) => ({ id: item.id ?? '', name: String(item.name ?? ''), values: Object.fromEntries(categories.map((category: any, index: number) => [category.id, Array.isArray(item.values) ? item.values[index] ?? null : null])) })) : [];
      const kind = attr(node, 'data-kind') ?? 'bar';
      return { id: requiredId, type: 'chart', kind: (['bar', 'line', 'pie'].includes(kind) ? kind : 'bar') as any, title: String(parsed.title ?? ''), unit: String(parsed.unit ?? ''), categories, series };
    } catch (error) { issues.push(issue(path, 'doc.import.chart_json', { message: error instanceof Error ? error.message : String(error) })); return undefined; }
  }
  if (attr(node, 'data-block') === 'timeline' && name === 'ol') {
    const items = childrenOf.filter((child) => tag(child).toLowerCase() === 'li').map((item) => {
      const title = find(item, (child) => attr(child, 'data-role') === 'title'); const body = find(item, (child) => attr(child, 'data-role') === 'body');
      return { id: attr(item, 'data-id') ?? '', label: attr(item, 'data-label') ?? '', title: title ? textContent(title).trim() : '', text: body ? parseInline(body) : [] };
    });
    return { id: requiredId, type: 'timeline', items };
  }
  if (name === 'div' && attr(node, 'data-block') === 'kpis') {
    const items = childrenOf.filter((child) => attr(child, 'data-kpi') !== undefined).map((item) => ({ id: attr(item, 'data-id') ?? '', label: textContent(find(item, (child) => attr(child, 'data-role') === 'label') ?? { childNodes: [] }).trim(), value: textContent(find(item, (child) => attr(child, 'data-role') === 'value') ?? { childNodes: [] }).trim(), delta: textContent(find(item, (child) => attr(child, 'data-role') === 'delta') ?? { childNodes: [] }).trim(), tone: (['neutral', 'good', 'bad'].includes(attr(item, 'data-tone') ?? '') ? attr(item, 'data-tone')! : 'neutral') as 'neutral' | 'good' | 'bad' }));
    return { id: requiredId, type: 'kpis', items };
  }
  if (name === 'div' && attr(node, 'data-block') === 'raw') return { id: requiredId, type: 'raw', asset: attr(node, 'data-asset') ?? '', height: Number(attr(node, 'data-height') ?? 480), allowScripts: attr(node, 'data-allow-scripts') === 'true', note: attr(node, 'data-note') ?? '' };
  const content = textContent(node).trim();
  if (content) { issues.push(issue(path, 'doc.import.unknown_element', { tag: name })); return { id: requiredId, type: 'paragraph', text: parseInline(node) }; }
  issues.push(issue(path, 'doc.import.unknown_element', { tag: name }));
  return undefined;
}

function parseModule(node: TreeNode, index: number, issues: ValidationIssue[]): ModuleDraft {
  const path = `modules.${index}`;
  const h2s = (node.childNodes ?? []).filter((child) => tag(child).toLowerCase() === 'h2');
  const titleNode = h2s.find((child) => attr(child, 'data-role') === 'module-title') ?? (attr(node, 'data-title') ? undefined : h2s[0]);
  const title = titleNode ? textContent(titleNode).trim() : attr(node, 'data-title') ?? '';
  const blocks: Block[] = [];
  let blockIndex = 0;
  for (const child of children(node)) {
    if (child === titleNode || (tag(child).toLowerCase() === 'h2' && attr(child, 'data-role') === 'module-title')) continue;
    const type = attr(child, 'data-block');
    if (tag(child).toLowerCase() === 'div' && type === 'columns') {
      const cols = children(child).filter((col) => attr(col, 'data-col') !== undefined).map((col) => ({ id: attr(col, 'data-id') ?? '', blocks: children(col).map((leaf, leafIndex) => parseLeaf(leaf, `${path}.blocks.${blockIndex}.cols.blocks.${leafIndex}`, issues)).filter((leaf): leaf is LeafBlock => Boolean(leaf)) }));
      blocks.push({ id: attr(child, 'data-id') ?? '', type: 'columns', ratio: (['1:1', '1:2', '2:1', '1:1:1'].includes(attr(child, 'data-ratio') ?? '') ? attr(child, 'data-ratio') : '1:1') as any, cols } as Block); blockIndex++; continue;
    }
    if (tag(child).toLowerCase() === 'div' && type === 'cards') {
      const items = children(child).filter((card) => attr(card, 'data-card') !== undefined).map((card) => {
        const cardTitle = find(card, (item) => attr(item, 'data-role') === 'card-title');
        const cardBlocks = children(card).filter((item) => item !== cardTitle).map((leaf, leafIndex) => parseLeaf(leaf, `${path}.blocks.${blockIndex}.items.blocks.${leafIndex}`, issues)).filter((leaf): leaf is LeafBlock => Boolean(leaf));
        return { id: attr(card, 'data-id') ?? '', title: cardTitle ? textContent(cardTitle).trim() : '', blocks: cardBlocks };
      });
      const perRow = Number(attr(child, 'data-per-row'));
      blocks.push({ id: attr(child, 'data-id') ?? '', type: 'cards', perRow: ([2, 3, 4].includes(perRow) ? perRow : 3) as 2 | 3 | 4, items } as Block); blockIndex++; continue;
    }
    const parsed = parseLeaf(child, `${path}.blocks.${blockIndex}`, issues);
    if (parsed) blocks.push(parsed); blockIndex++;
  }
  return { id: attr(node, 'data-id'), title, blocks } as ModuleDraft;
}

export function parseSpecDocument(html: string): SpecHtmlResult<DocumentDraft> {
  const root = parseFragment(html) as unknown as TreeNode;
  const issues: ValidationIssue[] = [];
  const article = find(root, (node) => tag(node).toLowerCase() === 'article' && attr(node, 'data-hcd') !== undefined);
  const scope = article ?? root;
  const sections = tag(scope).toLowerCase() === 'section' && attr(scope, 'data-module') !== undefined
    ? [scope]
    : (scope.childNodes ?? []).filter((node) => tag(node).toLowerCase() === 'section' && attr(node, 'data-module') !== undefined);
  const modules = sections.map((section, index) => parseModule(section, index, issues));
  const theme = attr(scope, 'data-theme') ?? 'default@1';
  const versionSeparator = theme.lastIndexOf('@');
  const themeId = versionSeparator < 0 ? theme : theme.slice(0, versionSeparator);
  const versionText = versionSeparator < 0 ? '1' : theme.slice(versionSeparator + 1);
  const draft = {
    schemaVersion: 1 as const,
    id: attr(scope, 'data-id'),
    title: attr(scope, 'data-title') ?? '',
    theme: { id: themeId, version: Number(versionText) || 1, overrides: { ...(attr(scope, 'data-accent') ? { accent: attr(scope, 'data-accent') } : {}) } },
    modules,
  } as DocumentDraft;
  const seen = new Set<string>();
  const clearDuplicates = (value: any, path: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => clearDuplicates(item, `${path}.${index}`)); return; }
    if (!value || typeof value !== 'object') return;
    if ('id' in value && (value.id === undefined || value.id === '')) delete value.id;
    if (typeof value.id === 'string' && value.id) {
      if (seen.has(value.id)) { const duplicateId = value.id; delete value.id; issues.push(issue(`${path}.id`, 'doc.import.duplicate_id', { id: duplicateId })); }
      else seen.add(value.id);
    }
    for (const [key, child] of Object.entries(value)) {
      // A theme is a reference with its own namespace, not a content node.
      if (value === draft && key === 'theme') continue;
      clearDuplicates(child, `${path}.${key}`);
    }
  };
  clearDuplicates(draft, '');
  return { ok: true, value: { doc: draft, issues } };
}

export function parseSpecModule(html: string): SpecHtmlResult<ModuleDraft> {
  const result = parseSpecDocument(html);
  if (!result.ok) return result;
  const module = result.value.doc.modules[0];
  if (!module) return { ok: false, error: [issue('modules', 'doc.import.module_missing')] };
  return { ok: true, value: { doc: module, issues: result.value.issues } };
}

export function validateSpecHtmlRoundTrip(document: Document): Result<Document, ValidationIssue[]> {
  const parsed = parseSpecDocument(serializeDocument(document));
  if (!parsed.ok) return parsed;
  return validateDocument(parsed.value.doc);
}
