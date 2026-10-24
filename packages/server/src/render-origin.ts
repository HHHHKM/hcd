import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { rawCsp } from './raw';

export type RenderKind = 'a' | 'raw' | 'x';
export function createRenderSigner(secret: string, origin: string) {
  const key = Buffer.from(hkdfSync('sha256', secret, '', 'hcd-url-v1', 32));
  const signature = (kind: string, asset: string, expires: number, context: string) => createHmac('sha256', key).update(`${kind}:${asset}:${expires}:${context}`).digest('base64url');
  return {
    url(kind: RenderKind, asset: string, context: string, now = Date.now()) { const expires = Math.floor(now / 1000) + 300; return `${origin}/r/${kind}/${encodeURIComponent(asset)}?e=${expires}&c=${encodeURIComponent(context)}&s=${signature(kind, asset, expires, context)}`; },
    verify(kind: string, asset: string, expires: string, context: string, provided: string, now = Date.now()) {
      if (!/^[0-9]{10,13}$/.test(expires) || !/^(?:u_|sl_|gs_|tok_)[a-zA-Z0-9_-]{1,80}$/.test(context) || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return false;
      const expiration = Number(expires); if (expiration <= Math.floor(now / 1000) || expiration > Math.floor(now / 1000) + 300) return false;
      const expected = signature(kind, asset, expiration, context); return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    },
  };
}
export function registerRenderOrigin(app: FastifyInstance, config: {
  appUrl: string; renderUrl?: string; secret: string;
  read: (assetId: string, kind: RenderKind, context: string) => Promise<{ bytes: Buffer; mime: string; filename?: string } | null>;
}) {
  const appOrigin = new URL(config.appUrl); const render = config.renderUrl ? new URL(config.renderUrl) : null;
  if (render && (render.hostname.replace(/\.$/, '') === appOrigin.hostname.replace(/\.$/, '') || !['https:', 'http:'].includes(render.protocol) || render.username || render.password || render.pathname !== '/' || render.search || render.hash)) throw new Error('RENDER_URL must be a distinct hostname origin');
  if (render && appOrigin.protocol === 'https:' && render.protocol !== 'https:') throw new Error('HTTPS applications require HTTPS RENDER_URL');
  const signer = render ? createRenderSigner(config.secret, render.origin) : null;
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    let hostname = ''; try { hostname = new URL(`http://${request.headers.host ?? ''}`).hostname; } catch { /* Invalid hosts are rejected below. */ }
    const rendering = render && hostname === render.hostname;
    if (appOrigin.protocol === 'https:' && hostname !== appOrigin.hostname && !rendering && !(path === '/healthz' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    reply.header('X-Content-Type-Options', 'nosniff').header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if ((rendering && !path.startsWith('/r/')) || (!rendering && path.startsWith('/r/'))) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (rendering) { reply.header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store'); return; }
    if (appOrigin.protocol === 'https:') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const renderSource = render?.origin ?? "'none'";
    reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${render ? ` ${render.origin}` : ''}; frame-src ${renderSource}; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  });
  app.get('/r/:kind/:assetId', async (request, reply) => {
    const { kind, assetId } = request.params as { kind: string; assetId: string };
    const { e, c, s } = request.query as Record<string, string | undefined>;
    if (!signer || !['a', 'raw', 'x'].includes(kind) || !(kind === 'x' ? /^ex_[a-z2-7]{12}$/ : /^as_[a-z2-7]{12}$/).test(assetId) || !signer.verify(kind, assetId, e ?? '', c ?? '', s ?? '')) return reply.code(403).send({ error: { code: 'SIGNATURE_INVALID' } });
    const asset = await config.read(assetId, kind as RenderKind, c!);
    if (!asset) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (kind === 'x') reply.header('Content-Disposition', `attachment; filename="${(asset.filename ?? 'download').replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
    return reply.type(asset.mime).header('Content-Security-Policy', kind === 'raw' ? rawCsp : "default-src 'none'; style-src 'none'; sandbox").send(asset.bytes);
  });
  return signer;
}
