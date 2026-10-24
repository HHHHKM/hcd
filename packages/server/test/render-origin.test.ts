import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { createRenderSigner } from '../src/render-origin';
import { sanitizeRawHtml } from '../src/raw';
import { parse } from 'parse5';
import type { Document } from '../../core/src/model';

const headers = (cookie = '') => ({ cookie, host: 'app.test', origin: 'https://app.test', 'x-hcd-request': '1' });
const hostile = '<h1>Static illustration</h1><style>.shape{fill:red}body{background:url(https://external.test/a)}</style><svg viewBox="0 0 100 100" onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://app.test"></iframe></foreignObject><a href="javascript:alert(1)"><set attributeName="href" to="https://app.test"/><rect class="shape" width="80" height="80"/></a><text>Visible illustration</text></svg>';

describe('isolated raw rendering', () => {
  let app: FastifyInstance; let dataDir: string; let owner: string;
  beforeEach(async () => { dataDir = mkdtempSync(join(tmpdir(), 'hcd-render-')); app = createApp({ databasePath: ':memory:', dataDir, seed: true, appUrl: 'https://app.test', renderUrl: 'https://render.test' }); await app.ready(); const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } }); expect(login.statusCode).toBe(200); owner = String(login.headers['set-cookie']).split(';')[0]!; expect(login.headers['set-cookie']).not.toMatch(/Domain=/i); });
  afterEach(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function imported() {
    const pending = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'diagram.html', html: hostile } }); expect(pending.statusCode, pending.body).toBe(201);
    const content = pending.json().import.content as Document; const raw = content.modules.flatMap((module) => module.blocks).find((block) => block.type === 'raw')!; expect(raw).toBeTruthy();
    return { importId: pending.json().import.id as string, content, raw };
  }
  async function render(url: string, host = 'render.test') { const parsed = new URL(url); return app.inject({ method: 'GET', url: parsed.pathname + parsed.search, headers: { host } }); }
  it('AT-09 preserves static source privately and keeps raw HTML off the application origin', async () => {
    const { importId, content, raw } = await imported();
    const previewUrl = await app.inject({ method: 'GET', url: `/api/v1/imports/${importId}/assets/${raw.asset}/url`, headers: headers(owner) }); expect(previewUrl.statusCode).toBe(200);
    const preview = await render(previewUrl.json().url); expect(preview.statusCode, preview.body).toBe(200); expect(preview.body).toContain('Visible illustration'); expect(preview.body).not.toMatch(/<script|onload|foreignObject|<set|javascript:/i); expect(preview.headers['content-security-policy']).toContain("script-src 'none'"); expect(preview.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/api/v1/imports/${importId}/assets/${raw.asset}`, headers: headers(owner) })).statusCode).toBe(404);
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/imports/${importId}/confirm`, headers: headers(owner), payload: {} }); expect(confirmed.statusCode).toBe(201);
    const result = await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/assets/${raw.asset}/url`, headers: headers(owner) }); expect(result.statusCode).toBe(200);
    const response = await render(result.json().url); expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect((await render(result.json().url, 'app.test')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs', headers: { host: 'unknown.test', cookie: owner } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/assets/${raw.asset}`, headers: headers(owner) })).statusCode).toBe(404);
    for (const path of ['/', '/healthz', '/api/v1/docs', '/mcp', '/s/example']) expect((await app.inject({ method: 'GET', url: path, headers: { host: 'render.test', cookie: owner } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: new URL(result.json().url).pathname + new URL(result.json().url).search, headers: { ...headers(owner), 'x-forwarded-host': 'render.test' } })).statusCode).toBe(404);
    const exported = await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/export?format=html`, headers: headers(owner) }); expect(exported.statusCode).toBe(200); expect(exported.body).toContain('sandbox=""'); expect(exported.body).toContain('Visible illustration'); expect(exported.body).toContain('Content-Security-Policy'); expect(exported.body).not.toContain('allow-same-origin');
    const tree = parse(exported.body); const nodes: unknown[] = [tree]; let iframes = 0;
    while (nodes.length) { const node = nodes.pop() as { tagName?: string; childNodes?: unknown[]; attrs?: Array<{ name: string; value: string }> }; if (node.tagName === 'iframe') { iframes++; expect(node.attrs?.find((attr) => attr.name === 'sandbox')?.value).toBe(''); } nodes.push(...node.childNodes ?? []); }
    expect(iframes).toBe(1);
  });
  it('AT-09 rechecks share revocation at render time and round-trips raw assets through ZIP', async () => {
    const { importId, content, raw } = await imported(); await app.inject({ method: 'POST', url: `/api/v1/imports/${importId}/confirm`, headers: headers(owner), payload: {} });
    const link = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/share-links`, headers: headers(owner), payload: { role: 'viewer' } }); expect(link.statusCode).toBe(201);
    const token = new URL(link.json().link.url).pathname.split('/').at(-1)!;
    const url = await app.inject({ method: 'GET', url: `/api/v1/s/${token}/assets/${raw.asset}/url`, headers: { host: 'app.test' } }); expect(url.statusCode).toBe(200);
    expect((await render(url.json().url)).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/v1/docs/${content.id}/share-links/${link.json().link.id}`, headers: headers(owner) });
    expect((await render(url.json().url)).statusCode).toBe(404);
    const zip = await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/export?format=zip`, headers: headers(owner) }); expect(zip.statusCode).toBe(200);
    const restored = await app.inject({ method: 'POST', url: '/api/v1/imports/archive', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'raw.zip', archiveBase64: zip.rawPayload.toString('base64') } }); expect(restored.statusCode, restored.body).toBe(201);
    const block = restored.json().import.content.modules.flatMap((module: { blocks: unknown[] }) => module.blocks).find((block: { type: string }) => block.type === 'raw'); expect(block.asset).not.toBe(raw.asset); expect(block.allowScripts).toBe(false);
    const modified = structuredClone(content); const changed = modified.modules.flatMap((module) => module.blocks).find((block) => block.type === 'raw')!; changed.allowScripts = true;
    const draft = await app.inject({ method: 'PUT', url: `/api/v1/docs/${content.id}/draft`, headers: headers(owner), payload: { baseVersion: 1, content: modified } }); expect(draft.json().error.code).toBe('RAW_SCRIPTS_UNAVAILABLE');
  });
  it('AT-09 denies discarded preview URLs and makes malformed signatures fail closed', async () => {
    const { importId, raw } = await imported(); const response = await app.inject({ method: 'GET', url: `/api/v1/imports/${importId}/assets/${raw.asset}/url`, headers: headers(owner) }); const url = response.json().url as string;
    const bad = new URL(url); bad.searchParams.set('e', '9999999999'); expect((await render(bad.href)).statusCode).toBe(403);
    bad.searchParams.set('e', '1'); expect((await render(bad.href)).statusCode).toBe(403);
    const swapped = new URL(url); swapped.pathname = swapped.pathname.replace('/raw/', '/a/'); expect((await render(swapped.href)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/imports/${importId}/discard`, headers: headers(owner), payload: {} })).statusCode).toBe(204);
    expect((await render(url)).statusCode).toBe(404);
  });
});

describe('static raw policy', () => {
  it('AT-09 rejects same-hostname and insecure render configurations', () => {
    for (const renderUrl of ['https://app.test:8443', 'https://app.test.', 'http://render.test']) expect(() => createApp({ databasePath: ':memory:', appUrl: 'https://app.test', renderUrl })).toThrow();
  });
  it('AT-09 binds signature to asset and authorization context and rejects expired URLs', () => {
    const signer = createRenderSigner('test-secret', 'https://render.test'); const now = 1792700000000;
    const url = new URL(signer.url('raw', 'as_aaaaaaaaaaaa', 'u_owner000000', now)); const e = url.searchParams.get('e')!; const c = url.searchParams.get('c')!; const s = url.searchParams.get('s')!;
    expect(signer.verify('raw', 'as_aaaaaaaaaaaa', e, c, s, now)).toBe(true);
    expect(signer.verify('raw', 'as_bbbbbbbbbbbb', e, c, s, now)).toBe(false);
    expect(signer.verify('raw', 'as_aaaaaaaaaaaa', e, 'u_editor00000', s, now)).toBe(false);
    expect(signer.verify('raw', 'as_aaaaaaaaaaaa', e, c, s, now + 300000)).toBe(false);
  });
  it('AT-09 removes active navigation, namespace attributes and script mutation vectors', () => {
    const source = '<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><svg><a xlink:href="&#106;avascript:alert(1)"><animate attributeName="href" values="https://evil.test"/></a><foreignObject><form action="https://evil.test"><button>Send</button></form></foreignObject></svg><p onclick="x()">Quoted \' &quot; &lt;/iframe&gt;</p>';
    const cleaned = sanitizeRawHtml(source); expect(cleaned).not.toMatch(/refresh|<base|javascript|animate|foreignObject|<form|onclick|evil\.test/i); expect(cleaned).toContain('Content-Security-Policy'); expect(cleaned).toContain('Quoted');
    expect(sanitizeRawHtml(cleaned)).toBe(cleaned);
  });
});
