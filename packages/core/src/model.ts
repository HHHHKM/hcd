import { z } from 'zod';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export type DocId = string;
export type ModuleId = string;
export type NodeId = string;
export type TmpId = string;
export type AssetId = string;

export type TextRun = { t: string; b?: true; i?: true; code?: true; sup?: true; sub?: true; href?: string };
export type BreakRun = { br: true };
export type Inline = Array<TextRun | BreakRun>;

export type HeadingBlock = { id: NodeId; type: 'heading'; level: 3 | 4; text: Inline };
export type ParagraphBlock = { id: NodeId; type: 'paragraph'; text: Inline };
export type ListItem = { id: NodeId; text: Inline; items: ListItem[] };
export type ListBlock = { id: NodeId; type: 'list'; ordered: boolean; items: ListItem[] };
export type QuoteBlock = { id: NodeId; type: 'quote'; text: Inline };
export type CalloutBlock = { id: NodeId; type: 'callout'; tone: 'info' | 'success' | 'warn' | 'danger'; title: string; text: Inline };
export type DividerBlock = { id: NodeId; type: 'divider' };
export type ImageBlock = { id: NodeId; type: 'image'; asset: AssetId | null; alt: string; caption: string; width: 'small' | 'normal' | 'wide' | 'full' };
export type TableColumn = { id: NodeId; header: Inline; align: 'left' | 'center' | 'right' };
export type TableRow = { id: NodeId; cells: Record<NodeId, Inline> };
export type TableBlock = { id: NodeId; type: 'table'; caption: string; columns: TableColumn[]; rows: TableRow[] };
export type ChartCategory = { id: NodeId; label: string };
export type ChartSeries = { id: NodeId; name: string; values: Record<NodeId, number | null> };
export type ChartBlock = { id: NodeId; type: 'chart'; kind: 'bar' | 'line' | 'pie'; title: string; unit: string; categories: ChartCategory[]; series: ChartSeries[] };
export type TimelineItem = { id: NodeId; label: string; title: string; text: Inline };
export type TimelineBlock = { id: NodeId; type: 'timeline'; items: TimelineItem[] };
export type KpiItem = { id: NodeId; label: string; value: string; delta: string; tone: 'neutral' | 'good' | 'bad' };
export type KpisBlock = { id: NodeId; type: 'kpis'; items: KpiItem[] };
export type RawBlock = { id: NodeId; type: 'raw'; asset: AssetId; height: number; allowScripts: boolean; note: string };
export type LeafBlock = HeadingBlock | ParagraphBlock | ListBlock | QuoteBlock | CalloutBlock | DividerBlock | ImageBlock | TableBlock | ChartBlock | TimelineBlock | KpisBlock | RawBlock;
export type Column = { id: NodeId; blocks: LeafBlock[] };
export type ColumnsBlock = { id: NodeId; type: 'columns'; ratio: '1:1' | '1:2' | '2:1' | '1:1:1'; cols: Column[] };
export type Card = { id: NodeId; title: string; blocks: LeafBlock[] };
export type CardsBlock = { id: NodeId; type: 'cards'; perRow: 2 | 3 | 4; items: Card[] };
export type Block = LeafBlock | ColumnsBlock | CardsBlock;
export type Module = { id: ModuleId; title: string; blocks: Block[] };
export type Document = { schemaVersion: 1; id: DocId; title: string; theme: { id: string; version: number; overrides: { accent?: string } }; modules: Module[] };

export type ValidationIssue = { path: string; code: string; params?: Record<string, unknown> };
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

const idPatterns: Record<string, RegExp> = {
  doc: /^d_[a-z2-7]{8}$/,
  module: /^m_[a-z2-7]{8}$/,
  node: /^n_[a-z2-7]{8}$/,
  asset: /^as_[a-z2-7]{12}$/,
};

export const limits = {
  title: 200,
  inline: 20_000,
  modules: 200,
  blocks: 5_000,
  listItems: 500,
  tableColumns: 50,
  tableRows: 500,
  chartCategories: 24,
  chartSeries: 8,
  timelineItems: 50,
  kpiItems: 12,
  nestedBlocks: 50,
  rawHeight: { min: 80, max: 4_000 },
  canonicalJsonBytes: 2 * 1024 * 1024,
} as const;

