import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChangeList, { NodeContent } from './ChangeList';
import ReviewChanges from './ReviewChanges';
import { textChangeSegments, type Change } from '../../core/src/changes';
import type { ReviewPresentation } from '../../core/src/review-types';
const text: Change = {
  kind: 'text',
  opIndex: 0,
  moduleId: 'm_aaaaaaaa',
  moduleTitle: 'Main',
  targetId: 'n_aaaaaaaa',
  targetType: 'paragraph',
  field: 'text',
  before: [{ t: 'Old text' }],
  after: [{ t: 'New text', b: true }],
  ...textChangeSegments([{ t: 'Old text' }], [{ t: 'New text', b: true }]),
};
describe('change presentation markup', () => {
  it('keeps series names visible in structural details even when the series has no data', () => {
    const html = renderToStaticMarkup(
      <NodeContent node={{ id: 'n_aaaaaaaa', name: '<Revenue>', values: {} }} locale="en" />,
    );
    expect(html).toContain('Name:');
    expect(html).toContain('&lt;Revenue&gt;');
    const zero = renderToStaticMarkup(
      <NodeContent node={{ id: 'n_aaaaaaaa', name: 'Revenue', values: { n_bbbbbbbb: 0 } }} locale="zh-CN" />,
    );
    expect(zero).toContain('Revenue');
    expect(zero).toContain('<dd>0</dd>');
  });
  it('escapes source text and renders accessible addition/deletion and formatting marks', () => {
    const before = [{ t: '<script>alert(1)</script>', href: 'javascript:alert(1)' }];
    const after = [{ t: 'Safe text', b: true as const, href: 'https://example.test/' }];
    const html = renderToStaticMarkup(
      <ChangeList
        changeSet={{ changes: [{ ...text, before, after, ...textChangeSegments(before, after) }] }}
        locale="en"
      />,
    );
    expect(html).toContain('<del>');
    expect(html).toContain('<ins>');
    expect(html).toContain('Removed:');
    expect(html).toContain('Added:');
    expect(html).toContain('<strong>Safe text</strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('Link destinations:');
  });
  it('makes link destination swaps visible even when the set of URLs is unchanged', () => {
    const before = [
      { t: 'Alpha', href: 'https://a.test' },
      { t: 'Beta', href: 'https://b.test' },
    ];
    const after = [
      { t: 'Alpha', href: 'https://b.test' },
      { t: 'Beta', href: 'https://a.test' },
    ];
    const html = renderToStaticMarkup(
      <ChangeList
        changeSet={{ changes: [{ ...text, before, after, ...textChangeSegments(before, after) }] }}
        locale="en"
      />,
    );
    expect(html).toContain('Alpha → https://a.test');
    expect(html).toContain('Alpha → https://b.test');
  });
  it('labels entire-submission exclusion instead of equating evaluated operations with candidate inclusion', () => {
    const html = renderToStaticMarkup(
      <ChangeList
        changeSet={{ changes: [text] }}
        locale="zh-CN"
        excluded
        outcomes={[{ index: 0, outcome: 'applied' }]}
      />,
    );
    expect(html).toContain('本提交整体未纳入候选版本');
    expect(html).not.toContain('已纳入');
  });
  it('paginates long operation lists and explicitly distinguishes unavailable from no differences', () => {
    const changes = Array.from({ length: 30 }, (_, opIndex) => ({ ...text, opIndex }));
    const html = renderToStaticMarkup(<ChangeList changeSet={{ changes }} locale="en" />);
    expect(html.match(/class="change-card /g)).toHaveLength(25);
    expect(html).toContain('Show 25 more');
    expect(
      renderToStaticMarkup(<ChangeList changeSet={{ changes: [], unavailable: 'DISPLAY_TOO_LARGE' }} locale="en" />),
    ).toContain('comparison is unavailable');
    expect(renderToStaticMarkup(<ChangeList changeSet={{ changes: [] }} locale="en" />)).toContain(
      'No content differences',
    );
  });
  it('shows the actual saved candidate first and marks older reviews without presentation honestly', () => {
    const presentation: ReviewPresentation = {
      version: 1,
      baseVersion: 3,
      proposed: [],
      candidate: { changes: [text] },
    };
    const html = renderToStaticMarkup(
      <ReviewChanges presentation={presentation} locale="en" onReadSubmission={() => {}} />,
    );
    expect(html).toContain('Compared with published version 3');
    expect(html).toContain('Actual candidate changes');
    expect(html).toContain('Original submissions');
    expect(html).toContain('Full candidate document');
    const old = renderToStaticMarkup(<ReviewChanges presentation={null} locale="zh-CN" onReadSubmission={() => {}} />);
    expect(old).toContain('旧审核记录没有保存逐项对比');
    expect(old).not.toContain('没有内容差异');
  });
});
