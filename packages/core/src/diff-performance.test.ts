import { describe, expect, it } from 'vitest';
import { diffDocuments } from './diff';
import { hashOf } from './hash';
import { canonicalizeDocument, createCounterIdSource, createCounterTmpIdSource, validateDocument, type Block, type Document, type ParagraphBlock } from './model';
import { applyOpsStrict, arrayFor, locate, place, setField, subtreeHash } from './ops';

const id = (value: number, prefix = 'n'): string => `${prefix}_${value.toString(32).replace(/[0-9a-v]/g, char => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(char, 32)]!).padStart(8, 'a')}`;
const paragraph = (value: number): ParagraphBlock => ({ id: id(value), type: 'paragraph', text: [{ t: `Paragraph ${value}` }] });
const document = (blocks: Block[]): Document => ({ schemaVersion: 1, id: id(1, 'd'), title: 'Diff', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: id(1, 'm'), title: 'Main', blocks }] });

// Reference each deletion against the original whole-document hash function at
// the exact operation position, including temporarily invalid container sizes.
function verifySequentialHashes(source: Document, target: Document): string[] {
  expect(validateDocument(source).ok).toBe(true);
  expect(validateDocument(target).ok).toBe(true);
  const sourceCopy = structuredClone(source); const targetCopy = structuredClone(target);
  const ops = diffDocuments(source, target, createCounterTmpIdSource('hash'));
  const staged = structuredClone(canonicalizeDocument(source));
  const deleted: string[] = [];
  for (const op of ops) {
    if (op.op === 'set') expect(setField(staged, op.at.id, op.at.field, op.after)).toBe(true);
    else if (op.op === 'delete') {
      expect(op.beforeHash, op.target).toBe(subtreeHash(staged, op.target));
      deleted.push(op.target);
      const source = locate(staged, op.target)!;
      if (source.list === 'columns') for (const row of source.parent.rows) delete row.cells[op.target];
      if (source.list === 'categories') for (const series of source.parent.series) delete series.values[op.target];
      source.array.splice(source.index, 1);
    } else {
      const destination = arrayFor(staged, op.parent)!;
      const source = op.op === 'move' ? locate(staged, op.target)! : undefined;
      const node = op.op === 'insert' ? structuredClone(op.node) : source!.array.splice(source!.index, 1)[0];
      destination.array.splice(place(destination.array, op.after)!, 0, node);
    }
  }
  const replayed = applyOpsStrict(source, ops, createCounterIdSource());
  expect(replayed.ok, JSON.stringify(replayed)).toBe(true);
  if (replayed.ok) expect(replayed.value.doc).toEqual(canonicalizeDocument(target));
  expect(source).toEqual(sourceCopy); expect(target).toEqual(targetCopy);
  return deleted;
}

