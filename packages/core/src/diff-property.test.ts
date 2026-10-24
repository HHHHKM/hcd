import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalJson, canonicalizeDocument, createCounterTmpIdSource, validateDocument, type Block, type Document } from './model';
import { diffDocuments } from './diff';
import { applyOpsStrict } from './ops';
import { compareDocumentChanges } from './changes';

const id = (value: number, prefix = 'n') => `${prefix}_${value.toString(32).replace(/[0-9a-v]/g, char => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(char, 32)]!).padStart(8, 'a')}`;
const members = fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { maxLength: 6 });
const shape = fc.record({
  columns: members, rows: members, categories: members, series: members, items: members,
  columnSplit: fc.integer({ min: 0, max: 6 }), rowSplit: fc.integer({ min: 0, max: 6 }),
  categorySplit: fc.integer({ min: 0, max: 6 }), seriesSplit: fc.integer({ min: 0, max: 6 }),
  order: fc.shuffledSubarray([1, 2, 3, 4, 5], { minLength: 5, maxLength: 5 }),
  moduleSplit: fc.integer({ min: 0, max: 5 }), data: fc.integer({ min: -4, max: 4 }),
});
type Shape = typeof shape extends fc.Arbitrary<infer Value> ? Value : never;

// Build two independently valid snapshots. Membership determines identity and
// placement; cells and values always reference that snapshot's own containers.
function document(value: Shape): Document {
  const part = (values: number[], split: number, side: number) => side === 0 ? values.slice(0, split) : values.slice(split);
  const blocks = new Map<number, Block>();
  for (const side of [0, 1]) {
    const columns = part(value.columns, value.columnSplit, side);
    blocks.set(side + 1, {
      id: id(side + 1), type: 'table', caption: `Table ${side} / ${value.data}`,
      columns: columns.map(column => ({ id: id(100 + column), header: [{ t: `Column ${column}` }], align: column % 2 ? 'left' : 'right' })),
      rows: part(value.rows, value.rowSplit, side).map(row => ({ id: id(200 + row), cells: Object.fromEntries(columns.map(column => [id(100 + column), [{ t: `${row}:${column}:${value.data}`, ...(value.data % 2 ? { b: true } : {}) }]])) })),
    });
    const categories = part(value.categories, value.categorySplit, side);
    blocks.set(side + 3, {
      id: id(side + 3), type: 'chart', kind: value.data % 2 ? 'line' : 'bar', title: `Chart ${side}`, unit: 'units',
      categories: categories.map(category => ({ id: id(300 + category), label: `Category ${category}` })),
      series: part(value.series, value.seriesSplit, side).map(series => ({ id: id(400 + series), name: `Series ${series}`, values: Object.fromEntries(categories.map(category => [id(300 + category), (series - category) * value.data])) })),
    });
  }
  blocks.set(5, { id: id(5), type: 'list', ordered: value.data > 0, items: value.items.map(item => ({ id: id(500 + item), text: [{ t: `Item ${item} / ${value.data}` }], items: [] })) });
  return {
    schemaVersion: 1, id: id(1, 'd'), title: `Snapshot ${value.data}`, theme: { id: 'default', version: 1, overrides: {} },
    modules: [0, 1].map(side => ({ id: id(side + 1, 'm'), title: `Module ${side}`, blocks: part(value.order, value.moduleSplit, side).map(key => blocks.get(key)!) })),
  };
}

function remap(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map(child => remap(child, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [ids.get(key) ?? key, remap(child, ids)]));
  return value;
}

describe('coupled structure diff properties', () => {
  it('AT-14 round trips independent tables, charts and lists with reordered, moved, added and ' +
     'removed identities', () => {
    fc.assert(fc.property(shape, shape, (before, after) => {
      const source = document(before); const target = document(after);
      expect(validateDocument(source).ok).toBe(true); expect(validateDocument(target).ok).toBe(true);
      const frozenSource = structuredClone(source); const frozenTarget = structuredClone(target);
      const temporary = new Map<string, string>();
      const operations = diffDocuments(source, target, createCounterTmpIdSource('property'), (original, tmp) => temporary.set(original, tmp));
      let allocated = 1000;
      const replayed = applyOpsStrict(source, operations, { next: prefix => id(++allocated, prefix) });
      expect(replayed.ok, JSON.stringify(replayed)).toBe(true);
      if (!replayed.ok) return;
      const permanent = new Map([...temporary].map(([original, tmp]) => [original, replayed.value.idMap[tmp]!]));
      const expected = canonicalizeDocument(remap(target, permanent) as Document);
      expect(canonicalJson(replayed.value.doc)).toBe(canonicalJson(expected));
      expect(compareDocumentChanges(source, target).unavailable).toBeUndefined();
      expect(source).toEqual(frozenSource); expect(target).toEqual(frozenTarget);
    }), { numRuns: 120, seed: 2026102301 });
  });
});
