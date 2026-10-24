import { describe, expect, it } from 'vitest';
import { renderDocumentHtml } from './index';
import type { Document } from '../../core/src/model';

const doc: Document = {
  schemaVersion: 1, id: 'd_aaaaaaaa', title: '<img src=x onerror=alert(1)>', theme: { id: 'default', version: 1, overrides: {} },
  modules: [{ id: 'm_aaaaaaaa', title: 'Overview', blocks: [
    { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: '<script>alert(1)</script>' }, { t: 'link', href: 'https://example.com' }] },
    { id: 'n_aaaaaaab', type: 'chart', kind: 'bar', title: 'Chart', unit: '%', categories: [{ id: 'n_aaaaaaac', label: 'A' }], series: [{ id: 'n_aaaaaaad', name: 'S', values: { n_aaaaaaac: 42 } }] },
    { id: 'n_aaaaaaae', type: 'timeline', items: [{ id: 'n_aaaaaaaf', label: 'Q1', title: 'Start', text: [{ t: 'First' }] }, { id: 'n_aaaaaaag', label: 'Q2', title: 'Next', text: [{ t: 'Second' }] }] },
    { id: 'n_aaaaaaah', type: 'kpis', items: [{ id: 'n_aaaaaaai', label: 'Users', value: '10', delta: '+2', tone: 'good' }] },
  ] }],
};

describe('renderDocumentHtml', () => {
  it('AT-09 escapes text and attribute content and emits safe external links', () => {
    const html = renderDocumentHtml(doc);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('<script>alert(1)</script>');
    const hostile = renderDocumentHtml({ ...doc, modules: [{ ...doc.modules[0]!, blocks: [
      { id: 'n_aaaaaaba', type: 'paragraph', text: [{ t: 'bad', href: 'javascript:alert(1)' }] },
      { id: 'n_aaaaaabb', type: 'image', asset: 'as_aaaaaaaaaaaa', alt: 'bad', caption: '', width: 'normal' },
    ] }] }, { assetUrl: () => 'javascript:alert(1)' });
    expect(hostile).not.toContain('href="javascript:');
    expect(hostile).not.toContain('src="javascript:');
  });

  it('AT-41 / AT-43 renders data blocks accessibly and keeps raw content sandboxed', () => {
    const html = renderDocumentHtml({ ...doc, modules: [{ ...doc.modules[0]!, blocks: [...doc.modules[0]!.blocks, { id: 'n_aaaaaaaj', type: 'raw', asset: 'as_aaaaaaaaaaaa', height: 260, allowScripts: true, note: 'embed' }] }] }, { rawSource: () => '<script>unsafe()</script>' });
    expect(html).toContain('role="img" aria-label="Chart"');
    expect(html).toContain('class="hcd-block hcd-timeline"');
    expect(html).toContain('class="hcd-block hcd-kpis"');
    expect(html).toContain('sandbox=""');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    const scriptsAllowed = renderDocumentHtml({ ...doc, modules: [{ ...doc.modules[0]!, blocks: [...doc.modules[0]!.blocks, { id: 'n_aaaaaaaj', type: 'raw', asset: 'as_aaaaaaaaaaaa', height: 260, allowScripts: true, note: 'embed' }] }] }, { rawSource: () => '', allowRawScripts: true });
    expect(scriptsAllowed).toContain('sandbox="allow-scripts"');
  });

  it('exports signed bars, line gaps, accessible source data, and full-circle pie values', () => {
    const chart: Extract<import('../../core/src/model').Block, { type: 'chart' }> = {
      id: 'n_aaaaaaab', type: 'chart', kind: 'bar', title: 'Revenue', unit: '$',
      categories: [{ id: 'n_aaaaaaac', label: '<Q1>' }, { id: 'n_aaaaaaae', label: 'Q2' }, { id: 'n_aaaaaaaf', label: 'Q3' }],
      series: [{ id: 'n_aaaaaaad', name: 'Actual', values: { n_aaaaaaac: -5, n_aaaaaaae: null, n_aaaaaaaf: 10 } }],
    };
    const exportChart = () => renderDocumentHtml({ ...doc, modules: [{ ...doc.modules[0]!, blocks: [chart] }] }, { locale: 'en' });
    const bars = exportChart();
    expect(bars).toContain('data-value="-5"'); expect(bars).toContain('data-value="10"'); expect(bars.match(/<rect /g)).toHaveLength(2);
    expect(bars).toContain('View data'); expect(bars).toContain('&lt;Q1&gt;'); expect(bars).toContain('—');
    chart.kind = 'line'; const line = exportChart();
    const path = /data-line="true" d="([^"]*)"/.exec(line)![1]!;
    expect(path.match(/M /g)).toHaveLength(2); expect(path).not.toContain('L ');
    chart.kind = 'pie'; const pie = exportChart();
    expect(pie).toContain('r="95"'); expect(pie).toContain('Negative values remain in the data table.'); expect(pie).not.toMatch(/NaN|Infinity/);
  });
});
