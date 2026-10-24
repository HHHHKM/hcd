import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { FastifyInstance } from 'fastify';
import type { Document } from '../../core/src/model';
import { createCounterIdSource } from '../../core/src/model';
import { blockTypes, createBlock } from '../../web/src/editor-model';

const origin = 'http://localhost:5173';
const headers = (cookie: string) => ({ cookie, origin, 'x-hcd-request': '1' });

describe('preserved imports and structured draft publication', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    app = createApp({ databasePath: ':memory:', seed: true, appUrl: origin });
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(''), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
  });
  afterEach(async () => { await app.close(); });

  async function imported(html: string) {
    const prepared = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(cookie), payload: { spaceId: 'sp_demo000000', filename: '../unsafe"\r\n.html', html } });
    expect(prepared.statusCode).toBe(201);
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/imports/${prepared.json().import.id}/confirm`, headers: headers(cookie), payload: {} });
    expect(confirmed.statusCode).toBe(201);
    return confirmed.json() as { doc: { id: string }; content: Document };
  }
  async function token(docIds: string[]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(cookie), payload: { name: 'reports', scopes: ['read'], docIds } });
    expect(response.statusCode).toBe(201);
    return { authorization: `Bearer ${response.json().token}` };
  }

  it('returns the exact preserved HTML only as a non-renderable attachment', async () => {
    const source = '\ufeff<!doctype html>\r\n<h1>原文</h1><p>Content</p><script>/*private-sentinel*/alert(1)</script>  \r\n';
    const { doc } = await imported(source);
    const result = await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/source`, headers: { cookie } });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(source);
    expect(result.headers['content-type']).toContain('application/octet-stream');
    expect(result.headers['content-disposition']).toBe(`attachment; filename="${doc.id}-original.html"`);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-security-policy']).toContain('sandbox');
    const report = await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/import-report`, headers: { cookie } });
    expect(report.statusCode).toBe(200);
    expect(report.json().report.removed).toBeGreaterThan(0);
    expect(report.body).not.toContain('private-sentinel');
    expect(report.body).not.toContain('source_html');
  });

  it('AT-11 applies document authorization and scopes while denying every PAT access to raw ' +
     'originals', async () => {
    const { doc } = await imported('<p>Access controlled source</p>');
    const allowed = await token([doc.id]);
    const excluded = await token(['d_aaaaaaab']);
    for (const route of ['source', 'import-report']) {
      expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/${route}` })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: `/api/v1/docs/d_zzzzzzzz/${route}`, headers: { cookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/v1/docs/d_aaaaaaab/${route}`, headers: { cookie } })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/source`, headers: allowed })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/import-report`, headers: allowed })).json().error.code).toBe('AI_DISABLED');
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/docs/${doc.id}`, headers: headers(cookie), payload: { aiEnabled: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/import-report`, headers: allowed })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/import-report`, headers: excluded })).statusCode).toBe(404);
  });

  it('saves every editable block, publishes through review, and leaves the original and v1 unchanged', async () => {
    const source = '<h1>Original</h1><p>Keep this source forever</p>';
    const { doc, content } = await imported(source);
    const draft = structuredClone(content);
    const ids = createCounterIdSource();
    draft.modules[0]!.blocks = blockTypes.map((type) => createBlock(type, ids, 'en'));
    draft.title = 'Edited title';
    const save = await app.inject({ method: 'PUT', url: `/api/v1/docs/${doc.id}/draft`, headers: headers(cookie), payload: { baseVersion: 1, content: draft } });
    expect(save.statusCode).toBe(200);
    const submission = await app.inject({ method: 'POST', url: `/api/v1/docs/${doc.id}/submissions`, headers: { ...headers(cookie), 'idempotency-key': 'all-block-edit' }, payload: { baseVersion: 1, content: draft } });
    expect(submission.statusCode).toBe(201);
    const preview = await app.inject({ method: 'POST', url: `/api/v1/docs/${doc.id}/previews`, headers: headers(cookie), payload: { submissionIds: [submission.json().submission.id] } });
    expect(preview.statusCode).toBe(200);
    const published = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(cookie), payload: { revision: preview.json().preview.revision } });
    expect(published.statusCode).toBe(200);
    expect(published.json().version.content.modules[0].blocks.map((block: { type: string }) => block.type)).toEqual(blockTypes);
    expect(published.json().version.content.title).toBe('Edited title');
    const old = await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/versions/1`, headers: { cookie } });
    expect(old.json().version.content).toEqual(content);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/source`, headers: { cookie } })).body).toBe(source);
  });

  it('rejects nonexistent draft base versions and deletes discarded drafts', async () => {
    const { doc, content } = await imported('<p>Draft</p>');
    for (const baseVersion of [0, -1, 1.5, 2]) {
      const bad = await app.inject({ method: 'PUT', url: `/api/v1/docs/${doc.id}/draft`, headers: headers(cookie), payload: { baseVersion, content } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('INVALID_BASE_VERSION');
    }
    expect((await app.inject({ method: 'PUT', url: `/api/v1/docs/${doc.id}/draft`, headers: headers(cookie), payload: { baseVersion: 1, content } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/docs/${doc.id}/draft`, headers: headers(cookie) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/draft`, headers: { cookie } })).json().draft).toBeNull();
  });

  it('AT-43 recognizes metric and timeline groups in ordinary HTML and reports excessive nesting', async () => {
    const source = '<h1>Launch</h1><div><article><span>Users</span><b>12k</b><em>+8%</em></article><article><span>Churn</span><b>2%</b><em>-1%</em></article></div><ol><li><span>Q1</span><strong>Design</strong><p>Research</p></li><li><span>Q2</span><strong>Launch</strong><p>Release</p></li></ol><pre>a &lt; b\n  c</pre><figure><img src="https://example.com/image.png" alt="External"><figcaption>Preserved caption</figcaption></figure>';
    const { doc, content } = await imported(source);
    const blocks = content.modules.flatMap((module) => module.blocks);
    expect(blocks.map((block) => block.type)).toEqual(['kpis', 'timeline', 'paragraph', 'image']);
    expect(blocks[0]).toMatchObject({ items: [{ label: 'Users', value: '12k', delta: '+8%', tone: 'good' }, { label: 'Churn', value: '2%', delta: '-1%', tone: 'bad' }] });
    expect(blocks[2]).toMatchObject({ text: [{ t: 'a < b', code: true }, { br: true }, { t: '  c', code: true }] });
    expect(blocks[3]).toMatchObject({ asset: null, alt: 'External', caption: 'Preserved caption' });
    const report = await app.inject({ method: 'GET', url: `/api/v1/docs/${doc.id}/import-report`, headers: { cookie } });
    expect(report.json().report.recognized).toEqual({ kpis: 1, timelines: 1 });
    const deep = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(cookie), payload: { spaceId: 'sp_demo000000', filename: 'deep.html', html: '<div>'.repeat(70) + 'deep' + '</div>'.repeat(70) } });
    expect(deep.statusCode).toBe(422); expect(deep.json().error.code).toBe('IMPORT_TOO_COMPLEX');
  });
});
