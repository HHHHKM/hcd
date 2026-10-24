import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BlockRead, { RenderInline } from './BlockRead';
import { createCounterIdSource, type ChartBlock, type Inline, type TableBlock } from '../../core/src/model';
import { createBlock } from './editor-model';

describe('structured reading', () => {
  it('AT-09 escapes user text, preserves supported formatting and rejects executable links', () => {
    const inline: Inline = [
      { t: '<script>alert(1)</script>', b: true, i: true },
      { br: true },
      { t: 'unsafe', href: 'javascript:alert(1)' },
      { t: 'safe', code: true, href: 'https://example.com' },
    ];
    const html = renderToStaticMarkup(<RenderInline inline={inline} />);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br/>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://example.com"');
  });
  it('preserves table cell formatting, header alignment and ordered nested lists', () => {
    const ids = createCounterIdSource();
    const table = createBlock('table', ids, 'en') as TableBlock;
    table.columns[0]!.align = 'right';
    table.rows[0]!.cells[table.columns[0]!.id] = [{ t: 'Value', b: true }];
    const html = renderToStaticMarkup(<BlockRead block={table} locale="en" />);
    expect(html).toContain('text-align:right');
    expect(html).toContain('<strong>Value</strong>');
    const list = renderToStaticMarkup(
      <BlockRead
        block={{
          id: ids.next('n'),
          type: 'list',
          ordered: true,
          items: [
            {
              id: ids.next('n'),
              text: [{ t: 'Parent' }],
              items: [{ id: ids.next('n'), text: [{ t: 'Child' }], items: [] }],
            },
          ],
        }}
        locale="en"
      />,
    );
    expect(list.match(/<ol /g)).toHaveLength(2);
    expect(list).toContain('Child');
  });
  it('draws signed bars from zero, distinguishes nulls, and includes every series', () => {
    const block = createBlock('chart', createCounterIdSource(), 'en') as ChartBlock;
    block.series[0]!.values = { [block.categories[0]!.id]: -5, [block.categories[1]!.id]: 10 };
    const html = renderToStaticMarkup(<BlockRead block={block} locale="en" />);
    expect(html).toContain('data-value="-5"');
    expect(html).toContain('data-value="10"');
    expect(html.match(/<rect /g)).toHaveLength(2);
    const baseline = Number(/data-baseline-y="([^"]+)"/.exec(html)![1]);
    const negativeY = Number(/data-value="-5"[^>]* y="([^"]+)"/.exec(html)![1]);
    expect(negativeY).toBe(baseline);
    expect(html).toContain('—');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
  it('breaks line charts at absent data and renders pie arcs without invalid coordinates', () => {
    const block = createBlock('chart', createCounterIdSource(), 'en') as ChartBlock;
    block.kind = 'line';
    block.series[0]!.values[block.categories[1]!.id] = null;
    const line = renderToStaticMarkup(<BlockRead block={block} locale="en" />);
    const path = /data-line="true" d="([^"]*)"/.exec(line)![1]!;
    expect(path.match(/M /g)).toHaveLength(2);
    expect(path).not.toContain('L ');
    block.kind = 'pie';
    const pie = renderToStaticMarkup(<BlockRead block={block} locale="en" />);
    expect(pie).toContain('A 95 95');
    expect(pie).not.toMatch(/NaN|Infinity/);
    expect(pie).toContain(block.categories[0]!.label);
  });
});