describe('large and context-sensitive document diff', () => {
  it('keeps every ordered deletion and hash in a 5,000 paragraph diff without mutating either snapshot', () => {
    const source = document(Array.from({ length: 5_000 }, (_, index) => paragraph(index + 1)));
    const target = document([]);
    const sourceCopy = structuredClone(source); const targetCopy = structuredClone(target);
    const ops = diffDocuments(source, target, createCounterTmpIdSource('large'));
    // No wall-clock threshold: this asserts the large input is neither truncated
    // nor coalesced to avoid the actual hash and ordering work.
    expect(ops).toEqual(source.modules[0]!.blocks.map(node => ({ op: 'delete', target: node.id, beforeHash: hashOf(node) })));
    expect(source).toEqual(sourceCopy); expect(target).toEqual(targetCopy);
  });

  it('preserves whole-document hashes for nested and module deletions after surviving descendants move and change', () => {
    const source = document([
      { id: id(10), type: 'columns', ratio: '1:1:1', cols: [
        { id: id(11), blocks: [paragraph(12), paragraph(13)] },
        { id: id(14), blocks: [paragraph(15)] },
        { id: id(16), blocks: [paragraph(17)] },
      ] },
      { id: id(20), type: 'cards', perRow: 2, items: [
        { id: id(21), title: 'Removed card', blocks: [paragraph(22), paragraph(23)] },
        { id: id(24), title: 'Second', blocks: [paragraph(25)] },
        { id: id(26), title: 'Third', blocks: [paragraph(27)] },
      ] },
      { id: id(30), type: 'list', ordered: false, items: [
        { id: id(31), text: [{ t: 'Removed parent' }], items: [{ id: id(32), text: [{ t: 'Survives' }], items: [] }] },
        { id: id(33), text: [{ t: 'Retained parent' }], items: [{ id: id(34), text: [{ t: 'Removed nested item' }], items: [] }] },
      ] },
      { id: id(40), type: 'timeline', items: [41, 42, 43].map(value => ({ id: id(value), label: 'L', title: 'T', text: [{ t: 'Details' }] })) },
      { id: id(50), type: 'kpis', items: [51, 52].map(value => ({ id: id(value), label: 'L', value: '2', delta: '1', tone: 'good' })) },
    ]);
    source.modules.push({ id: id(2, 'm'), title: 'Moved from', blocks: [paragraph(60), paragraph(61)] });
    source.modules.push({ id: id(3, 'm'), title: 'Fully removed', blocks: [paragraph(62)] });
    const target = structuredClone(source);
    const [columns, cards, list, timeline, kpis] = target.modules[0]!.blocks;
    if (columns?.type !== 'columns' || cards?.type !== 'cards' || list?.type !== 'list' || timeline?.type !== 'timeline' || kpis?.type !== 'kpis') throw new Error('fixture');
    const firstColumn = columns.cols.shift()!; columns.ratio = '1:1';
    columns.cols[0]!.blocks.push({ ...firstColumn.blocks[0] as ParagraphBlock, text: [{ t: 'Moved and changed column child' }] });
    columns.cols[1]!.blocks = [];
    const firstCard = cards.items.shift()!;
    cards.items[0]!.blocks.push({ ...firstCard.blocks[0] as ParagraphBlock, text: [{ t: 'Moved and changed card child' }] });
    cards.items[1]!.blocks = [];
    const firstItem = list.items.shift()!;
    list.items[0]!.items = [];
    list.items.push({ ...firstItem.items[0]!, text: [{ t: 'Moved and changed nested item' }] });
    timeline.items.shift(); kpis.items.shift();
    target.modules[0]!.blocks.push({ ...target.modules[1]!.blocks[0] as ParagraphBlock, text: [{ t: 'Moved from deleted module' }] });
    target.modules = [target.modules[0]!];
    const deleted = verifySequentialHashes(source, target);
    expect(deleted).toEqual([id(17), id(27), id(34), id(41), id(51), id(3, 'm'), id(11), id(21), id(31), id(2, 'm')]);
  });

  it('preserves current table and chart coupling when columns, categories, rows and series are deleted or moved', () => {
    const source = document([
      { id: id(100), type: 'table', caption: 'Table', columns: [101, 102, 103].map(value => ({ id: id(value), header: [{ t: `Header ${value}` }], align: 'left' })), rows: [104, 105, 106].map(value => ({ id: id(value), cells: Object.fromEntries([101, 102, 103].map(column => [id(column), [{ t: `${value}:${column}` }]])) })) },
      { id: id(110), type: 'table', caption: 'Destination', columns: [], rows: [] },
      { id: id(120), type: 'chart', kind: 'bar', title: 'Chart', unit: 'units', categories: [121, 122, 123].map(value => ({ id: id(value), label: `Category ${value}` })), series: [124, 125, 126].map(value => ({ id: id(value), name: `Series ${value}`, values: Object.fromEntries([121, 122, 123].map(category => [id(category), value - category])) })) },
      { id: id(130), type: 'chart', kind: 'line', title: 'Destination', unit: 'units', categories: [], series: [] },
    ]);
    const target = structuredClone(source);
    const [table, destinationTable, chart, destinationChart] = target.modules[0]!.blocks;
    if (table?.type !== 'table' || destinationTable?.type !== 'table' || chart?.type !== 'chart' || destinationChart?.type !== 'chart') throw new Error('fixture');
    destinationTable.columns = [table.columns[2]!];
    destinationTable.rows = [{ ...table.rows[1]!, cells: { [id(103)]: [{ t: 'Changed while moving' }] } }];
    table.columns = [table.columns[1]!];
    table.rows = [{ ...table.rows[2]!, cells: { [id(102)]: [{ t: 'Changed while retained' }] } }];
    destinationChart.categories = [chart.categories[2]!];
    destinationChart.series = [{ ...chart.series[1]!, values: { [id(123)]: 0 } }];
    chart.categories = [chart.categories[1]!];
    chart.series = [{ ...chart.series[2]!, values: { [id(122)]: 999 } }];
    expect(verifySequentialHashes(source, target)).toEqual([id(101), id(104), id(121), id(124)]);
  });
});