const docIdSchema = z.string().regex(idPatterns.doc);
const moduleIdSchema = z.string().regex(idPatterns.module);
const nodeIdSchema = z.string().regex(idPatterns.node);
const assetIdSchema = z.string().regex(idPatterns.asset);
export const TmpIdSchema = z.string().regex(/^tmp_[a-z0-9_]{1,32}$/);
export const InlineSchema = z.array(z.union([
  z.object({ br: z.literal(true) }).strict(),
  z.object({
    t: z.string().min(1).max(limits.inline).refine((value) => !/[\n\r\t]/.test(value), { message: 'Text runs cannot contain control whitespace' }),
    b: z.literal(true).optional(),
    i: z.literal(true).optional(),
    code: z.literal(true).optional(),
    sup: z.literal(true).optional(),
    sub: z.literal(true).optional(),
    href: z.string().max(2_048).optional(),
  }).strict(),
])).superRefine((runs, ctx) => {
  const length = runs.reduce((n, run) => n + ('br' in run ? 1 : run.t.length), 0);
  if (length > limits.inline) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: limits.inline, origin: 'string', inclusive: true, message: 'inline exceeds maximum length' });
});
export const ListItemSchema: z.ZodType<ListItem> = z.lazy(() => z.object({
  id: nodeIdSchema,
  text: InlineSchema,
  items: z.array(ListItemSchema).max(limits.listItems),
}).strict());
export const LeafBlockSchema: z.ZodType<LeafBlock> = z.discriminatedUnion('type', [
  z.object({ id: nodeIdSchema, type: z.literal('heading'), level: z.union([z.literal(3), z.literal(4)]), text: InlineSchema }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('paragraph'), text: InlineSchema }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('list'), ordered: z.boolean(), items: z.array(ListItemSchema).max(limits.listItems) }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('quote'), text: InlineSchema }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('callout'), tone: z.enum(['info', 'success', 'warn', 'danger']), title: z.string().max(limits.title), text: InlineSchema }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('divider') }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('image'), asset: assetIdSchema.nullable(), alt: z.string().max(limits.inline), caption: z.string().max(limits.inline), width: z.enum(['small', 'normal', 'wide', 'full']) }).strict(),
  z.object({
    id: nodeIdSchema, type: z.literal('table'), caption: z.string().max(limits.inline),
    columns: z.array(z.object({ id: nodeIdSchema, header: InlineSchema, align: z.enum(['left', 'center', 'right']) }).strict()).max(limits.tableColumns),
    rows: z.array(z.object({ id: nodeIdSchema, cells: z.record(z.string(), InlineSchema) }).strict()).max(limits.tableRows),
  }).strict(),
  z.object({
    id: nodeIdSchema, type: z.literal('chart'), kind: z.enum(['bar', 'line', 'pie']), title: z.string().max(limits.title), unit: z.string().max(limits.inline),
    categories: z.array(z.object({ id: nodeIdSchema, label: z.string().max(limits.inline) }).strict()).max(limits.chartCategories),
    series: z.array(z.object({ id: nodeIdSchema, name: z.string().max(limits.inline), values: z.record(z.string(), z.number().finite().nullable()) }).strict()).max(limits.chartSeries),
  }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('timeline'), items: z.array(z.object({ id: nodeIdSchema, label: z.string().max(40), title: z.string().max(limits.title), text: InlineSchema }).strict()) }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('kpis'), items: z.array(z.object({ id: nodeIdSchema, label: z.string().max(40), value: z.string().max(40), delta: z.string().max(40), tone: z.enum(['neutral', 'good', 'bad']) }).strict()) }).strict(),
  z.object({ id: nodeIdSchema, type: z.literal('raw'), asset: assetIdSchema, height: z.number().int().min(limits.rawHeight.min).max(limits.rawHeight.max), allowScripts: z.boolean(), note: z.string().max(limits.inline) }).strict(),
]);

export const BlockSchema: z.ZodType<Block> = z.union([
  LeafBlockSchema,
  z.object({
    id: nodeIdSchema, type: z.literal('columns'), ratio: z.enum(['1:1', '1:2', '2:1', '1:1:1']),
    cols: z.array(z.object({ id: nodeIdSchema, blocks: z.array(LeafBlockSchema).max(limits.nestedBlocks) }).strict()).min(2).max(3),
  }).strict(),
  z.object({
    id: nodeIdSchema, type: z.literal('cards'), perRow: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    items: z.array(z.object({ id: nodeIdSchema, title: z.string().max(limits.title), blocks: z.array(LeafBlockSchema).max(limits.nestedBlocks) }).strict()).min(2).max(12),
  }).strict(),
]);

export const ModuleSchema: z.ZodType<Module> = z.object({ id: moduleIdSchema, title: z.string().max(limits.title), blocks: z.array(BlockSchema) }).strict();

