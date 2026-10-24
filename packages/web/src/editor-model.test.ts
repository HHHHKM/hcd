import { describe, expect, it } from 'vitest';
import {
  createCounterIdSource,
  validateDocument,
  type Document,
  type Block,
  type TableBlock,
  type ChartBlock,
} from '../../core/src/model';
import {
  blockTypes,
  createBlock,
  createModule,
  duplicateBlock,
  insertBlock,
  moveItem,
  newHistory,
  recordHistory,
  removeBlock,
  removeChartCategory,
  removeTableColumn,
  replaceBlock,
  travelHistory,
} from './editor-model';

function fixture() {
  const ids = createCounterIdSource();
  const document: Document = {
    schemaVersion: 1,
    id: ids.next('d'),
    title: 'Editor',
    theme: { id: 'default', version: 1, overrides: {} },
    modules: [createModule(ids, 'en')],
  };
  return { ids, document, moduleId: document.modules[0]!.id };
}

describe('structured draft editing', () => {
  it('AT-43 creates every editable block and validates their complete document in both languages', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const { ids, document } = fixture();
      document.modules[0]!.blocks = blockTypes.map((type) => createBlock(type, ids, locale));
      expect(validateDocument(document)).toMatchObject({ ok: true });
    }
  });

  it('copies every block with fresh node IDs while retaining text and asset references', () => {
    const { ids, document } = fixture();
    const blocks: Block[] = [
      ...blockTypes.map((type) => createBlock(type, ids, 'en')),
      { id: ids.next('n'), type: 'raw', asset: 'as_aaaaaaaaaaaa', height: 300, allowScripts: false, note: 'Original' },
    ];
    for (const block of blocks) {
      const copied = duplicateBlock(block, ids);
      expect(copied.id).not.toBe(block.id);
      document.modules[0]!.blocks.push(block, copied);
      if (copied.type === 'raw') expect(copied.asset).toBe('as_aaaaaaaaaaaa');
    }
    expect(validateDocument(document)).toMatchObject({ ok: true });
  });

  it('remaps table cell keys and chart value keys when duplicating, without rewriting matching text', () => {
    const { ids } = fixture();
    const table = createBlock('table', ids, 'en') as TableBlock;
    const originalColumn = table.columns[0]!.id;
    table.rows[0]!.cells[originalColumn] = [{ t: originalColumn, b: true }];
    const copiedTable = duplicateBlock(table, ids) as TableBlock;
    expect(copiedTable.rows[0]!.cells[copiedTable.columns[0]!.id]).toEqual([{ t: originalColumn, b: true }]);
    expect(copiedTable.rows[0]!.cells).not.toHaveProperty(originalColumn);
    const chart = createBlock('chart', ids, 'en') as ChartBlock;
    const copiedChart = duplicateBlock(chart, ids) as ChartBlock;
    expect(copiedChart.series[0]!.values[copiedChart.categories[0]!.id]).toBe(10);
    expect(copiedChart.series[0]!.values).not.toHaveProperty(chart.categories[0]!.id);
  });

  it('deletes reference values together with their table column or chart category', () => {
    const { ids, document } = fixture();
    const table = createBlock('table', ids, 'en') as TableBlock;
    table.rows[0]!.cells[table.columns[0]!.id] = [{ t: 'delete me' }];
    const chart = createBlock('chart', ids, 'en') as ChartBlock;
    const nextTable = removeTableColumn(table, table.columns[0]!.id);
    const nextChart = removeChartCategory(chart, chart.categories[0]!.id);
    expect(nextTable.rows[0]!.cells).toEqual({});
    expect(Object.keys(nextChart.series[0]!.values)).toEqual(nextChart.categories.map((item) => item.id));
    document.modules[0]!.blocks = [nextTable, nextChart];
    expect(validateDocument(document)).toMatchObject({ ok: true });
    expect(table.columns).toHaveLength(2);
    expect(chart.categories).toHaveLength(3);
  });

  it('edits and removes nested leaves while preserving unrelated blocks and immutable input', () => {
    const { ids, document, moduleId } = fixture();
    const columns = createBlock('columns', ids, 'en');
    if (columns.type !== 'columns') throw new Error('Unexpected fixture');
    const before = insertBlock(document, moduleId, columns);
    const leaf = columns.cols[0]!.blocks[0]!;
    const after = replaceBlock(before, moduleId, leaf.id, {
      id: leaf.id,
      type: 'paragraph',
      text: [{ t: 'New text', i: true }],
    });
    expect(JSON.stringify(before)).not.toContain('New text');
    expect(JSON.stringify(after)).toContain('New text');
    expect(after.modules[0]!.blocks[0]).toBe(before.modules[0]!.blocks[0]);
    const removed = removeBlock(after, moduleId, leaf.id);
    expect(validateDocument(removed)).toMatchObject({ ok: true });
    expect(JSON.stringify(removed)).not.toContain(leaf.id);
    expect(() => replaceBlock(before, moduleId, leaf.id, { ...columns, id: leaf.id })).toThrow('Nested containers');
  });

  it('moves whole records without changing identity and treats boundary moves as no-ops', () => {
    const items = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'c', value: 3 },
    ];
    const moved = moveItem(items, 'b', -1);
    expect(moved.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(moved[0]).toBe(items[1]);
    expect(moveItem(items, 'a', -1)).toBe(items);
    expect(moveItem(items, 'missing', 1)).toBe(items);
  });

  it('undoes structural edits and clears redo on a new edit without touching the published base', () => {
    const { ids, document, moduleId } = fixture();
    const next = insertBlock(document, moduleId, createBlock('timeline', ids, 'en'));
    const recorded = recordHistory(newHistory(document), next);
    const undo = travelHistory(recorded, -1);
    expect(undo.present).toBe(document);
    expect(travelHistory(undo, 1).present).toBe(next);
    const changed = recordHistory(undo, { ...document, title: 'Changed' });
    expect(changed.future).toEqual([]);
    expect(document.title).toBe('Editor');
  });
});
