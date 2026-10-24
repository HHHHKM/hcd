import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { diffHunks, mergeText, tokenize, detokenize, type Inline, type Unit } from './index';

describe('text collaboration', () => {
  it('splits CJK and whitespace into stable tokens and round-trips inline', () => {
    const source: Inline = [{ t: '产品 计划。', b: true }, { br: true }, { t: 'Q4 growth' }];
    expect(tokenize(source).map((unit) => unit.text)).toEqual(['产', '品', ' ', '计', '划', '。', '\n', 'Q4', ' ', 'growth']);
    expect(detokenize(tokenize(source))).toEqual(source);
    expect(detokenize(tokenize('plain text'))).toBe('plain text');
  });

  it('creates deterministic hunks that transform the original text', () => {
    const before = tokenize('A，B，C');
    const after = tokenize('X，B');
    const hunks = diffHunks(before, after);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.start).toBe(0);
    expect(hunks[1]?.end).toBe(before.length);
  });

  it('round-trips generated edit scripts for varied unit sequences', () => {
    const unit = fc.constantFrom('a', 'b', '中', ' ', '🙂').map((text) => ({ text, marks: {} }));
    fc.assert(fc.property(fc.array(unit, { maxLength: 30 }), fc.array(unit, { maxLength: 30 }), (before, after) => {
      const hunks = diffHunks(before, after);
      const result: Unit[] = before.slice();
      [...hunks].reverse().forEach((hunk) => result.splice(hunk.start, hunk.end - hunk.start, ...hunk.insert));
      return JSON.stringify(result) === JSON.stringify(after);
    }), { numRuns: 200 });
  });

  it('classifies unchanged and duplicate edits', () => {
    expect(mergeText('base', 'base', 'incoming')).toEqual({ status: 'clean', value: 'incoming' });
    expect(mergeText('base', 'same', 'same')).toEqual({ status: 'duplicate', value: 'same' });
  });

  it('merges disjoint edits from Chinese and English text', () => {
    expect(mergeText('10 月 15 日前完成灰度。', '10 月 20 日前完成灰度。', '10 月 15 日前完成灰度，并同步客服团队。')).toEqual({ status: 'merged', value: '10 月 20 日前完成灰度，并同步客服团队。' });
    expect(mergeText('Ship v2 next week.', 'Ship v2 next Monday.', 'Ship v2.1 next week.')).toEqual({ status: 'merged', value: 'Ship v2.1 next Monday.' });
  });

  it('finds text overlap and adjacent formatting conflicts', () => {
    expect(mergeText('本季度重点提升新用户第 7 天留存。', '本季度重点提升新用户第 7 天和第 30 天留存。', '本季度重点提升新用户首周留存和付费转化。').status).toBe('conflict');
    const base: Inline = [{ t: '新用户留存' }];
    const current: Inline = [{ t: '新用户' }, { t: '留存', b: true }];
    const incoming: Inline = [{ t: '新用户次日留存' }];
    expect(mergeText(base, current, incoming).status).toBe('conflict');
  });

  it('treats identical edits as one and merges independent edits into one value', () => {
    expect(mergeText('7 天', '七天', '七天')).toEqual({ status: 'duplicate', value: '七天' });
    expect(mergeText('A，B，C', 'A，B', 'X，B，C')).toEqual({ status: 'merged', value: 'X，B' });
    expect(mergeText('价格 100 元', '价格 120 元', '价格 150 元').status).toBe('conflict');
  });
});
