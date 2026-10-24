import { validateStartupEnvironment } from './startup';
import { configuredMailDelivery } from './outbox';
import { createApp } from './app';
import { registerMcpRoutes } from './mcp';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

validateStartupEnvironment(process.env);

const app = createApp({
  mailDelivery: configuredMailDelivery(),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  renderUrl: process.env.RENDER_URL ?? (process.env.NODE_ENV === 'development' ? 'http://render.localhost:3000' : undefined),
  seed: process.env.NODE_ENV === 'development' || process.env.HCD_SEED_DEMO === '1',
});
registerMcpRoutes(app, { appUrl: process.env.APP_URL ?? 'http://localhost:5173' });

const webRoot = resolve(process.env.WEB_ROOT ?? './dist');
if (existsSync(resolve(webRoot, 'index.html'))) {
  await app.register(fastifyStatic, { root: webRoot, prefix: '/', wildcard: false, decorateReply: true });
}
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
  if (existsSync(resolve(webRoot, 'index.html')) && request.headers.accept?.includes('text/html')) return reply.type('text/html').sendFile('index.html');
  return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
});

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
process.stdout.write(`HCD server listening on port ${process.env.PORT ?? 3000}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { app.close().then(() => process.exit(0)).catch(() => process.exit(1)); });
}
