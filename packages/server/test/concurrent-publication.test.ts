import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Document } from '../../core/src/model';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const origin = 'http://hcd-concurrency.test';
const secretKey = 'hcd-concurrent-publication-test-secret';
const require = createRequire(import.meta.url);
type Preview = { id: string; revision: number; candidate: Document };
type WorkerMessage = { type: string; url?: string; status?: string; message?: string };
type Publisher = { worker: Worker; url: string };

// Each worker owns a real SQLite connection and an HTTP listener. The observer
// preserves every SQL statement/result; it only pauses before the publication
// transaction until both requests have observed and authorized the same baseline.
// A short transaction-read
// delay makes competing deferred transactions overlap reproducibly. An immediate
// transaction can serialize normally; the observer never waits for its peer
// while holding the write lock.
const workerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
require(workerData.loader);
const { createApp } = require(workerData.appPath);
const { openDatabase } = require(workerData.dbPath);
const gate = new Int32Array(workerData.gate);
const pause = new Int32Array(new SharedArrayBuffer(4));
let armed = false;
let delayRead = false;
let publicationStatus = null;
const db = openDatabase(workerData.databasePath);
const prepare = db.prepare.bind(db);
db.prepare = function(sql) {
  const statement = prepare(sql);
  if (sql === 'SELECT * FROM previews WHERE id=?' || sql === 'SELECT * FROM documents WHERE id=?') {
    const get = statement.get.bind(statement);
    statement.get = function(...parameters) {
      const result = get(...parameters);
      if (armed && !db.inTransaction && sql === 'SELECT * FROM previews WHERE id=?') {
        armed = false; publicationStatus = result?.status;
      } else if (delayRead && db.inTransaction && sql === 'SELECT * FROM documents WHERE id=?') {
        delayRead = false; Atomics.wait(pause, 0, 0, 35);
      }
      return result;
    };
  }
  return statement;
};
const transaction = db.transaction.bind(db);
db.transaction = function(callback) {
  const result = transaction(callback);
  if (!publicationStatus) return result;
  const status = publicationStatus; publicationStatus = null;
  const enter = (method, parameters) => {
    parentPort.postMessage({ type: 'arrived', status });
    if (Atomics.wait(gate, 0, 0, 8000) === 'timed-out') throw new Error('Publication start barrier timed out');
    delayRead = true;
    return method ? result[method](...parameters) : result(...parameters);
  };
  const invoke = (...parameters) => enter(null, parameters);
  for (const method of ['deferred', 'immediate', 'exclusive']) invoke[method] = (...parameters) => enter(method, parameters);
  return invoke;
};
(async () => {
  const app = createApp({ db, dataDir: workerData.dataDir, secretKey: workerData.secretKey, appUrl: workerData.origin, seed: false, exports: { autoStart: false } });
  parentPort.on('message', async (message) => {
    if (message === 'arm') { armed = true; parentPort.postMessage({ type: 'armed' }); }
    if (message === 'close') { await app.close(); db.close(); parentPort.close(); }
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  parentPort.postMessage({ type: 'ready', url });
})().catch(error => { parentPort.postMessage({ type: 'failure', message: String(error) }); process.exitCode = 1; parentPort.close(); });
`;

function message(worker: Worker, type: string): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Worker did not report ${type}`)), 10_000);
    const received = (value: WorkerMessage) => {
      if (value.type === 'failure') finish(new Error(value.message));
      else if (value.type === type) finish(undefined, value);
    };
    const failed = (error: Error) => finish(error);
    const exited = (code: number) => finish(new Error(`Worker exited before ${type}: ${code}`));
    function finish(error?: Error, value?: WorkerMessage) {
      clearTimeout(timer); worker.off('message', received); worker.off('error', failed); worker.off('exit', exited);
      if (error) reject(error); else resolve(value!);
    }
    worker.on('message', received); worker.once('error', failed); worker.once('exit', exited);
  });
}

