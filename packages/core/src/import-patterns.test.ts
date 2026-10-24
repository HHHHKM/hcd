import { parseFragment } from 'parse5';
import { describe, expect, it } from 'vitest';
import { createCounterIdSource } from './model';
import { isImportTreeBounded, recognizeDataGroup, type ImportNode } from './import-patterns';

const parse = (html: string) => (parseFragment(html) as unknown as ImportNode).childNodes![0]!;
const recognize = (html: string) => { const ids = createCounterIdSource(); return recognizeDataGroup(parse(html), () => ids.next('n')); };
describe('heuristic import patterns', () => {
  it('AT-43 recognizes labeled metric groups and positive, negative, and neutral deltas', () => {
    const block = recognize('<div><article class="metric"><span>Revenue</span><strong>$12,000</strong><em>+8%</em></article><article class="metric"><span>Churn</span><strong>2.1%</strong><em>↓1%</em></article><article class="metric"><span>Users</span><strong><span>3k</span></strong></article></div>');
    expect(block?.type).toBe('kpis');
    if (block?.type !== 'kpis') throw new Error('Expected metrics');
    expect(block.items.map(({ label, value, delta, tone }) => ({ label, value, delta, tone }))).toEqual([{ label: 'Revenue', value: '$12,000', delta: '+8%', tone: 'good' }, { label: 'Churn', value: '2.1%', delta: '↓1%', tone: 'bad' }, { label: 'Users', value: '3k', delta: '', tone: 'neutral' }]);
    expect(new Set([block.id, ...block.items.map((item) => item.id)]).size).toBe(4);
  });
  it('AT-18 falls back when numerical meaning or group structure is ambiguous', () => {
    expect(recognize('<div><div><b>10</b><span>20</span><p>Values</p></div></div>')).toBeNull();
    expect(recognize('<div><div><b>10</b></div></div>')).toBeNull();
    expect(recognize('<div><article><b>10</b><span>A</span></article><div><b>20</b><span>B</span></div></div>')).toBeNull();
    expect(recognize('<ul><li>Apples</li><li>Oranges</li></ul>')).toBeNull();
  });
  it('AT-43 recognizes English and Chinese timeline labels without duplicating headings', () => {
    const block = recognize('<ol><li><span>Q1</span><strong>Plan</strong><p>Research</p></li><li><b>第二阶段 发布</b><p>Ship</p></li><li><span>2026年10月</span><h3>Review</h3><p>Learn</p></li></ol>');
    expect(block?.type).toBe('timeline'); if (block?.type !== 'timeline') throw new Error('Expected timeline');
    expect(block.items.map(({ label, title, text }) => ({ label, title, text }))).toEqual([{ label: 'Q1', title: 'Plan', text: [{ t: 'Research' }] }, { label: '第二阶段', title: '发布', text: [{ t: 'Ship' }] }, { label: '2026年10月', title: 'Review', text: [{ t: 'Learn' }] }]);
  });
  it('AT-18 bounds depth and node counts before recursive conversion', () => {
    expect(isImportTreeBounded(parse('<div>'.repeat(70) + 'deep' + '</div>'.repeat(70)))).toBe(false);
    expect(isImportTreeBounded(parse('<div><p>A</p><p>B</p></div>'), 3)).toBe(false);
    expect(isImportTreeBounded(parse('<div><p>A</p><p>B</p></div>'))).toBe(true);
  });
});
