import { translate } from './shared/i18n';
import type { Block, ChartBlock, Document, IdSource, LeafBlock, Module, TableBlock } from '../../core/src/model';

export type EditableBlockType = Exclude<Block['type'], 'raw'>;
export const blockTypes: EditableBlockType[] = [
  'paragraph',
  'heading',
  'list',
  'quote',
  'callout',
  'table',
  'chart',
  'timeline',
  'kpis',
  'columns',
  'cards',
  'image',
  'divider',
];

export function createBlock(type: EditableBlockType, ids: IdSource, locale: 'zh-CN' | 'en'): Block {
  const id = ids.next('n');

  switch (type) {
    case 'paragraph':
    case 'quote':
      return { id, type, text: [] };
    case 'heading':
      return { id, type, level: 3, text: [] };
    case 'list':
      return { id, type, ordered: false, items: [{ id: ids.next('n'), text: [], items: [] }] };
    case 'callout':
      return { id, type, tone: 'info', title: '', text: [] };
    case 'divider':
      return { id, type };
    case 'image':
      return { id, type, asset: null, alt: '', caption: '', width: 'normal' };
    case 'table': {
      const columns = [1, 2].map((number) => ({
        id: ids.next('n'),
        header: [{ t: `${translate(locale, 'reader.column')} ${number}` }],
        align: 'left' as const,
      }));
      return { id, type, caption: '', columns, rows: [{ id: ids.next('n'), cells: {} }] };
    }
    case 'chart': {
      const categories = [1, 2, 3].map((number) => ({
        id: ids.next('n'),
        label: `${translate(locale, 'reader.category')} ${number}`,
      }));
      return {
        id,
        type,
        kind: 'bar',
        title: '',
        unit: '',
        categories,
        series: [
          {
            id: ids.next('n'),
            name: translate(locale, 'reader.series'),
            values: Object.fromEntries(categories.map((item, index) => [item.id, (index + 1) * 10])),
          },
        ],
      };
    }
    case 'timeline':
      return {
        id,
        type,
        items: [1, 2].map((number) => ({
          id: ids.next('n'),
          label: `${translate(locale, 'reader.stage')} ${number}`,
          title: '',
          text: [],
        })),
      };
    case 'kpis':
      return {
        id,
        type,
        items: [
          { id: ids.next('n'), label: translate(locale, 'reader.metric'), value: '0', delta: '', tone: 'neutral' },
        ],
      };
    case 'columns':
      return {
        id,
        type,
        ratio: '1:1',
        cols: [1, 2].map(() => ({ id: ids.next('n'), blocks: [createBlock('paragraph', ids, locale) as LeafBlock] })),
      };
    case 'cards':
      return {
        id,
        type,
        perRow: 2,
        items: [1, 2].map(() => ({
          id: ids.next('n'),
          title: '',
          blocks: [createBlock('paragraph', ids, locale) as LeafBlock],
        })),
      };
  }
}

export function createModule(ids: IdSource, locale: 'zh-CN' | 'en'): Module {
  return {
    id: ids.next('m'),
    title: translate(locale, 'reader.newSection'),
    blocks: [createBlock('paragraph', ids, locale)],
  };
}

export function moveItem<T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function replaceBlock(document: Document, moduleId: string, blockId: string, replacement: Block): Document {
  if (replacement.id !== blockId) throw new Error('Replacing a block must preserve its ID.');
  return {
    ...document,
    modules: document.modules.map((module) =>
      module.id !== moduleId
        ? module
        : {
            ...module,
            blocks: module.blocks.map((block) => {
              if (block.id === blockId) return replacement;
              const replaceLeaf = (leaf: LeafBlock): LeafBlock => {
                if (leaf.id !== blockId) return leaf;
                if (replacement.type === 'columns' || replacement.type === 'cards')
                  throw new Error('Nested containers are not supported.');
                return replacement;
              };
              if (block.type === 'columns')
                return { ...block, cols: block.cols.map((col) => ({ ...col, blocks: col.blocks.map(replaceLeaf) })) };
              if (block.type === 'cards')
                return {
                  ...block,
                  items: block.items.map((card) => ({ ...card, blocks: card.blocks.map(replaceLeaf) })),
                };
              return block;
            }),
          },
    ),
  };
}

export function removeBlock(document: Document, moduleId: string, blockId: string): Document {
  return {
    ...document,
    modules: document.modules.map((module) =>
      module.id !== moduleId
        ? module
        : {
            ...module,
            blocks: module.blocks
              .filter((block) => block.id !== blockId)
              .map((block) => {
                if (block.type === 'columns')
                  return {
                    ...block,
                    cols: block.cols.map((col) => ({
                      ...col,
                      blocks: col.blocks.filter((leaf) => leaf.id !== blockId),
                    })),
                  };
                if (block.type === 'cards')
                  return {
                    ...block,
                    items: block.items.map((card) => ({
                      ...card,
                      blocks: card.blocks.filter((leaf) => leaf.id !== blockId),
                    })),
                  };
                return block;
              }),
          },
    ),
  };
}

export function insertBlock(document: Document, moduleId: string, block: Block): Document {
  return {
    ...document,
    modules: document.modules.map((module) =>
      module.id === moduleId ? { ...module, blocks: [...module.blocks, block] } : module,
    ),
  };
}

export function removeTableColumn(block: TableBlock, id: string): TableBlock {
  return {
    ...block,
    columns: block.columns.filter((column) => column.id !== id),
    rows: block.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(Object.entries(row.cells).filter(([key]) => key !== id)),
    })),
  };
}

export function removeChartCategory(block: ChartBlock, id: string): ChartBlock {
  return {
    ...block,
    categories: block.categories.filter((category) => category.id !== id),
    series: block.series.map((series) => ({
      ...series,
      values: Object.fromEntries(Object.entries(series.values).filter(([key]) => key !== id)),
    })),
  };
}

/** Copy node IDs and internal references together; asset references stay shared. */
export function duplicateBlock(block: Block, ids: IdSource): Block {
  const mapped = new Map<string, string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') mapped.set(record.id, ids.next('n'));
    Object.values(record).forEach(collect);
  };
  collect(block);
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        mapped.get(key) ?? key,
        key === 'id' && typeof item === 'string' ? (mapped.get(item) ?? item) : rewrite(item),
      ]),
    );
  };
  return rewrite(block) as Block;
}

export type DraftHistory = { past: Document[]; present: Document; future: Document[] };
export const newHistory = (present: Document): DraftHistory => ({ past: [], present, future: [] });
export function recordHistory(history: DraftHistory, next: Document): DraftHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { past: [...history.past.slice(-49), history.present], present: next, future: [] };
}
export function travelHistory(history: DraftHistory, direction: -1 | 1): DraftHistory {
  if (direction === -1) {
    const previous = history.past.at(-1);
    return previous
      ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
      : history;
  }
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}