export const DocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: docIdSchema,
  title: z.string().max(limits.title),
  theme: z.object({ id: z.string().min(1).max(100), version: z.number().int().positive(), overrides: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).strict() }).strict(),
  modules: z.array(ModuleSchema).max(limits.modules),
}).strict();

const cleanString = (value: string): string => value.replace(/[\n\r\t]/g, ' ').trim();
const allowedHref = (href: string): string | undefined => {
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export function canonicalizeInline(inline: Inline): Inline {
  const result: Inline = [];
  for (const item of inline) {
    if ('br' in item) {
      result.push({ br: true });
      continue;
    }
    const t = item.t.replace(/[\n\r\t]/g, ' ');
    if (!t) continue;
    const normalized: TextRun = { t };
    if (item.b) normalized.b = true;
    if (item.i) normalized.i = true;
    if (item.code) normalized.code = true;
    if (item.sup) normalized.sup = true;
    else if (item.sub) normalized.sub = true;
    if (item.href) {
      const href = allowedHref(item.href);
      if (href) normalized.href = href;
    }
    const previous = result.at(-1);
    if (previous && !('br' in previous) && sameMarks(previous, normalized)) previous.t += normalized.t;
    else result.push(normalized);
  }
  // Edge whitespace can span differently marked runs. Remove all of it in one
  // pass so normalization is idempotent, without crossing an explicit BR.
  let start = 0;
  let end = result.length;
  while (start < end) {
    const first = result[start]!;
    if ('br' in first) break;
    first.t = first.t.trimStart();
    if (first.t) break;
    start += 1;
  }
  while (end > start) {
    const last = result[end - 1]!;
    if ('br' in last) break;
    last.t = last.t.trimEnd();
    if (last.t) break;
    end -= 1;
  }
  return result.slice(start, end);
}

function sameMarks(a: TextRun, b: TextRun): boolean {
  return a.b === b.b && a.i === b.i && a.code === b.code && a.sup === b.sup && a.sub === b.sub && a.href === b.href;
}

function normalizeLeaf(block: LeafBlock): LeafBlock {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return { ...block, text: canonicalizeInline(block.text) };
    case 'list':
      return { ...block, items: normalizeListItems(block.items) };
    case 'callout':
      return { ...block, title: cleanString(block.title), text: canonicalizeInline(block.text) };
    case 'image':
      return { ...block, alt: cleanString(block.alt), caption: cleanString(block.caption) };
    case 'table': {
      const columns = block.columns;
      const columnIds = new Set(columns.map((column) => column.id));
      return {
        ...block,
        caption: cleanString(block.caption),
        columns: columns.map((column) => ({ ...column, header: canonicalizeInline(column.header) })),
        rows: block.rows.map((row) => ({
          ...row,
          cells: Object.fromEntries(Object.entries(row.cells)
            .filter(([id, value]) => columnIds.has(id) && canonicalizeInline(value).length > 0)
            .map(([id, value]) => [id, canonicalizeInline(value)])),
        })),
      };
    }
    case 'chart': {
      const categoryIds = new Set(block.categories.map((category) => category.id));
      return {
        ...block,
        title: cleanString(block.title),
        unit: cleanString(block.unit),
        categories: block.categories.map((category) => ({ ...category, label: cleanString(category.label) })),
        series: block.series.map((series) => ({ ...series, name: cleanString(series.name), values: Object.fromEntries(Object.entries(series.values).filter(([id, value]) => categoryIds.has(id) && value !== null)) })),
      };
    }
    case 'timeline':
      return { ...block, items: block.items.map((item) => ({ ...item, label: cleanString(item.label), title: cleanString(item.title), text: canonicalizeInline(item.text) })) };
    case 'kpis':
      return { ...block, items: block.items.map((item) => ({ ...item, label: cleanString(item.label), value: cleanString(item.value), delta: cleanString(item.delta) })) };
    case 'raw':
      return { ...block, note: cleanString(block.note) };
    default:
      return block;
  }
}

function normalizeListItems(items: ListItem[]): ListItem[] {
  return items.map((item) => ({ id: item.id, text: canonicalizeInline(item.text), items: normalizeListItems(item.items) }));
}

