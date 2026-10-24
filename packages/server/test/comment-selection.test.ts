import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';
import { plainText, type Document, type ParagraphBlock, type TableBlock } from '../../core/src/model';
import type { Anchor } from '../../core/src/anchors';
import { createOutboxWorker, type NotificationMail } from '../src/outbox';

const origin = 'http://localhost:5173';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
const source = '<h2>First</h2><p>right <b>target</b> end</p><table><thead><tr><th>Text</th></tr></thead><tbody><tr><td>前 <b>🌍 粗体</b><br><i>结尾 é</i></td></tr></tbody></table><h2>Second</h2><p>Stable text</p>';

describe('comment selection integrity through the real API', () => {
  let app: FastifyInstance; let db: HcdDatabase; let owner: string; let admin: string; let commenter: string; let viewer: string;
  let content: Document; let version: number; let sent: NotificationMail[];
  const secretKey = 'comment-selection-integration-secret';
  async function login(email: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password: 'hcd-demo-2026' } });
    expect(response.statusCode, response.body).toBe(200); return String(response.headers['set-cookie']).split(';')[0]!;
  }
  async function imported(html = source) {
    const prepared = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: headers(owner), payload: { spaceId: 'sp_demo000000', filename: 'selection.html', html } });
    expect(prepared.statusCode, prepared.body).toBe(201);
    const response = await app.inject({ method: 'POST', url: `/api/v1/imports/${prepared.json().import.id}/confirm`, headers: headers(owner), payload: {} });
    expect(response.statusCode, response.body).toBe(201); return response.json().content as Document;
  }
  beforeEach(async () => {
    db = openDatabase(':memory:'); sent = [];
    app = createApp({ db, seed: true, appUrl: origin, secretKey, mailDelivery: { async send(mail) { sent.push(mail); } } });
    owner = await login('d@example.com'); admin = await login('admin@example.com'); commenter = await login('f@example.com'); viewer = await login('b@example.com');
    db.prepare("UPDATE space_members SET role='viewer' WHERE user_id='u_ops0000000'").run();
    content = await imported(); version = 1;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const paragraph = () => content.modules[0]!.blocks[0] as ParagraphBlock;
  const table = () => content.modules[0]!.blocks[1] as TableBlock;
  const paragraphAnchor = (): Anchor => ({ moduleId: content.modules[0]!.id, blockId: paragraph().id, field: 'text', quote: 'target', prefix: 'right ', suffix: ' end', version: 1 });
  const tableAnchor = (): Anchor => ({ moduleId: content.modules[0]!.id, blockId: table().rows[0]!.id, field: `cell:${table().columns[0]!.id}`, quote: '🌍 粗体\n结尾', prefix: '前 ', suffix: ' é', version: 1 });
  const add = (anchor?: Anchor, cookie = commenter) => app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/comments`, headers: headers(cookie), payload: { body: 'A selected passage', ...(anchor ? { anchor } : {}) } });
  async function threads() { return (await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/comments?status=all`, headers: { cookie: owner } })).json().threads as Array<{ root: { id: string; anchor: Anchor; anchorState: string; range?: { start: number; end: number } }; anchorState: string; range?: { start: number; end: number } }>; }
  async function thread(id: string) { const found = (await threads()).find((item) => item.root.id === id); expect(found).toBeDefined(); return found!; }
  async function publish() {
    const submission = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/submissions`, headers: { ...headers(owner), 'idempotency-key': `selection-${version}` }, payload: { baseVersion: version, content } });
    expect(submission.statusCode, submission.body).toBe(201);
    const preview = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/previews`, headers: headers(admin), payload: { submissionIds: [submission.json().submission.id] } });
    expect(preview.statusCode, preview.body).toBe(200);
    const response = await app.inject({ method: 'POST', url: `/api/v1/previews/${preview.json().preview.id}/publish`, headers: headers(admin), payload: { revision: preview.json().preview.revision } });
    expect(response.statusCode, response.body).toBe(200); version++;
  }
  async function token(scopes: string[], docIds = [content.id]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(owner), payload: { name: 'Selection tests', scopes, docIds } });
    expect(response.statusCode, response.body).toBe(201); return { authorization: `Bearer ${response.json().token}`, 'x-hcd-request': '1' };
  }
  async function share(versionPin?: number, role: 'viewer' | 'commenter' = 'viewer') {
    const response = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/share-links`, headers: headers(owner), payload: { role, ...(versionPin ? { versionPin } : {}) } });
    expect(response.statusCode, response.body).toBe(201); return `/api/v1/s/${new URL(response.json().link.url).pathname.split('/').pop()!}`;
  }
  async function verifyGuest(path: string) {
    const started = await app.inject({ method: 'POST', url: `${path}/verify/start`, headers: headers(), payload: { email: 'guest@example.com', name: 'Guest', locale: 'en' } });
    expect(started.statusCode, started.body).toBe(202);
    await createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick();
    const code = sent.filter((mail) => mail.to === 'guest@example.com').at(-1)!.text.match(/\b\d{6}\b/)![0];
    const verified = await app.inject({ method: 'POST', url: `${path}/verify/finish`, headers: headers(), payload: { challengeId: started.json().challengeId, code } });
    expect(verified.statusCode, verified.body).toBe(200); return (verified.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
  }
  const savedAnchors = () => db.prepare('SELECT id,anchor,anchor_state,anchor_range FROM comments WHERE doc_id=? ORDER BY id').all(content.id);

  it('AT-08 stores a marked Unicode table selection with UTF-16 ranges and keeps module/unanchored ' +
     'comments valid', async () => {
    const anchor = tableAnchor(); const field = table().rows[0]!.cells[table().columns[0]!.id]!; const text = plainText(field);
    expect(field.some((run) => 'b' in run && run.b)).toBe(true); expect(text).toBe('前 🌍 粗体\n结尾 é');
    const created = await add(anchor); expect(created.statusCode, created.body).toBe(201);
    const range = { start: text.indexOf(anchor.quote!), end: text.indexOf(anchor.quote!) + anchor.quote!.length };
    expect(created.json().comment).toMatchObject({ anchor, anchorState: 'ok', range });
    expect(await thread(created.json().comment.id)).toMatchObject({ anchorState: 'ok', range, root: { anchor } });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/comments/${created.json().comment.id}`, headers: { cookie: commenter } });
    expect(detail.json().comment).toMatchObject({ anchorState: 'ok', range });
    expect((await add()).statusCode).toBe(201);
    expect((await add({ moduleId: content.modules[0]!.id })).json().comment).toMatchObject({ anchorState: 'ok', anchor: { moduleId: content.modules[0]!.id, version: 1 } });
    const reply = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/comments`, headers: headers(commenter), payload: { parentId: created.json().comment.id, body: 'Reply without its own selection' } });
    expect(reply.statusCode).toBe(201); expect(reply.json().comment.anchor).toEqual({});
  });

  it('AT-08 relocates ranges after publication and preserves text_changed/block_deleted/lost ' +
     'states and one lost notification', async () => {
    const selected = (await add(paragraphAnchor())).json().comment.id as string;
    const selectedCell = (await add(tableAnchor())).json().comment.id as string;
    paragraph().text = [{ t: 'right targat end', i: true }];
    const columnId = table().columns[0]!.id; table().rows[0]!.cells[columnId]!.unshift({ t: '新增 ' }); await publish();
    expect(await thread(selected)).toMatchObject({ anchorState: 'ok', range: { start: 6, end: 12 }, root: { anchor: { version: 2, quote: 'targat' } } });
    const cellText = plainText(table().rows[0]!.cells[columnId]!); const cellQuote = tableAnchor().quote!;
    expect(await thread(selectedCell)).toMatchObject({ anchorState: 'ok', range: { start: cellText.indexOf(cellQuote), end: cellText.indexOf(cellQuote) + cellQuote.length }, root: { anchor: { version: 2 } } });
    paragraph().text = [{ t: '完全不相干的内容' }]; await publish();
    expect(await thread(selected)).toMatchObject({ anchorState: 'text_changed', root: { anchor: { blockId: paragraph().id, field: 'text', quote: 'targat', version: 3 } } });
    expect((await thread(selected)).range).toBeUndefined();
    content.modules[0]!.blocks.shift(); await publish();
    expect(await thread(selected)).toMatchObject({ anchorState: 'block_deleted', root: { anchor: { version: 4 } } });
    expect((await thread(selected)).root.anchor.blockId).toBeUndefined(); expect((await thread(selected)).root.anchor.field).toBeUndefined();
    content.title += ' next'; await publish(); expect((await thread(selected)).anchorState).toBe('block_deleted');
    content.modules.shift(); await publish(); expect((await thread(selected)).anchorState).toBe('lost');
    content.title += ' again'; await publish();
    const notices = db.prepare("SELECT payload FROM notifications WHERE user_id='u_owner000000' AND kind='anchor_lost'").all() as Array<{ payload: string }>;
    expect(notices.filter((notice) => JSON.parse(notice.payload).commentId === selected)).toHaveLength(1);
    const awaiting = await app.inject({ method: 'GET', url: `/api/v1/docs/${content.id}/comments?status=relocate`, headers: { cookie: owner } });
    expect(awaiting.json().threads.map((item: { root: { id: string } }) => item.root.id)).toContain(selected);
  });

  it('AT-08 uses exact context to select repeated marked text and preserves combining characters', async () => {
    paragraph().text = [{ t: 'first 🌍 é start; right ' }, { t: '🌍', b: true }, { t: ' é', i: true }, { t: ' end' }]; await publish();
    const text = plainText(paragraph().text); const quote = '🌍 é'; const anchor: Anchor = { moduleId: content.modules[0]!.id, blockId: paragraph().id, field: 'text', quote, prefix: 'right ', suffix: ' end', version };
    const created = await add(anchor); expect(created.statusCode, created.body).toBe(201);
    expect(created.json().comment).toMatchObject({ anchor: { quote }, range: { start: text.lastIndexOf(quote), end: text.lastIndexOf(quote) + quote.length } });
    // A visually similar NFC spelling is not the literal selected text in this version.
    const altered = await add({ ...anchor, quote: '🌍 é' }); expect(altered.statusCode).toBe(400); expect(altered.json().error.code).toBe('ANCHOR_QUOTE_MISMATCH');
  });

  it('AT-08 validates old selections in their actual source version before migrating or rejecting ' +
     'stale modules', async () => {
    const old = paragraphAnchor(); paragraph().text = [{ t: 'right targat end' }]; await publish();
    const relocated = await add(old); expect(relocated.statusCode, relocated.body).toBe(201);
    expect(relocated.json().comment).toMatchObject({ anchor: { quote: 'targat', version: 2 }, anchorState: 'ok', range: { start: 6, end: 12 } });
    expect((await add({ ...old, version: 2 })).json().error.code).toBe('ANCHOR_QUOTE_MISMATCH');
    expect((await add({ ...old, version: undefined })).json().error.code).toBe('ANCHOR_QUOTE_MISMATCH');
    expect((await add({ ...old, version: 999 })).json().error.code).toBe('INVALID_ANCHOR_VERSION');
    paragraph().text = [{ t: 'Completely different content' }]; await publish();
    expect((await add(old)).json().comment).toMatchObject({ anchorState: 'text_changed', anchor: { version: 3 } });
    content.modules[0]!.blocks.shift(); await publish();
    expect((await add(old)).json().comment).toMatchObject({ anchorState: 'block_deleted', anchor: { moduleId: old.moduleId, version: 4 } });
    content.modules.shift(); await publish();
    const before = (await threads()).length; const stale = await add(old);
    expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('ANCHOR_STALE'); expect(await threads()).toHaveLength(before);
    // A historical version belonging only to another document is never used as the source snapshot.
    const other = await imported(); const wrongVersion = await app.inject({ method: 'POST', url: `/api/v1/docs/${other.id}/comments`, headers: headers(commenter), payload: { body: 'Wrong history', anchor: { moduleId: other.modules[0]!.id, version } } });
    expect(wrongVersion.statusCode).toBe(400); expect(wrongVersion.json().error.code).toBe('INVALID_ANCHOR_VERSION');
  });

  it('AT-08 rejects fabricated fields, quotes, contexts and nodes without silently creating module ' +
     'comments', async () => {
    const other = await imported('<h2>Other</h2><p>target</p>'); const base = paragraphAnchor();
    const bad: Array<[Anchor, string]> = [
      [{ ...base, field: 'notAField' }, 'INVALID_ANCHOR_FIELD'],
      [{ ...base, field: 'title' }, 'INVALID_ANCHOR_FIELD'],
      [{ ...base, quote: 'targat' }, 'ANCHOR_QUOTE_MISMATCH'],
      [{ ...base, prefix: 'fabricated' }, 'ANCHOR_QUOTE_MISMATCH'],
      [{ ...base, suffix: 'fabricated' }, 'ANCHOR_QUOTE_MISMATCH'],
      [{ ...base, blockId: other.modules[0]!.blocks[0]!.id }, 'ANCHOR_NOT_FOUND'],
      [{ ...base, blockId: '' }, 'ANCHOR_NOT_FOUND'],
      [{ ...base, blockId: content.modules[1]!.blocks[0]!.id }, 'ANCHOR_NOT_FOUND'],
      [{ ...base, moduleId: other.modules[0]!.id }, 'ANCHOR_NOT_FOUND'],
      [{ ...tableAnchor(), field: 'cell:n_zzzzzzzz' }, 'INVALID_ANCHOR_FIELD'],
      [{ moduleId: base.moduleId, quote: 'target', version }, 'INVALID_ANCHOR_FIELD'],
    ];
    for (const [anchor, code] of bad) { const response = await add(anchor); expect(response.statusCode, response.body).toBe(400); expect(response.json().error.code).toBe(code); }
    expect(await threads()).toHaveLength(0);
    const created = (await add(base)).json().comment.id as string;
    const relocate = (anchor: Anchor, cookie = owner) => app.inject({ method: 'POST', url: `/api/v1/comments/${created}/relocate`, headers: headers(cookie), payload: { anchor } });
    expect((await relocate(tableAnchor(), commenter)).statusCode).toBe(403);
    expect((await relocate({ ...base, quote: 'targat' })).json().error.code).toBe('ANCHOR_QUOTE_MISMATCH');
    expect((await relocate(tableAnchor())).json().thread).toMatchObject({ anchorState: 'ok', anchor: { version: 1, blockId: table().rows[0]!.id } });
  });

  it('AT-11 enforces viewer, session, PAT scope, document restriction and AI gates before ' +
     'accepting selections', async () => {
    const anchor = paragraphAnchor();
    expect((await add(anchor, '')).statusCode).toBe(401);
    expect((await add(anchor, viewer)).statusCode).toBe(403);
    const read = await token(['read']); const comment = await token(['comment']); const elsewhere = await token(['comment'], ['d_aaaaaaab']);
    const usingToken = (authorization: { authorization: string }) => app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/comments`, headers: authorization, payload: { body: 'Token comment', anchor } });
    expect((await usingToken(comment)).json().error.code).toBe('AI_DISABLED');
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/docs/${content.id}`, headers: headers(owner), payload: { aiEnabled: true } })).statusCode).toBe(200);
    expect((await usingToken(read)).json().error.code).toBe('TOKEN_SCOPE');
    expect((await usingToken(elsewhere)).statusCode).toBe(404);
    const permitted = await usingToken(comment); expect(permitted.statusCode, permitted.body).toBe(201); expect(permitted.json().comment.anchorState).toBe('ok');
    const relocate = await app.inject({ method: 'POST', url: `/api/v1/comments/${permitted.json().comment.id}/relocate`, headers: comment, payload: { anchor } });
    expect(relocate.statusCode).toBe(403); expect(relocate.json().error.code).toBe('TOKEN_SCOPE');
    expect(await threads()).toHaveLength(1);
  });

  it('binds an AI request to the relocated module when a selected block moved after the reader loaded it', async () => {
    const old = paragraphAnchor(); const moved = content.modules[0]!.blocks.shift()!; const destination = content.modules[1]!; destination.blocks.push(moved); await publish();
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/docs/${content.id}`, headers: headers(owner), payload: { aiEnabled: true } })).statusCode).toBe(200);
    const requested = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/comments`, headers: headers(commenter), payload: { body: '@[AI](ai) Improve the selected passage', anchor: old } });
    expect(requested.statusCode, requested.body).toBe(201);
    expect(requested.json().comment).toMatchObject({ anchorState: 'ok', anchor: { moduleId: destination.id, blockId: moved.id, version: 2 } });
    expect(requested.json().aiTask.moduleIds).toEqual([destination.id]);
  });

  it('AT-32 limits verified guest selections to the exact snapshot exposed by a pinned share link', async () => {
    const old = paragraphAnchor(); paragraph().text = [{ t: 'right replacement end' }]; await publish();
    const link = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/share-links`, headers: headers(owner), payload: { role: 'commenter', versionPin: 1 } });
    expect(link.statusCode, link.body).toBe(201); const token = new URL(link.json().link.url).pathname.split('/').pop()!; const path = `/api/v1/s/${token}`;
    const started = await app.inject({ method: 'POST', url: `${path}/verify/start`, headers: headers(), payload: { email: 'guest@example.com', name: 'Guest', locale: 'en' } });
    expect(started.statusCode, started.body).toBe(202);
    await createOutboxWorker(db, { async send(mail) { sent.push(mail); } }, origin, Date.now, secretKey).tick();
    const code = sent.filter((mail) => mail.to === 'guest@example.com').at(-1)!.text.match(/\b\d{6}\b/)![0];
    const verified = await app.inject({ method: 'POST', url: `${path}/verify/finish`, headers: headers(), payload: { challengeId: started.json().challengeId, code } });
    expect(verified.statusCode, verified.body).toBe(200); const cookie = (verified.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
    const guestComment = (anchor: Anchor) => app.inject({ method: 'POST', url: `${path}/comments`, headers: headers(cookie), payload: { body: 'Visible selection', anchor } });
    const accepted = await guestComment(old); expect(accepted.statusCode, accepted.body).toBe(201); expect(accepted.json().comment).toMatchObject({ anchorState: 'ok', anchor: { quote: 'target', version: 1 } });
    for (const anchor of [{ ...old, version: 2 }, { ...old, version: 999 }]) { const denied = await guestComment(anchor); expect(denied.statusCode).toBe(400); expect(denied.json().error.code).toBe('INVALID_ANCHOR_VERSION'); expect(denied.body).not.toContain('replacement'); }
    expect((await guestComment({ ...old, version: undefined, quote: 'replacement' })).json().error.code).toBe('ANCHOR_QUOTE_MISMATCH');
    expect((await guestComment({ ...old, field: 'notAField' })).json().error.code).toBe('INVALID_ANCHOR_FIELD');
  });

  it('AT-32 projects published selections and their contexts into pinned v1 without changing ' +
     'stored v2 anchors', async () => {
    const selected = (await add(paragraphAnchor())).json().comment.id as string;
    const selectedCell = (await add(tableAnchor())).json().comment.id as string;
    const pin = await share(1); const current = await share();
    paragraph().text = [{ t: 'right targat end' }];
    table().rows[0]!.cells[table().columns[0]!.id]!.unshift({ t: 'FUTURE_CONTEXT ' }); await publish();
    const before = savedAnchors(); expect(JSON.stringify(before)).toContain('FUTURE_CONTEXT'); expect(JSON.stringify(before)).toContain('targat');
    const pinned = await app.inject({ method: 'GET', url: `${pin}/comments` }); expect(pinned.statusCode, pinned.body).toBe(200);
    const projected = pinned.json().threads.find((item: { root: { id: string } }) => item.root.id === selected);
    expect(projected).toMatchObject({ anchorState: 'ok', range: { start: 6, end: 12 }, root: { anchorState: 'ok', range: { start: 6, end: 12 }, anchor: { version: 1, quote: 'target', prefix: 'right ', suffix: ' end' } } });
    const projectedCell = pinned.json().threads.find((item: { root: { id: string } }) => item.root.id === selectedCell);
    expect(projectedCell.root.anchor).toMatchObject({ version: 1, quote: '🌍 粗体\n结尾', prefix: '前 ', suffix: ' é' });
    expect(projectedCell.range).toEqual(projectedCell.root.range); expect(projectedCell.range.start).toBe(2);
    expect(pinned.body).not.toContain('FUTURE_CONTEXT'); expect(pinned.body).not.toContain('targat');
    const latest = await app.inject({ method: 'GET', url: `${current}/comments` }); expect(latest.statusCode).toBe(200);
    expect(latest.json().threads.find((item: { root: { id: string } }) => item.root.id === selected).root.anchor).toMatchObject({ version: 2, quote: 'targat' });
    expect(latest.body).toContain('FUTURE_CONTEXT'); expect(savedAnchors()).toEqual(before);
  });

  it('AT-32 strips unmatched future quotes, contexts and unavailable node IDs from public pinned ' +
     'responses while preserving only visible discussion bodies and guest replies', async () => {
    const visible = await add(); expect(visible.statusCode).toBe(201);
    const pin = await share(1, 'commenter'); const oldModule = content.modules[0]!.id; const oldBlock = paragraph().id;
    paragraph().text = [{ t: 'FUTURE_PREFIX CLASSIFIED_PHRASE FUTURE_SUFFIX' }];
    content.modules[0]!.blocks.push({ id: 'n_xxxxxxxx', type: 'paragraph', text: [{ t: 'UNPUBLISHED_BLOCK_SECRET' }] });
    content.modules.push({ id: 'm_zzzzzzzz', title: 'Future module', blocks: [{ id: 'n_yyyyyyyy', type: 'paragraph', text: [{ t: 'UNPUBLISHED_MODULE_SECRET' }] }] }); await publish();
    const changed = await add({ moduleId: oldModule, blockId: oldBlock, field: 'text', quote: 'CLASSIFIED_PHRASE', prefix: 'FUTURE_PREFIX ', suffix: ' FUTURE_SUFFIX', version });
    const missingBlock = await add({ moduleId: oldModule, blockId: 'n_xxxxxxxx', field: 'text', quote: 'UNPUBLISHED_BLOCK_SECRET', version });
    const missingModule = await add({ moduleId: 'm_zzzzzzzz', blockId: 'n_yyyyyyyy', field: 'text', quote: 'UNPUBLISHED_MODULE_SECRET', version });
    for (const response of [changed, missingBlock, missingModule]) expect(response.statusCode, response.body).toBe(201);
    const replyBody = 'This discussion body is intentionally public and must remain unchanged.';
    const reply = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/comments`, headers: headers(commenter), payload: { parentId: changed.json().comment.id, body: replyBody } }); expect(reply.statusCode).toBe(201);
    const guestCookie = await verifyGuest(pin);
    const guestRoot = await app.inject({ method: 'POST', url: `${pin}/comments`, headers: headers(guestCookie), payload: { body: 'External guest on pinned v1' } });
    expect(guestRoot.statusCode).toBe(201);
    const guestReply = await app.inject({ method: 'POST', url: `/api/v1/docs/${content.id}/comments`, headers: headers(commenter), payload: { parentId: guestRoot.json().comment.id, body: replyBody } });
    expect(guestReply.statusCode).toBe(201);
    const before = savedAnchors(); const response = await app.inject({ method: 'GET', url: `${pin}/comments`, headers: { cookie: guestCookie } }); expect(response.statusCode, response.body).toBe(200);
    const projected = (id: string) => response.json().threads.find((item: { root: { id: string } }) => item.root.id === id);
    for (const future of [changed, missingBlock, missingModule]) expect(projected(future.json().comment.id)).toBeUndefined();
    expect(projected(visible.json().comment.id).root.body).toBe('A selected passage');
    expect(projected(guestRoot.json().comment.id).root.body).toBe('External guest on pinned v1');
    expect(projected(guestRoot.json().comment.id).replies).toMatchObject([{ id: guestReply.json().comment.id, body: replyBody, anchor: {} }]);
    expect(projected(guestRoot.json().comment.id).replies).toHaveLength(1);
    for (const item of response.json().threads) {
      expect(item.range).toBeUndefined(); expect(item.root.range).toBeUndefined();
      for (const field of ['quote', 'prefix', 'suffix']) expect(item.root.anchor[field]).toBeUndefined();
    }
    for (const secret of ['FUTURE_PREFIX', 'CLASSIFIED_PHRASE', 'FUTURE_SUFFIX', 'UNPUBLISHED_BLOCK_SECRET', 'UNPUBLISHED_MODULE_SECRET', 'n_xxxxxxxx', 'm_zzzzzzzz', 'n_yyyyyyyy']) expect(response.body).not.toContain(secret);
    expect(savedAnchors()).toEqual(before);
  });

  it('AT-32 does not invent a reverse location after publication has already removed a deleted ' +
     'block ID', async () => {
    const anchor = paragraphAnchor(); const selected = (await add(anchor)).json().comment.id as string; const pin = await share(1);
    content.modules[0]!.blocks.shift(); await publish();
    const before = savedAnchors(); const stored = (before as Array<{ id: string; anchor: string; anchor_state: string }>).find((item) => item.id === selected)!;
    expect(stored.anchor_state).toBe('block_deleted'); expect(JSON.parse(stored.anchor).blockId).toBeUndefined(); expect(JSON.parse(stored.anchor).quote).toBe('target');
    const response = await app.inject({ method: 'GET', url: `${pin}/comments` });
    expect(response.json().threads[0]).toMatchObject({ anchorState: 'block_deleted', root: { anchorState: 'block_deleted', anchor: { moduleId: anchor.moduleId, version: 1 } } });
    expect(response.json().threads[0].root.anchor).toEqual({ moduleId: anchor.moduleId, version: 1 });
    expect(response.json().threads[0].range).toBeUndefined(); expect(response.json().threads[0].root.range).toBeUndefined(); expect(savedAnchors()).toEqual(before);
  });

  it('AT-32 projects a newly created old-pin guest selection when the current-version share reads ' +
     'it', async () => {
    const old = paragraphAnchor(); paragraph().text = [{ t: 'new right targat end' }]; await publish();
    const pinned = await share(1, 'commenter'); const current = await share(); const guest = await verifyGuest(pinned);
    const added = await app.inject({ method: 'POST', url: `${pinned}/comments`, headers: headers(guest), payload: { body: 'From the older shared version', anchor: old } });
    expect(added.statusCode, added.body).toBe(201); expect(added.json().comment.anchor).toMatchObject({ version: 1, quote: 'target' });
    const before = savedAnchors(); const response = await app.inject({ method: 'GET', url: `${current}/comments` }); expect(response.statusCode, response.body).toBe(200);
    expect(response.json().threads[0]).toMatchObject({ anchorState: 'ok', range: { start: 10, end: 16 }, root: { anchorState: 'ok', range: { start: 10, end: 16 }, anchor: { version: 2, quote: 'targat', prefix: 'new right ', suffix: ' end' } } });
    const unchangedPin = await app.inject({ method: 'GET', url: `${pinned}/comments`, headers: headers(guest) });
    expect(unchangedPin.json().threads[0]).toMatchObject({ anchorState: 'ok', range: { start: 6, end: 12 }, root: { anchor: { version: 1, quote: 'target' } } });
    expect(savedAnchors()).toEqual(before);
  });
});
