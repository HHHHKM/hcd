import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { plainText, type Document, type Inline, type ParagraphBlock } from '../../core/src/model';
import type { MergeConflict, MergeItem } from '../../core/src/merge';
import type { ReviewPresentation } from '../../core/src/review-types';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const origin = 'http://hcd-merge-acceptance.test';
const tm2 = {
  base: '本季度重点提升新用户第 7 天留存。',
  current: '本季度重点提升新用户第 7 天和第 30 天留存。',
  incoming: '本季度重点提升新用户首周留存和付费转化。',
};
const tm3 = {
  base: '10 月 15 日前完成灰度。',
  current: '10 月 20 日前完成灰度。',
  incoming: '10 月 15 日前完成灰度，并同步客服团队。',
  merged: '10 月 20 日前完成灰度，并同步客服团队。',
};
type Actor = { cookie: string; id: string };
type Submission = { id: string; authorId: string; baseVersion: number; createdAt: string; status: string; publishedVersion: number | null; content: Document };
type Preview = { id: string; revision: number; baseVersion: number; status: string; publishable: boolean; kind?: string; candidate: Document; conflicts: MergeConflict[]; items: MergeItem[]; presentation: ReviewPresentation };
type Publication = { version: { version: number; content: Document } };
type Version = { number: number; kind: string; content: Document; createdBy: string; createdAt: string };

