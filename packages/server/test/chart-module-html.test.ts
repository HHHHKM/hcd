import { describe, expect, it } from 'vitest';
import { createCounterIdSource, type Block, type ChartBlock, type Document, type Module } from '../../core/src/model';
import { serializeModule } from '../../core/src/spec-html';
import { createApp } from '../src/app';
import { openDatabase } from '../src/db';
import { materializeSubmission, parseSubmissionInput } from '../src/submission-input';

const chart: ChartBlock = {
  id: 'n_bbbbbbbb', type: 'chart', kind: 'bar', title: 'Revenue', unit: 'USD',
  categories: [{ id: 'n_cccccccc', label: 'Q1' }, { id: 'n_dddddddd', label: 'Q2' }],
  series: [{ id: 'n_eeeeeeee', name: 'Actual', values: { n_cccccccc: 0, n_dddddddd: 25 } }],
};
const base: Document = {
  schemaVersion: 1, id: 'd_aaaaaaab', title: 'Chart document', theme: { id: 'default', version: 1, overrides: {} },
  modules: [{ id: 'm_aaaaaaaa', title: 'Chart module', blocks: [chart] }],
};
const changedModule = (): Module => {
  const module = structuredClone(base.modules[0]!); const next = module.blocks[0] as ChartBlock;
  next.title = 'Updated revenue'; next.kind = 'line'; next.series[0]!.values.n_dddddddd = 30;
  return module;
};
const materialize = (html: string, document = base) => materializeSubmission(document, parseSubmissionInput({ baseVersion: 1, moduleHtml: [{ moduleId: document.modules[0]!.id, html }] }), createCounterIdSource());
const payloadMarkup = (html: string) => html.match(/<script type="application\/hcd\+json">[\s\S]*?<\/script>/)![0];
const replacePayload = (html: string, payload: unknown) => html.replace(payloadMarkup(html), `<script type="application/hcd+json">${JSON.stringify(payload)}</script>`);
const payloadValue = (html: string) => JSON.parse(payloadMarkup(html).replace(/^<script[^>]*>|<\/script>$/g, ''));

