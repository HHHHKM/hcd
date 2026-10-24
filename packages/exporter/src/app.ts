import Fastify from 'fastify';
import type { Browser } from 'playwright';
export type PdfRenderer = (html: string, signal: AbortSignal) => Promise<Buffer>;
/** Browser is supplied by the isolated service entrypoint; tests never launch one. */
export function chromiumRenderer(browser: Browser): PdfRenderer {
  return async (html, signal) => {
    signal.throwIfAborted();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true, serviceWorkers: 'block', acceptDownloads: false });
    const abort = () => { void context.close().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await context.route('**/*', (route) => route.abort('blockedbyclient'));
      const page = await context.newPage(); page.setDefaultTimeout(55000);
      await page.setContent(html, { waitUntil: 'load', timeout: 55000 });
      await page.emulateMedia({ media: 'print', colorScheme: 'light' });
      signal.throwIfAborted();
      return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: false, margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' } });
    } finally { signal.removeEventListener('abort', abort); await context.close().catch(() => {}); }
  };
}
export function createExporter(render: PdfRenderer, timeoutMs = 60000) {
  const app = Fastify({ logger: false, bodyLimit: 80 * 1024 * 1024 }); let busy = false;
  app.addContentTypeParser('text/html', { parseAs: 'string' }, (_request, body, done) => done(null, body));
  app.get('/healthz', async () => ({ ok: true }));
  app.post('/pdf', async (request, reply) => {
    if (typeof request.body !== 'string' || !request.body.trim()) return reply.code(400).send({ error: { code: 'HTML_REQUIRED' } });
    if (busy) return reply.code(429).header('Retry-After', '2').send({ error: { code: 'EXPORTER_BUSY' } });
    busy = true; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const rendering = Promise.resolve().then(() => render(request.body as string, controller.signal)).finally(() => { busy = false; });
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); timer.unref(); });
    try {
      const bytes = await Promise.race([rendering, timeout]);
      if (bytes.length > 50 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return reply.code(502).send({ error: { code: 'PDF_INVALID' } });
      return reply.type('application/pdf').header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').send(bytes);
    } catch { return reply.code(controller.signal.aborted ? 504 : 500).send({ error: { code: controller.signal.aborted ? 'PDF_TIMEOUT' : 'PDF_FAILED' } }); }
    finally { if (timer) clearTimeout(timer); }
  });
  return app;
}