describe('collaborative merge acceptance through real HTTP', () => {
  let app: FastifyInstance; let db: HcdDatabase; let dataDir: string; let url: string; let owner: Actor; let editorA: Actor; let editorB: Actor; let base: Document; let lastCreated: number;
  const headers = (actor = owner) => ({ cookie: actor.cookie, origin, 'x-hcd-request': '1', 'content-type': 'application/json' });
  async function request<T>(method: string, path: string, payload?: unknown, actor = owner, expected = 200, extra: Record<string, string> = {}): Promise<T> {
    const response = await fetch(`${url}/api/v1${path}`, { method, headers: { ...headers(actor), ...extra }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(8000) });
    const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(expected); return value as T;
  }
  async function login(email: string): Promise<Actor> {
    const response = await fetch(`${url}/api/v1/auth/login`, { method: 'POST', headers: { origin, 'x-hcd-request': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hcd-demo-2026' }), signal: AbortSignal.timeout(8000) });
    const value = await response.json() as { user: { id: string } }; expect(response.status, JSON.stringify(value)).toBe(200);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, id: value.user.id };
  }
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'hcd-merge-acceptance-')); db = openDatabase(join(dataDir, 'hcd.sqlite'));
    app = createApp({ db, dataDir, seed: true, appUrl: origin, secretKey: 'hcd-merge-acceptance-private-test-key', exports: { autoStart: false } });
    url = await app.listen({ host: '127.0.0.1', port: 0 }); lastCreated = 0;
    owner = await login('d@example.com'); editorA = await login('a@example.com'); editorB = await login('b@example.com');
    expect(editorA.id).not.toBe(editorB.id); expect(owner.id).not.toBe(editorA.id);
    const imported = await request<{ import: { id: string } }>('POST', '/imports', { spaceId: 'sp_demo000000', filename: 'merge-acceptance.html', html: `<h2>协作验收</h2><p>${tm2.base}</p><p>${tm3.base}</p><p>预算 100 元。</p>` }, owner, 201);
    const confirmed = await request<{ content: Document }>('POST', `/imports/${imported.import.id}/confirm`, {}, owner, 201); base = confirmed.content;
    expect(base.modules[0]!.blocks).toHaveLength(3);
  });
  afterEach(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

  function change(source: Document, index: number, text: string | Inline) {
    const content = structuredClone(source); const block = content.modules[0]!.blocks[index] as ParagraphBlock;
    expect(block.type).toBe('paragraph'); block.text = typeof text === 'string' ? [{ t: text }] : text; return content;
  }
  const paragraph = (document: Document, index: number) => (document.modules[0]!.blocks[index] as ParagraphBlock).text;
  async function submit(actor: Actor, content: Document, baseVersion = 1) {
    // The server orders submissions by creation time and then ID. Ensure distinct
    // real clock ticks without rewriting immutable submission data or mocking time.
    if (Date.now() <= lastCreated) await new Promise(resolve => setTimeout(resolve, lastCreated - Date.now() + 1));
    const result = await request<{ submission: Submission }>('POST', `/docs/${base.id}/submissions`, { baseVersion, content, message: 'HTTP merge acceptance' }, actor, 201, { 'idempotency-key': crypto.randomUUID() });
    expect(result.submission).toMatchObject({ authorId: actor.id, baseVersion, status: 'pending' });
    lastCreated = Date.parse(result.submission.createdAt); return result.submission;
  }
  const preview = async (ids: string[]) => (await request<{ preview: Preview }>('POST', `/docs/${base.id}/previews`, { submissionIds: ids })).preview;
  const publish = (view: Preview) => request<Publication>('POST', `/previews/${view.id}/publish`, { revision: view.revision });
  const snapshot = async (version: number) => (await request<{ version: Version }>('GET', `/docs/${base.id}/versions/${version}`)).version;
  const head = () => request<{ currentVersion: number }>('GET', `/docs/${base.id}/head`);
  const pending = async () => (await request<{ submissions: Submission[] }>('GET', `/docs/${base.id}/submissions?status=pending`)).submissions;
  async function assertPublished(ids: string[], version: number) {
    for (const id of ids) {
      const result = await request<{ submission: Submission }>('GET', `/submissions/${id}`);
      expect(result.submission).toMatchObject({ status: 'published', publishedVersion: version });
    }
  }

  it('AT-01 publishes both authors’ changes to different paragraphs without changing the original version', async () => {
    const a = await submit(editorA, change(base, 0, tm2.current));
    const b = await submit(editorB, change(base, 1, tm3.incoming));
    // Request order is deliberately reversed; stored creation order governs merge.
    const view = await preview([b.id, a.id]); const expected = change(change(base, 0, tm2.current), 1, tm3.incoming);
    expect(view).toMatchObject({ baseVersion: 1, publishable: true, conflicts: [], candidate: expected });
    expect(view.items.map(item => item.submissionId)).toEqual([a.id, b.id]);
    expect(view.items.every(item => item.status === 'clean' && item.ops.every(op => op.outcome === 'applied'))).toBe(true);
    expect((await publish(view)).version).toEqual({ version: 2, content: expected });
    expect((await snapshot(1)).content).toEqual(base); expect((await snapshot(2)).content).toEqual(expected);
    await assertPublished([a.id, b.id], 2); expect(await pending()).toEqual([]); expect((await head()).currentVersion).toBe(2);
  });

  it('AT-02 / TM-3 marks separate edits in one paragraph as a same-field merge and publishes their combined text', async () => {
    const a = await submit(editorA, change(base, 1, tm3.current)); const b = await submit(editorB, change(base, 1, tm3.incoming));
    const view = await preview([b.id, a.id]); const expected = change(base, 1, tm3.merged);
    expect(view).toMatchObject({ publishable: true, conflicts: [], candidate: expected });
    expect(view.items.find(item => item.submissionId === b.id)?.ops).toEqual([{ index: 0, outcome: 'merged', note: 'same_field_merge' }]);
    expect(view.presentation.proposed.find(item => item.submissionId === b.id)?.operations).toEqual([{ index: 0, outcome: 'merged', note: 'same_field_merge' }]);
    expect((await publish(view)).version).toEqual({ version: 2, content: expected });
    expect(plainText(paragraph((await snapshot(2)).content, 1))).toBe(tm3.merged); await assertPublished([a.id, b.id], 2);
  });

  it.each(['keep_current', 'take_incoming', 'manual'] as const)('AT-03 / TM-2 refuses an unresolved overlap and publishes the correct %s decision', async choice => {
    const a = await submit(editorA, change(base, 0, tm2.current)); const b = await submit(editorB, change(base, 0, tm2.incoming));
    let view = await preview([a.id, b.id]); expect(view.publishable).toBe(false); expect(view.conflicts).toHaveLength(1);
    const conflict = view.conflicts[0]!;
    expect(conflict).toMatchObject({ kind: 'text_overlap', submissionId: b.id, targetId: base.modules[0]!.blocks[0]!.id, base: [{ t: tm2.base }], current: [{ t: tm2.current }], incoming: [{ t: tm2.incoming }] });
    expect(conflict.allowed).toEqual(expect.arrayContaining(['keep_current', 'take_incoming', 'manual']));
    const denied = await request<{ error: { code: string } }>('POST', `/previews/${view.id}/publish`, { revision: view.revision }, owner, 409);
    expect(denied.error.code).toBe('CONFLICTS_UNRESOLVED'); expect((await head()).currentVersion).toBe(1); expect(await pending()).toHaveLength(2);
    const manual: Inline = [{ t: '人工合并：', b: true }, { t: '兼顾第 30 天留存与付费转化。' }];
    const expectedText = choice === 'keep_current' ? [{ t: tm2.current }] : choice === 'take_incoming' ? [{ t: tm2.incoming }] : manual;
    const resolved = await request<{ preview: Preview }>('POST', `/previews/${view.id}/resolutions`, { revision: view.revision, conflictId: conflict.id, choice, ...(choice === 'manual' ? { value: manual } : {}) });
    expect(resolved.preview.revision).toBe(view.revision + 1); view = resolved.preview;
    expect(view.publishable).toBe(true); expect(paragraph(view.candidate, 0)).toEqual(expectedText);
    expect((await publish(view)).version).toEqual({ version: 2, content: change(base, 0, expectedText) });
    await assertPublished([a.id, b.id], 2); expect(await pending()).toEqual([]); expect((await snapshot(1)).content).toEqual(base);
  });

  it('AT-07 restores into a new version, preserves history and pending work, and reevaluates that work against the restored head', async () => {
    const v2 = change(base, 2, '预算 120 元。'); const accepted = await submit(editorA, v2);
    expect((await publish(await preview([accepted.id]))).version).toEqual({ version: 2, content: v2 });
    const waiting = await submit(editorB, change(v2, 2, '预算 150 元。'), 2);
    const oldPreview = await preview([waiting.id]); expect(oldPreview).toMatchObject({ baseVersion: 2, publishable: true, conflicts: [] });
    const originalVersions = [await snapshot(1), await snapshot(2)]; const waitingBefore = await pending();
    const restoration = (await request<{ preview: Preview }>('POST', `/docs/${base.id}/restore`, { version: 1 })).preview;
    expect(restoration).toMatchObject({ kind: 'restore', baseVersion: 2, publishable: true, candidate: base });
    expect((await publish(restoration)).version).toEqual({ version: 3, content: base });
    expect(await snapshot(1)).toEqual(originalVersions[0]); expect(await snapshot(2)).toEqual(originalVersions[1]);
    expect(await snapshot(3)).toMatchObject({ number: 3, kind: 'restore', content: base });
    const versions = await request<{ versions: Array<{ version: number }> }>('GET', `/docs/${base.id}/versions`);
    expect(versions.versions.map(version => version.version)).toEqual([3, 2, 1]); expect(await pending()).toEqual(waitingBefore);
    const stale = await request<{ error: { code: string } }>('POST', `/previews/${oldPreview.id}/publish`, { revision: oldPreview.revision }, owner, 409);
    expect(stale.error.code).toBe('PREVIEW_STALE');
    const rebuilt = await preview([waiting.id]); expect(rebuilt).toMatchObject({ baseVersion: 3, publishable: false, candidate: base });
    expect(rebuilt.conflicts).toHaveLength(1); expect(rebuilt.conflicts[0]).toMatchObject({ kind: 'text_overlap', submissionId: waiting.id, base: [{ t: '预算 120 元。' }], current: [{ t: '预算 100 元。' }], incoming: [{ t: '预算 150 元。' }] });
    expect((await request<{ error: { code: string } }>('POST', `/previews/${rebuilt.id}/publish`, { revision: rebuilt.revision }, owner, 409)).error.code).toBe('CONFLICTS_UNRESOLVED');
    expect((await head()).currentVersion).toBe(3); expect(await pending()).toEqual(waitingBefore);
  });
});
