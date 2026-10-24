import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { ReviewPresentation } from '../../core/src/review-types';
import type { ReviewPresentationInput } from './change-presentation';
import type { ChangeWorkerTask } from './change-worker';

const require = createRequire(import.meta.url);
type Job = { id: number; task: ChangeWorkerTask; bytes: number; resolve: (result: string) => void; reject: (error: Error) => void };
type Options = { cacheEntries?: number; cacheBytes?: number; queueLimit?: number; queueBytes?: number };
export class ChangeWorkerBusyError extends Error { readonly statusCode = 503; }

/** One CPU worker per app, with a bounded queue and byte/entry-bounded immutable-result LRU. */
export function createChangeWorker(options: Options = {}) {
  const maxEntries = options.cacheEntries ?? 32;
  const maxBytes = options.cacheBytes ?? 32 * 1024 * 1024;
  const maxQueue = options.queueLimit ?? 16;
  const maxQueueBytes = options.queueBytes ?? 32 * 1024 * 1024;
  const cache = new Map<string, { json: string; bytes: number }>();
  const inFlight = new Map<string, Promise<string>>();
  const queue: Job[] = [];
  let cacheBytes = 0; let queuedBytes = 0; let sequence = 0;
  let worker: Worker | null = null; let active: Job | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined; let closed = false;

  function fail(error: Error) {
    if (timer) clearTimeout(timer);
    active?.reject(error); active = null;
    for (const job of queue.splice(0)) job.reject(error);
    queuedBytes = 0;
    const old = worker; worker = null;
    if (old) { old.removeAllListeners(); void old.terminate(); }
  }
  function start() {
    if (active || queue.length === 0 || closed) return;
    if (!worker) {
      const bundled = new URL('./change-worker.mjs', import.meta.url);
      worker = existsSync(bundled)
        ? new Worker(bundled)
        : new Worker("const { workerData } = require('node:worker_threads'); require(workerData.loader); require(workerData.entry);", {
          eval: true,
          workerData: { loader: require.resolve('tsx/cjs'), entry: fileURLToPath(new URL('./change-worker.ts', import.meta.url)) },
          // Eval workers use CommonJS even when the parent was started as an ESM bundle.
          execArgv: [],
        });
      worker.on('message', (message: { id: number; result?: string; error?: string }) => {
        if (!active || message.id !== active.id) return;
        if (timer) clearTimeout(timer);
        const job = active; active = null; queuedBytes -= job.bytes;
        if (message.error) job.reject(new Error(message.error)); else job.resolve(message.result!);
        if (!queue.length) worker?.unref();
        start();
      });
      worker.on('error', error => fail(error));
      worker.on('exit', code => { if (worker) fail(new Error(`Change worker exited (${code})`)); });
    }
    active = queue.shift()!;
    worker.ref();
    timer = setTimeout(() => fail(new Error('CHANGE_PRESENTATION_TIMEOUT')), 60_000); timer.unref();
    worker.postMessage({ id: active.id, task: active.task });
  }
  function run(task: ChangeWorkerTask): Promise<string> {
    if (closed) return Promise.reject(new Error('CHANGE_WORKER_CLOSED'));
    const bytes = Buffer.byteLength(JSON.stringify(task));
    if (queue.length + Number(Boolean(active)) >= maxQueue || queuedBytes + bytes > maxQueueBytes) {
      return Promise.reject(new ChangeWorkerBusyError('CHANGE_WORKER_BUSY'));
    }
    return new Promise((resolve, reject) => { queuedBytes += bytes; queue.push({ id: ++sequence, task, bytes, resolve, reject }); start(); });
  }
  async function compare(docId: string, from: number, to: number, before: string, after: string): Promise<string> {
    const key = JSON.stringify([docId, from, to]);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.json; }
    const pending = inFlight.get(key); if (pending) return pending;
    const result = run({ kind: 'compare', before, after, from, to }).then(json => {
      const bytes = Buffer.byteLength(json);
      if (maxEntries > 0 && bytes <= maxBytes) {
        while (cache.size >= maxEntries || cacheBytes + bytes > maxBytes) {
          const oldest = cache.keys().next().value!;
          cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
        }
        cache.set(key, { json, bytes }); cacheBytes += bytes;
      }
      return json;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, result); return result;
  }
  return {
    compare,
    async review(input: ReviewPresentationInput): Promise<ReviewPresentation> {
      return JSON.parse(await run({ kind: 'review', input })) as ReviewPresentation;
    },
    async close() {
      closed = true;
      const old = worker;
      fail(new Error('CHANGE_WORKER_CLOSED'));
      if (old) await old.terminate();
      cache.clear(); inFlight.clear(); cacheBytes = 0;
    },
  };
}
