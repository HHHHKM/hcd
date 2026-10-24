import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalizeDocument, canonicalizeInline, createCounterIdSource, createCounterTmpIdSource, validateDocument, type Document, type Inline } from './model';

const sample: Document = {
  schemaVersion: 1,
  id: 'd_aaaaaaaa',
  title: '  Growth plan  ',
  theme: { id: 'default', version: 1, overrides: {} },
  modules: [{ id: 'm_aaaaaaaa', title: 'Context', blocks: [
    { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: ' Hello ' }, { t: ' world ', b: true }, { t: '!', href: 'javascript:alert(1)' }] },
  ] }],
};

describe('content model', () => {
  it('AT-09 canonicalizes text, merges runs and strips unsafe link protocols', () => {
    const result = canonicalizeDocument(sample);
    expect(result.title).toBe('Growth plan');
    expect(result.modules[0]?.blocks[0]).toEqual({
      id: 'n_aaaaaaaa', type: 'paragraph',
      text: [{ t: 'Hello ' }, { t: ' world ', b: true }, { t: '!' }],
    });
  });

  it.each<{ label: string; source: Inline; expected: Inline }>([
    { label: 'leading runs', source: [{ t: ' ', b: true }, { t: '\t', i: true }, { t: ' text', code: true }], expected: [{ t: 'text', code: true }] },
    { label: 'trailing runs', source: [{ t: 'text ', code: true }, { t: '\n', i: true }, { t: ' ', b: true }], expected: [{ t: 'text', code: true }] },
    { label: 'only whitespace', source: [{ t: ' ', b: true }, { t: '\r', i: true }], expected: [] },
    { label: 'trailing whitespace after a break', source: [{ br: true }, { t: ' ', b: true }, { t: ' ', i: true }], expected: [{ br: true }] },
    { label: 'interior whitespace around a break', source: [{ t: ' text ', b: true }, { br: true }, { t: ' text ', i: true }], expected: [{ t: 'text ', b: true }, { br: true }, { t: ' text', i: true }] },
    { label: 'whitespace between breaks', source: [{ br: true }, { t: ' ', b: true }, { t: ' ', i: true }, { br: true }], expected: [{ br: true }, { t: ' ', b: true }, { t: ' ', i: true }, { br: true }] },
  ])('canonicalizes $label once without mutating the input', ({ source, expected }) => {
    const before = structuredClone(source);
    const result = canonicalizeInline(source);
    expect(result).toEqual(expected);
    expect(canonicalizeInline(result)).toEqual(result);
    expect(source).toEqual(before);
  });

  it('serializes object keys deterministically', () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: 2 } })).toBe('{"a":{"b":2,"y":true},"z":1}');
  });

  it('validates unique, well-formed content IDs', () => {
    expect(validateDocument(sample).ok).toBe(true);
    const duplicated = structuredClone(sample);
    duplicated.modules.push({ ...duplicated.modules[0]!, title: 'Duplicate module' });
    const result = validateDocument(duplicated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((issue) => issue.code === 'doc.validation.duplicate_id')).toBe(true);
  });

  it('AT-43 validates required timeline size and table reference integrity', () => {
    const invalid: Document = {
      ...sample,
      modules: [{ id: 'm_bbbbbbbb', title: 'Data', blocks: [
        { id: 'n_bbbbbbbb', type: 'timeline', items: [{ id: 'n_cccccccc', label: 'Q1', title: 'Start', text: [] }] },
        { id: 'n_dddddddd', type: 'table', caption: '', columns: [{ id: 'n_eeeeeeee', header: [], align: 'left' }], rows: [{ id: 'n_ffffffff', cells: { n_gggggggg: [{ t: 'orphan' }] } }] },
      ] }],
    };
    const result = validateDocument(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === 'doc.validation.timeline_limit')).toBe(true);
      expect(result.error.some((issue) => issue.code === 'doc.validation.unknown_column')).toBe(true);
    }
  });

  it('provides explicit deterministic ID sources for core operations', () => {
    const ids = createCounterIdSource();
    expect([ids.next('d'), ids.next('m'), ids.next('n')]).toEqual(['d_aaaaaaab', 'm_aaaaaaac', 'n_aaaaaaad']);
    const tempIds = createCounterTmpIdSource('room');
    expect([tempIds.next(), tempIds.next()]).toEqual(['tmp_room_1', 'tmp_room_2']);
  });
});