describe('inert chart data in module HTML submissions', () => {
  it('accepts serializer output and preserves chart IDs, zero values and edits', () => {
    const module = changedModule(); const result = materialize(serializeModule(module));
    expect(result.content).toEqual({ ...base, modules: [module] });
    expect(result.uncertain).toEqual([]); expect(result.idMap).toEqual({});
    expect(result.ops).toContainEqual(expect.objectContaining({ op: 'set', at: { id: chart.series[0]!.id, field: 'value:n_dddddddd' }, before: 25, after: 30 }));
  });

  it.each(['columns', 'cards'] as const)('accepts charts in serialized %s blocks', kind => {
    const nested: Block = kind === 'columns'
      ? { id: 'n_ffffffff', type: 'columns', ratio: '1:1', cols: [{ id: 'n_gggggggg', blocks: [structuredClone(chart)] }, { id: 'n_hhhhhhhh', blocks: [] }] }
      : { id: 'n_ffffffff', type: 'cards', perRow: 2, items: [{ id: 'n_gggggggg', title: 'First', blocks: [structuredClone(chart)] }, { id: 'n_hhhhhhhh', title: 'Second', blocks: [] }] };
    const source = structuredClone(base); source.modules[0]!.blocks = [nested];
    const updated = structuredClone(source.modules[0]!); const container = updated.blocks[0]!;
    const child = container.type === 'columns' ? container.cols[0]!.blocks[0] : container.type === 'cards' ? container.items[0]!.blocks[0] : undefined;
    if (child?.type !== 'chart') throw new Error('Invalid fixture'); child.series[0]!.name = 'Forecast';
    expect(materialize(serializeModule(updated), source).content.modules[0]).toEqual(updated);
  });

  it('allocates identities for a new chart and keeps escaped script-looking labels as text', () => {
    const source = { ...base, modules: [] }; const module = changedModule();
    (module.blocks[0] as ChartBlock).title = '</script><script>alert("text only")</script>&';
    const html = serializeModule(module); expect(html).toContain('\\u003c/script\\u003e');
    const result = materializeSubmission(source, parseSubmissionInput({ baseVersion: 1, moduleHtml: [{ html }] }), createCounterIdSource());
    const actual = result.content.modules[0]!.blocks[0] as ChartBlock;
    expect(actual.title).toBe((module.blocks[0] as ChartBlock).title); expect(actual.series[0]!.values[actual.categories[0]!.id]).toBe(0);
    expect(Object.keys(result.idMap)).toHaveLength(5); expect(result.ops[0]!.op).toBe('insert');
  });

  it('rejects executable scripts, extra script attributes and payloads outside recognized chart positions', () => {
    const html = serializeModule(changedModule()); const script = payloadMarkup(html);
    const bad = [
      html.replace('type="application/hcd+json"', 'type="text/javascript"'),
      html.replace('type="application/hcd+json"', 'type="module"'),
      html.replace('type="application/hcd+json"', 'type="application/hcd+json" src="https://evil.test/run.js"'),
      html.replace('type="application/hcd+json"', 'type="application/hcd+json" onload="alert(1)"'),
      html.replace('type="application/hcd+json"', 'type="application/hcd+json" type="text/javascript"'),
      html.replace('<figure ', '<figure onclick="alert(1)" '),
      html.replace(script, `<div>${script}</div>`),
      html.replace(/<figure[^>]*>/, '').replace('</figure>', ''),
      html.replace(/(<figure[\s\S]*?<\/figure>)/, '<div>$1</div>'),
      html.replace('Updated revenue', '</script><script>alert(1)</script>'),
      html.replace('</section>', '<script>alert(1)</script></section>'),
    ];
    for (const value of bad) expect(() => materialize(value)).toThrow('UNSUPPORTED_MODULE_HTML');
  });

  it('rejects duplicate payloads and ignored siblings rather than silently choosing the first', () => {
    const html = serializeModule(changedModule()); const script = payloadMarkup(html);
    const different = script.replace('Updated revenue', 'Hidden second payload');
    for (const replacement of [script + script, script + different, `${script}<p>Hidden text</p>`, `ignored ${script}`]) {
      expect(() => materialize(html.replace(script, replacement))).toThrow('UNSUPPORTED_MODULE_HTML');
    }
  });

  it('rejects malformed JSON, unknown fields and mismatched category values without coercion or truncation', () => {
    const html = serializeModule(changedModule()); const payload = payloadValue(html);
    const bad: unknown[] = [
      { ...payload, title: { html: 'not a string' } },
      { ...payload, script: 'alert(1)' },
      { ...payload, categories: [{ ...payload.categories[0], onclick: 'alert(1)' }] },
      { ...payload, series: [{ ...payload.series[0], values: [1, 2, 3] }] },
      { ...payload, series: [{ ...payload.series[0], values: [1] }] },
      { ...payload, series: [{ ...payload.series[0], values: ['1', 2] }] },
      { ...payload, series: [{ ...payload.series[0], values: [1, { value: 2 }] }] },
      null, [],
    ];
    for (const value of bad) expect(() => materialize(replacePayload(html, value))).toThrow('MODULE_HTML_INVALID');
    expect(() => materialize(html.replace(payloadMarkup(html), '<script type="application/hcd+json">{bad}</script>'))).toThrow('MODULE_HTML_INVALID');
    expect(() => materialize(html.replace('data-kind="line"', 'data-kind="executable"'))).toThrow('UNSUPPORTED_MODULE_HTML');
  });

  it('accepts chart changes through the API with exact retries and rejects malicious variants atomically', async () => {
    const db = openDatabase(':memory:'); const origin = 'http://localhost:5173';
    const app = createApp({ db, secretKey: 'chart-module-test', appUrl: origin, renderUrl: 'https://render.test', exports: { autoStart: false }, seed: true });
    try {
      await app.ready();
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(base), base.id);
      const html = serializeModule(changedModule()); const payload = { baseVersion: 1, moduleHtml: [{ moduleId: base.modules[0]!.id, html }] };
      const request = (body: unknown, key: string) => app.inject({ method: 'POST', url: `/api/v1/docs/${base.id}/submissions`, headers: { cookie, origin, 'x-hcd-request': '1', 'idempotency-key': key }, payload: body as Record<string, unknown> });
      const first = await request(payload, 'chart-retry'); expect(first.statusCode, first.body).toBe(201);
      const retry = await request(payload, 'chart-retry'); expect(retry.statusCode).toBe(200); expect(retry.json()).toEqual(first.json());
      const count = db.prepare('SELECT count(*) count FROM submissions').get();
      const invalid = await request({ ...payload, moduleHtml: [{ html: html.replace('type="application/hcd+json"', 'src="https://evil.test/" type="application/hcd+json"') }] }, 'chart-malicious');
      expect(invalid.statusCode).toBe(400); expect(invalid.json().error.code).toBe('UNSUPPORTED_MODULE_HTML');
      expect(db.prepare('SELECT count(*) count FROM submissions').get()).toEqual(count);
    } finally { await app.close(); db.close(); }
  });
});