describe('SQLite publication across independent HTTP workers', () => {
  let dataDir: string; let databasePath: string; let db: HcdDatabase; let app: FastifyInstance; let owner: string;
  let content: Document; let publishers: Publisher[]; let gate: Int32Array;
  const headers = (cookie = owner) => ({ cookie, origin, 'x-hcd-request': '1' });
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hcd-concurrent-publish-')); databasePath = join(dataDir, 'hcd.sqlite');
    db = openDatabase(databasePath); app = createApp({ db, dataDir, secretKey, appUrl: origin, seed: true, exports: { autoStart: false } }); publishers = []; gate = new Int32Array(new SharedArrayBuffer(4));
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(''), payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    expect(login.statusCode, login.body).toBe(200); owner = String(login.headers['set-cookie']).split(';')[0]!;
    const prepared = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(), payload: { spaceId: 'sp_demo000000', filename: 'concurrency.html', html: '<h2>Concurrency</h2><p>Original published content.</p>' } });
    expect(prepared.statusCode, prepared.body).toBe(201);
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/imports/${prepared.json().import.id}/confirm`, headers: headers(), payload: {} });
    expect(confirmed.statusCode, confirmed.body).toBe(201); content = confirmed.json().content;
  });
  afterEach(async () => {
    Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
    await Promise.all(publishers.map(async ({ worker }) => {
      if (worker.threadId === -1) return;
      const exit = new Promise<void>(resolve => worker.once('exit', () => resolve()));
      worker.postMessage('close');
      const forced = setTimeout(() => { void worker.terminate(); }, 2000);
      await exit; clearTimeout(forced);
    }));
    await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true });
  });
  async function startPublisher(): Promise<Publisher> {
    const worker = new Worker(workerSource, { eval: true, workerData: { loader: require.resolve('tsx/cjs'), appPath: fileURLToPath(new URL('../src/app.ts', import.meta.url)), dbPath: fileURLToPath(new URL('../src/db.ts', import.meta.url)), databasePath, dataDir, secretKey, origin, gate: gate.buffer } });
    const publisher = { worker, url: '' }; publishers.push(publisher);
    const ready = await message(worker, 'ready'); publisher.url = ready.url!; return publisher;
  }
  async function submission(label: string) {
    const changed = structuredClone(content); changed.title = label;
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/submissions`, headers: { ...headers(), 'idempotency-key': label }, payload: { baseVersion: 1, content: changed } });
    expect(response.statusCode, response.body).toBe(201); return response.json().submission.id as string;
  }
  async function preview(submissionId: string) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/previews`, headers: headers(), payload: { submissionIds: [submissionId] } });
    expect(response.statusCode, response.body).toBe(200); return response.json().preview as Preview;
  }
  async function race(first: Preview, second: Preview) {
    const left = await startPublisher(); const right = await startPublisher();
    for (const publisher of [left, right]) { const armed = message(publisher.worker, 'armed'); publisher.worker.postMessage('arm'); await armed; }
    const arrived = [message(left.worker, 'arrived'), message(right.worker, 'arrived')];
    const publish = (publisher: Publisher, target: Preview) => fetch(`${publisher.url}/api/v1/previews/${target.id}/publish`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ revision: target.revision }), signal: AbortSignal.timeout(10_000) }).then(async response => ({ status: response.status, body: await response.json() }));
    const requests = Promise.all([publish(left, first), publish(right, second)]);
    // If setup/barrier validation fails first, cleanup still releases the workers
    // and a later HTTP timeout must not become an unhandled rejection.
    void requests.catch(() => {});
    try { expect((await Promise.all(arrived)).map(value => value.status)).toEqual(['open', 'open']); }
    finally { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); }
    return requests;
  }
  const history = () => db.prepare('SELECT version,kind,content FROM versions WHERE doc_id=? ORDER BY version').all(content.id) as Array<{ version: number; kind: string; content: string }>;
  const savedSubmissions = () => db.prepare('SELECT id,status,published_version FROM submissions WHERE doc_id=? ORDER BY id').all(content.id) as Array<{ id: string; status: string; published_version: number | null }>;
  const publicationState = () => ({
    head: db.prepare('SELECT current_version,title,updated_at FROM documents WHERE id=?').get(content.id),
    versions: history(), submissions: savedSubmissions(),
    previews: db.prepare('SELECT id,status,published_version FROM previews WHERE doc_id=? ORDER BY id').all(content.id),
    notifications: db.prepare('SELECT * FROM notifications WHERE doc_id=? ORDER BY id').all(content.id),
  });
  async function login(email: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(''), payload: { email, password: 'hcd-demo-2026' } });
    expect(response.statusCode, response.body).toBe(200); return String(response.headers['set-cookie']).split(';')[0]!;
  }
  async function publishAfterChange(target: Preview, cookie: string, change: () => Promise<void>) {
    const publisher = await startPublisher();
    const armed = message(publisher.worker, 'armed'); publisher.worker.postMessage('arm'); await armed;
    const arrived = message(publisher.worker, 'arrived');
    const request = fetch(`${publisher.url}/api/v1/previews/${target.id}/publish`, { method: 'POST', headers: { ...headers(cookie), 'content-type': 'application/json' }, body: JSON.stringify({ revision: target.revision }), signal: AbortSignal.timeout(10_000) });
    void request.catch(() => {});
    try { expect((await arrived).status).toBe('open'); await change(); }
    finally { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); }
    return request;
  }

  it('AT-12: competing open previews publish once and return PREVIEW_STALE to the loser', async () => {
    const firstSubmission = await submission('First contender'); const secondSubmission = await submission('Second contender');
    const first = await preview(firstSubmission); const second = await preview(secondSubmission);
    // The API intentionally stales older previews. AT-12 also requires testing
    // the competing-open database state, so restore only that status here.
    db.prepare("UPDATE previews SET status='open' WHERE id IN (?,?)").run(first.id, second.id);
    const results = await race(first, second);
    expect(results.map(result => result.status).sort(), JSON.stringify(results)).toEqual([200, 409]);
    const winner = results.findIndex(result => result.status === 200); const loser = 1 - winner;
    expect(results[loser]!.body).toMatchObject({ error: { code: 'PREVIEW_STALE' } });
    expect(results[winner]!.body.version.version).toBe(2);
    const versions = history(); expect(versions.map(version => version.version)).toEqual([1, 2]); expect(JSON.parse(versions[0]!.content)).toEqual(content);
    expect(JSON.parse(versions[1]!.content)).toEqual([first, second][winner]!.candidate);
    expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(content.id)).toEqual({ current_version: 2 });
    const statuses = savedSubmissions();
    expect(statuses.find(row => row.id === [firstSubmission, secondSubmission][winner])).toMatchObject({ status: 'published', published_version: 2 });
    expect(statuses.find(row => row.id === [firstSubmission, secondSubmission][loser])).toMatchObject({ status: 'pending', published_version: null });
    for (const [index, target] of [first, second].entries()) {
      const response = await app.inject({ url: `/api/v1/previews/${target.id}`, headers: headers() });
      expect(response.json().preview.status).toBe(index === winner ? 'published' : 'stale');
    }
  }, 25_000);

  it('AT-05 returns the same committed version to simultaneous requests for one preview', async () => {
    const submissionId = await submission('One preview, two publishers'); const target = await preview(submissionId);
    const results = await race(target, target);
    expect(results.map(result => result.status), JSON.stringify(results)).toEqual([200, 200]);
    for (const result of results) expect(result.body.version).toEqual({ version: 2, content: target.candidate });
    expect(history().map(version => version.version)).toEqual([1, 2]);
    expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(content.id)).toEqual({ current_version: 2 });
    expect(savedSubmissions()).toEqual([{ id: submissionId, status: 'published', published_version: 2 }]);
  }, 25_000);

  it('AT-04: an open preview with an older head returns exactly PREVIEW_STALE without writes', async () => {
    const firstSubmission = await submission('Published first'); const secondSubmission = await submission('Still pending');
    const first = await preview(firstSubmission); const second = await preview(secondSubmission);
    db.prepare("UPDATE previews SET status='open' WHERE id=?").run(first.id);
    const published = await app.inject({ method: 'POST', url: `/api/v1/previews/${first.id}/publish`, headers: headers(), payload: { revision: first.revision } });
    expect(published.statusCode, published.body).toBe(200);
    expect(db.prepare('SELECT status,base_version FROM previews WHERE id=?').get(second.id)).toEqual({ status: 'open', base_version: 1 });
    const before = { history: history(), submissions: savedSubmissions() };
    const publisher = await startPublisher();
    const response = await fetch(`${publisher.url}/api/v1/previews/${second.id}/publish`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ revision: second.revision }), signal: AbortSignal.timeout(10_000) });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: 'PREVIEW_STALE' } });
    expect({ history: history(), submissions: savedSubmissions() }).toEqual(before);
    expect(db.prepare('SELECT current_version FROM documents WHERE id=?').get(content.id)).toEqual({ current_version: 2 });
  }, 20_000);

  it('AT-11 rechecks owner permission when membership changes before the publication lock', async () => {
    const submissionId = await submission('Permission must still hold'); const target = await preview(submissionId);
    const publisher = await startPublisher();
    const armed = message(publisher.worker, 'armed'); publisher.worker.postMessage('arm'); await armed;
    const arrived = message(publisher.worker, 'arrived');
    const request = fetch(`${publisher.url}/api/v1/previews/${target.id}/publish`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ revision: target.revision }), signal: AbortSignal.timeout(10_000) });
    try {
      expect((await arrived).status).toBe('open');
      db.transaction(() => {
        db.prepare("UPDATE document_members SET role='viewer' WHERE doc_id=? AND user_id='u_owner000000'").run(content.id);
        db.prepare("UPDATE space_members SET role='viewer' WHERE space_id='sp_demo000000' AND user_id='u_owner000000'").run();
      })();
    } finally { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); }
    const response = await request; expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(history().map(version => version.version)).toEqual([1]);
    expect(savedSubmissions()).toEqual([{ id: submissionId, status: 'pending', published_version: null }]);
  }, 20_000);

  it('AT-11 rejects a session revoked after initial authorization without publication writes', async () => {
    const target = await preview(await submission('Revoked publisher session'));
    const before = publicationState();
    const response = await publishAfterChange(target, owner, async () => {
      const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: headers(), payload: {} });
      expect(logout.statusCode, logout.body).toBe(204);
    });
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(publicationState()).toEqual(before);
  }, 20_000);

  it.each([
    { label: 'disabled account', change: { disabled: true }, status: 401, code: 'UNAUTHENTICATED' },
    { label: 'removed administrator status', change: { isAdmin: false }, status: 403, code: 'FORBIDDEN' },
  ])('AT-11 rejects $label changed after initial authorization without publication writes', async ({ change, status, code }) => {
    const target = await preview(await submission(`Publisher ${code}`));
    const admin = await login('admin@example.com');
    const elevated = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_editor00000', headers: headers(admin), payload: { isAdmin: true } });
    expect(elevated.statusCode, elevated.body).toBe(200);
    const publisher = await login('a@example.com');
    const before = publicationState();
    const response = await publishAfterChange(target, publisher, async () => {
      const changed = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_editor00000', headers: headers(admin), payload: change });
      expect(changed.statusCode, changed.body).toBe(200);
    });
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ error: { code } });
    expect(publicationState()).toEqual(before);
  }, 20_000);
});
