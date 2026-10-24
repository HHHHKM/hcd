import { describe, expect, it } from 'vitest';
import { createExporter } from './app';
const bytes = Buffer.from('%PDF-1.4\nfixture\n%%EOF');
describe('PDF service with an injected renderer', () => {
  it('AT-36 accepts HTML, returns binary PDF, rejects empty input and isolates renderer failures', async () => {
    let fail = false; const seen: string[] = [];
    const app = createExporter(async (html) => { seen.push(html); if (fail) throw new Error('private render detail'); return bytes; });
    try {
      const result = await app.inject({ method: 'POST', url: '/pdf', headers: { 'content-type': 'text/html; charset=utf-8' }, payload: '<h1>Document</h1>' }); expect(result.statusCode).toBe(200); expect(result.rawPayload).toEqual(bytes); expect(result.headers['content-type']).toBe('application/pdf'); expect(seen).toEqual(['<h1>Document</h1>']);
      expect((await app.inject({ method: 'POST', url: '/pdf', headers: { 'content-type': 'text/html' }, payload: '' })).statusCode).toBe(400);
      fail = true; const failure = await app.inject({ method: 'POST', url: '/pdf', headers: { 'content-type': 'text/html' }, payload: 'html' }); expect(failure.statusCode).toBe(500); expect(failure.body).not.toContain('private render detail');
    } finally { await app.close(); }
  });
  it('AT-36 serializes rendering and aborts timed-out requests without opening another render slot ' +
     'early', async () => {
    let release!: () => void; let entered!: () => void; let signal!: AbortSignal;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
    const app = createExporter(async (_html, currentSignal) => { signal = currentSignal; entered(); await gate; return bytes; }, 30);
    try {
      const pending = app.inject({ method: 'POST', url: '/pdf', headers: { 'content-type': 'text/html' }, payload: 'html' }); await started;
      expect((await app.inject({ method: 'POST', url: '/pdf', headers: { 'content-type': 'text/html' }, payload: 'html' })).statusCode).toBe(429);
      expect((await pending).statusCode).toBe(504); expect(signal.aborted).toBe(true);
      expect((await app.inject({ method: 'POST', url: '/pdf', headers: { 'content-type': 'text/html' }, payload: 'html' })).statusCode).toBe(429);
      release();
    } finally { release(); await app.close(); }
  });
});
