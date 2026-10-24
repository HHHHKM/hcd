import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Document } from '../../core/src/model';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const docId = 'd_aaaaaaab';
const origin = 'http://performance.test';
function largeDocument(): Document {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const id = (n: number) => 'n_' + Array.from({ length: 8 }, (_, index) => alphabet[Math.floor(n / 32 ** index) % 32]).join('');
  return { schemaVersion: 1, id: docId, title: '5000 paragraphs', theme: { id: 'default', version: 1, overrides: {} }, modules: [{ id: 'm_aaaaaaaa', title: 'Large section', blocks: Array.from({ length: 5000 }, (_, index) => ({ id: id(index), type: 'paragraph', text: [{ t: `Paragraph ${index}: ${'Measured local content. '.repeat(12)}` }] })) }] };
}

describe('historical comparison performance', () => {
  let dataDir: string; let db: HcdDatabase; let app: FastifyInstance; let cookie: string;
  const headers = () => ({ cookie, origin, 'x-hcd-request': '1' });
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hcd-history-performance-'));
    db = openDatabase(join(dataDir, 'hcd.sqlite'));
    app = createApp({ db, dataDir, seed: true, appUrl: origin, exports: { autoStart: false } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
  });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

  it('B4 keeps health responsive during 5000-paragraph comparison and caches its immutable result', async () => {
    const before = largeDocument(); const after = structuredClone(before); after.modules[0]!.blocks = [];
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(before), docId);
    db.prepare("INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,2,'publish',?,'u_owner000000',?)").run(docId, JSON.stringify(after), new Date().toISOString());
    let finished = false;
    const started = performance.now();
    const comparison = app.inject({ url: `/api/v1/docs/${docId}/compare?from=1&to=2`, headers: headers() }).then(response => { finished = true; return response; });
    const health = await new Promise<{ statusCode: number; elapsedMs: number; comparisonFinished: boolean }>(resolve => {
      setTimeout(() => { void app.inject({ url: '/healthz' }).then(response => resolve({ statusCode: response.statusCode, elapsedMs: performance.now() - started, comparisonFinished: finished })); }, 10);
    });
    const first = await comparison;
    const firstMs = performance.now() - started;
    const cachedAt = performance.now();
    const second = await app.inject({ url: `/api/v1/docs/${docId}/compare?from=1&to=2`, headers: headers() });
    const cachedMs = performance.now() - cachedAt;
    const measurements = { paragraphCount: 5000, sampleBytes: Buffer.byteLength(JSON.stringify(before)), healthMs: health.elapsedMs, healthWhileComparisonRunning: !health.comparisonFinished, firstCompareMs: firstMs, cachedCompareMs: cachedMs, changes: first.json().changeSet.changes.length };
    if (process.env.B4_BENCHMARK_PATH) writeFileSync(process.env.B4_BENCHMARK_PATH, JSON.stringify(measurements, null, 2) + '\n');
    expect(first.statusCode, first.body.slice(0, 500)).toBe(200);
    expect(measurements.changes).toBe(5000);
    expect(second.body).toBe(first.body);
    expect(health.statusCode).toBe(200);
    expect(health.comparisonFinished).toBe(false);
    expect(health.elapsedMs).toBeLessThan(100);
    expect(cachedMs).toBeLessThan(50);
  }, 20_000);

  it('B4 keeps health responsive while preparing a large restore review presentation', async () => {
    const current = largeDocument(); const target = structuredClone(current); target.modules[0]!.blocks = [];
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(target), docId);
    db.prepare("INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,2,'publish',?,'u_owner000000',?)").run(docId, JSON.stringify(current), new Date().toISOString());
    db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    let finished = false;
    const started = performance.now();
    const pending = app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/restore`, headers: headers(), payload: { version: 1 } }).then(response => { finished = true; return response; });
    const health = await new Promise<{ elapsedMs: number; finished: boolean }>(resolve => {
      setTimeout(() => { void app.inject({ url: '/healthz' }).then(() => resolve({ elapsedMs: performance.now() - started, finished })); }, 10);
    });
    const response = await pending;
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    expect(response.json().preview.presentation.candidate.changes).toHaveLength(5000);
    expect(health.finished).toBe(false);
    expect(health.elapsedMs).toBeLessThan(100);
  }, 20_000);

  it.each(['compare', 'restore'] as const)('B4 rechecks document access after the %s worker finishes', async (kind) => {
    const current = largeDocument(); const target = structuredClone(current); target.modules[0]!.blocks = [];
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(target), docId);
    db.prepare("INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,2,'publish',?,'u_owner000000',?)").run(docId, JSON.stringify(current), new Date().toISOString());
    db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    const pending = kind === 'compare'
      ? app.inject({ url: `/api/v1/docs/${docId}/compare?from=2&to=1`, headers: headers() }).then(response => response)
      : app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/restore`, headers: headers(), payload: { version: 1 } }).then(response => response);
    await new Promise<void>(resolve => setTimeout(() => {
      db.prepare("DELETE FROM document_members WHERE doc_id=? AND user_id='u_owner000000'").run(docId);
      db.prepare("DELETE FROM space_members WHERE user_id='u_owner000000'").run();
      resolve();
    }, 10));
    const response = await pending;
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('Measured local content');
  }, 20_000);

  it.each(['compare', 'restore', 'prepare', 'save'] as const)('B4 rejects a revoked session after the %s worker finishes', async (kind) => {
    const current = largeDocument(); const target = structuredClone(current); target.modules[0]!.blocks = [];
    db.prepare('UPDATE versions SET content=? WHERE doc_id=? AND version=1').run(JSON.stringify(target), docId);
    db.prepare("INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,2,'publish',?,'u_owner000000',?)").run(docId, JSON.stringify(current), new Date().toISOString());
    db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(docId);
    db.prepare("UPDATE submissions SET content=?,base_version=2 WHERE id='sub_demo0abc'").run(JSON.stringify(target));
    const pending = (kind === 'compare'
      ? app.inject({ url: `/api/v1/docs/${docId}/compare?from=2&to=1`, headers: headers() })
      : app.inject({ method: 'POST', url: `/api/v1/docs/${docId}/${kind === 'restore' ? 'restore' : kind === 'prepare' ? 'previews/prepare' : 'previews'}`, headers: headers(), payload: kind === 'restore' ? { version: 1 } : { submissionIds: ['sub_demo0abc'] } })).then(response => response);
    await new Promise<void>(resolve => setTimeout(() => {
      db.prepare("DELETE FROM sessions WHERE user_id='u_owner000000'").run();
      resolve();
    }, 10));
    const response = await pending;
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    expect(response.body).not.toContain('Measured local content');
  }, 20_000);

  it('B4 limits comparison to ten requests per user per minute independently of normal reads', async () => {
    for (let index = 0; index < 10; index++) {
      expect((await app.inject({ url: `/api/v1/docs/${docId}/compare?from=1&to=1`, headers: headers() })).statusCode).toBe(200);
    }
    const limited = await app.inject({ url: `/api/v1/docs/${docId}/compare?from=1&to=1`, headers: headers() });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({ url: '/api/v1/me', headers: headers() })).statusCode).toBe(200);
  });
});
