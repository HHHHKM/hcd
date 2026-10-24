import { afterEach, describe, expect, it } from 'vitest';
import { createChangeWorker } from '../src/change-worker-client';
import type { Document } from '../../core/src/model';

const before: Document = { schemaVersion: 1, id: 'd_aaaaaaaa', title: 'Original', theme: { id: 'default', version: 1, overrides: {} }, modules: [] };
const snapshot = (title: string) => JSON.stringify({ ...before, title });
let service: ReturnType<typeof createChangeWorker> | undefined;
afterEach(async () => { await service?.close(); service = undefined; });

describe('bounded change worker', () => {
  it('B4 reuses immutable results, distinguishes direction, and evicts least-recently-used comparisons', async () => {
    service = createChangeWorker({ cacheEntries: 2 });
    const first = await service.compare('one', 1, 2, snapshot('Original'), snapshot('Changed'));
    // An existing immutable key keeps the first result; the input strings need not be resent to the worker.
    expect(await service.compare('one', 1, 2, 'not parsed on cache hit', 'not parsed on cache hit')).toBe(first);
    const reverse = JSON.parse(await service.compare('one', 2, 1, snapshot('Changed'), snapshot('Original')));
    expect(reverse.changeSet.changes[0]).toMatchObject({ before: 'Changed', after: 'Original' });
    await service.compare('two', 1, 2, snapshot('Original'), snapshot('Other'));
    await expect(service.compare('one', 1, 2, 'evicted key must be recomputed', '{}')).rejects.toThrow('CHANGE_PRESENTATION_UNAVAILABLE');
  });

  it('B4 bounds cache bytes and does not retain oversized results', async () => {
    service = createChangeWorker({ cacheBytes: 1 });
    expect(JSON.parse(await service.compare('one', 1, 2, snapshot('Original'), snapshot('Changed'))).changeSet.changes).toHaveLength(1);
    await expect(service.compare('one', 1, 2, 'must be recomputed', '{}')).rejects.toThrow('CHANGE_PRESENTATION_UNAVAILABLE');
  });

  it('B4 coalesces simultaneous identical work and rejects excess queued tasks', async () => {
    service = createChangeWorker({ queueLimit: 1 });
    const first = service.compare('one', 1, 2, snapshot('Original'), snapshot('Changed'));
    const duplicate = service.compare('one', 1, 2, snapshot('Original'), snapshot('Changed'));
    await expect(service.compare('two', 1, 2, snapshot('Original'), snapshot('Changed'))).rejects.toMatchObject({ statusCode: 503 });
    expect(await duplicate).toBe(await first);
    expect(JSON.parse(await service.compare('two', 1, 2, snapshot('Original'), snapshot('Changed'))).changeSet.changes).toHaveLength(1);
  });
});