export function canonicalizeDocument(document: Document): Document {
  return {
    ...document,
    title: cleanString(document.title),
    theme: { ...document.theme, overrides: { ...document.theme.overrides } },
    modules: document.modules.map((module) => ({
      ...module,
      title: cleanString(module.title),
      blocks: module.blocks.map((block) => {
        if (block.type === 'columns') return { ...block, cols: block.cols.map((column) => ({ ...column, blocks: column.blocks.map(normalizeLeaf) })) };
        if (block.type === 'cards') return { ...block, items: block.items.map((card) => ({ ...card, title: cleanString(card.title), blocks: card.blocks.map(normalizeLeaf) })) };
        return normalizeLeaf(block);
      }),
    })),
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const compareCodePoints = (a: string, b: string): number => {
    const ac = Array.from(a).map((c) => c.codePointAt(0)!);
    const bc = Array.from(b).map((c) => c.codePointAt(0)!);
    for (let i = 0; i < Math.min(ac.length, bc.length); i += 1) if (ac[i] !== bc[i]) return ac[i]! - bc[i]!;
    return ac.length - bc.length;
  };
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort(compareCodePoints).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export interface IdSource { next(prefix: 'd' | 'm' | 'n', temporaryId?: string): string }
export interface TmpIdSource { next(): string }

export function createCounterIdSource(): IdSource {
  let counter = 0;
  const toBase32 = (n: number): string => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let value = n;
    let out = '';
    while (value > 0) { out = alphabet[value % 32]! + out; value = Math.floor(value / 32); }
    return out.padStart(8, 'a').slice(-8);
  };
  return { next: (prefix) => `${prefix}_${toBase32(++counter)}` };
}

export function createCounterTmpIdSource(session = 'test'): TmpIdSource {
  let counter = 0;
  return { next: () => `tmp_${session}_${++counter}` };
}

export function validateDocument(input: unknown): Result<Document, ValidationIssue[]> {
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    const root = input as Record<string, unknown> | null;
    const atPath = (path: PropertyKey[]): unknown => path.reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined, root);
    return { ok: false, error: parsed.error.issues.map((issue) => {
      const parent = atPath(issue.path.slice(0, -1)) as { type?: string } | undefined;
      const path = issue.path.join('.');
      const owner = atPath(issue.path.slice(0, -1)) as { type?: string; ratio?: string } | undefined;
      const code = parent?.type === 'timeline' ? 'doc.validation.timeline_limit'
        : parent?.type === 'kpis' ? 'doc.validation.kpi_limit'
        : owner?.type === 'table' ? 'doc.validation.table_limit'
        : owner?.type === 'chart' ? 'doc.validation.chart_limit'
        : owner?.type === 'cards' ? 'doc.validation.cards_limit'
        : path === 'modules' ? 'doc.validation.too_many_modules'
        : path.endsWith('.height') ? 'doc.validation.raw_height'
        : path.endsWith('.id') && issue.code === 'invalid_format' ? 'doc.validation.invalid_id'
        : issue.code === 'too_big' && issue.origin === 'string' ? 'doc.validation.string_too_long'
        : `doc.validation.${issue.code}`;
      return { path: issue.path.join('.'), code, params: { message: issue.message } };
    }) };
  }
  const issues: ValidationIssue[] = [];
  const doc = parsed.data;
  const jsonSize = utf8ToBytes(canonicalJson(doc)).byteLength;
  if (jsonSize > limits.canonicalJsonBytes) return { ok: false, error: [{ path: '', code: 'doc.validation.document_too_large', params: { maximum: limits.canonicalJsonBytes, actual: jsonSize } }] };
  const seen = new Set<string>();
  const addId = (id: string, path: string, kind: 'module' | 'node') => {
    if (id.startsWith('tmp_') || !idPatterns[kind].test(id)) issues.push({ path, code: 'doc.validation.invalid_id' });
    if (seen.has(id) || id === doc.id) issues.push({ path, code: 'doc.validation.duplicate_id' });
    seen.add(id);
  };
  if (doc.title.length > 200) issues.push({ path: 'title', code: 'doc.validation.string_too_long' });
  if (doc.modules.length > 200) issues.push({ path: 'modules', code: 'doc.validation.too_many_modules' });
  let totalBlocks = 0;
  const validateLeaf = (block: LeafBlock, path: string) => {
    totalBlocks += 1;
    addId(block.id, `${path}.id`, 'node');
    if ('text' in block && block.text.length > 20_000) issues.push({ path: `${path}.text`, code: 'doc.validation.string_too_long' });
    if (block.type === 'list') {
      const scan = (items: ListItem[], depth: number, base: string) => items.forEach((item, index) => {
        addId(item.id, `${base}.${index}.id`, 'node');
        if (depth > 2 || (depth === 2 && item.items.length)) issues.push({ path: `${base}.${index}.items`, code: 'doc.validation.list_depth' });
        scan(item.items, depth + 1, `${base}.${index}.items`);
      });
      scan(block.items, 1, `${path}.items`);
      if (block.items.length > 500) issues.push({ path: `${path}.items`, code: 'doc.validation.too_many_items' });
    } else if (block.type === 'table') {
      if (block.columns.length > 50 || block.rows.length > 500) issues.push({ path, code: 'doc.validation.table_limit' });
      const columns = new Set(block.columns.map((column) => column.id));
      block.columns.forEach((column, index) => addId(column.id, `${path}.columns.${index}.id`, 'node'));
      block.rows.forEach((row, index) => {
        addId(row.id, `${path}.rows.${index}.id`, 'node');
        for (const key of Object.keys(row.cells)) if (!columns.has(key)) issues.push({ path: `${path}.rows.${index}.cells.${key}`, code: 'doc.validation.unknown_column' });
      });
    } else if (block.type === 'chart') {
      if (block.categories.length > 24 || block.series.length > 8 || (block.kind === 'pie' && block.series.length > 1)) issues.push({ path, code: 'doc.validation.chart_limit' });
      const categories = new Set(block.categories.map((item) => item.id));
      block.categories.forEach((item, index) => addId(item.id, `${path}.categories.${index}.id`, 'node'));
      block.series.forEach((series, index) => {
        addId(series.id, `${path}.series.${index}.id`, 'node');
        for (const key of Object.keys(series.values)) if (!categories.has(key)) issues.push({ path: `${path}.series.${index}.values.${key}`, code: 'doc.validation.unknown_category' });
      });
    } else if (block.type === 'timeline') {
      if (block.items.length < 2 || block.items.length > 50) issues.push({ path: `${path}.items`, code: 'doc.validation.timeline_limit' });
      block.items.forEach((item, index) => { addId(item.id, `${path}.items.${index}.id`, 'node'); });
    } else if (block.type === 'kpis') {
      if (block.items.length < 1 || block.items.length > 12) issues.push({ path: `${path}.items`, code: 'doc.validation.kpi_limit' });
      block.items.forEach((item, index) => { addId(item.id, `${path}.items.${index}.id`, 'node'); });
    } else if (block.type === 'raw' && (block.height < 80 || block.height > 4000)) issues.push({ path: `${path}.height`, code: 'doc.validation.raw_height' });
  };
  doc.modules.forEach((module, index) => {
    addId(module.id, `modules.${index}.id`, 'module');
    if (module.title.length > 200) issues.push({ path: `modules.${index}.title`, code: 'doc.validation.string_too_long' });
    module.blocks.forEach((block, blockIndex) => {
      const path = `modules.${index}.blocks.${blockIndex}`;
      if (block.type === 'columns') {
        totalBlocks += 1;
        addId(block.id, `${path}.id`, 'node');
        const ratioCount = block.ratio === '1:1:1' ? 3 : 2;
        if (block.cols.length !== ratioCount || block.cols.some((col) => col.blocks.length > limits.nestedBlocks)) issues.push({ path, code: 'doc.validation.columns_ratio' });
        block.cols.forEach((col, colIndex) => {
          addId(col.id, `${path}.cols.${colIndex}.id`, 'node');
          col.blocks.forEach((child, childIndex) => validateLeaf(child, `${path}.cols.${colIndex}.blocks.${childIndex}`));
        });
      } else if (block.type === 'cards') {
        totalBlocks += 1;
        addId(block.id, `${path}.id`, 'node');
        if (block.items.length < 2 || block.items.length > 12 || block.items.some((card) => card.blocks.length > limits.nestedBlocks)) issues.push({ path, code: 'doc.validation.cards_limit' });
        block.items.forEach((card, cardIndex) => {
          addId(card.id, `${path}.items.${cardIndex}.id`, 'node');
          card.blocks.forEach((child, childIndex) => validateLeaf(child, `${path}.items.${cardIndex}.blocks.${childIndex}`));
        });
      } else validateLeaf(block, path);
    });
  });
  if (totalBlocks > 5000) issues.push({ path: 'modules', code: 'doc.validation.too_many_blocks' });
  if (issues.length) return { ok: false, error: issues };
  return { ok: true, value: canonicalizeDocument(doc) };
}

export function plainText(inline: Inline): string {
  return inline.map((item) => 'br' in item ? '\n' : item.t).join('');
}

