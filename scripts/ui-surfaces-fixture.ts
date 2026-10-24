import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import fastifyStatic from '@fastify/static';
import { createApp } from '../packages/server/src/app';
import { openDatabase } from '../packages/server/src/db';
import { issueInvitation } from '../packages/server/src/accounts';
import type { Block, Document } from '../packages/core/src/model';

export const documentId = 'd_aaaaaaab';
export const showcaseId = 'd_aaaaaaad';
const owner = 'u_owner000000';
const at = '2026-10-24T08:00:00.000Z';
let sequence = 0;
const nodeId = () => `n_${(++sequence).toString(2).padStart(8, '0').replaceAll('0', 'a').replaceAll('1', 'b')}`;
const paragraph = (text: string): Block => ({ id: nodeId(), type: 'paragraph', text: [{ t: text }] });

function showcase(base: Document): Document {
  const category = nodeId();
  const category2 = nodeId();
  const column = nodeId();
  const blocks: Block[] = [
    { id: nodeId(), type: 'kpis', items: [
      { id: nodeId(), label: '有效回访', value: '68%', delta: '+12%', tone: 'good' },
      { id: nodeId(), label: '流失率', value: '8%', delta: '-3%', tone: 'bad' },
    ] },
    { id: nodeId(), type: 'chart', kind: 'bar', title: '渠道回访率', unit: '%',
      categories: [{ id: category, label: '自然增长' }, { id: category2, label: '朋友推荐' }],
      series: [{ id: nodeId(), name: '本季度', values: { [category]: 48, [category2]: 68 } }] },
    { id: nodeId(), type: 'chart', kind: 'line', title: '每周趋势', unit: '%',
      categories: [{ id: nodeId(), label: '第一周' }, { id: nodeId(), label: '第二周' }], series: [] },
    { id: nodeId(), type: 'timeline', items: [
      { id: nodeId(), label: '第一周', title: '建立基线', text: [{ t: '分析首次体验和用户回访。' }] },
      { id: nodeId(), label: '第二周', title: '验证改进', text: [{ t: '观察触达时机与留存指标。' }] },
    ] },
    { id: nodeId(), type: 'columns', ratio: '1:1', cols: [
      { id: nodeId(), blocks: [paragraph('左栏：结构清晰的增长假设。') as never] },
      { id: nodeId(), blocks: [paragraph('右栏：持续验证的关键指标。') as never] },
    ] },
    { id: nodeId(), type: 'cards', perRow: 2, items: [
      { id: nodeId(), title: '稳定体验', blocks: [paragraph('关注首月回访。') as never] },
      { id: nodeId(), title: '有效触达', blocks: [paragraph('用真实用户反馈改善流程。') as never] },
    ] },
    { id: nodeId(), type: 'list', ordered: false, items: [
      { id: nodeId(), text: [{ t: '确定本周目标' }], items: [
        { id: nodeId(), text: [{ t: '补充验证标准' }], items: [] },
      ] },
    ] },
    { id: nodeId(), type: 'table', caption: '关键数据',
      columns: [{ id: column, header: [{ t: '观察指标' }], align: 'left' }],
      rows: [{ id: nodeId(), cells: { [column]: [{ t: '回访体验' }] } }] },
    { id: nodeId(), type: 'image', asset: null, alt: '本地未上传图片的真实空状态', caption: '图片上传区', width: 'normal' },
  ];
  return { ...base, id: showcaseId, title: '阅读与编辑块验收', modules: [
    { id: 'm_aaaaaaac', title: '内容块展示', blocks },
  ] };
}

/** Every matrix uses an isolated real server/database; no mocked frontend or remote service. */
export async function createSurfaceFixture() {
  sequence = 0;
  const directory = mkdtempSync(join(tmpdir(), 'hcd-ui-surfaces-'));
  const db = openDatabase(join(directory, 'hcd.sqlite'));
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const secretKey = 'disposable-ui-surfaces-fixture-secret';
  const app = createApp({ db, dataDir: directory, seed: true, appUrl: origin, secretKey,
    mailDelivery: { async send() { /* Local sink: never delivers real email. */ } },
    exports: { autoStart: false }, logger: { level: 'silent' } });
  // The real administration page is visible to a seeded administrator only.
  db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(owner);
  const stored = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(documentId) as { content: string };
  const original = JSON.parse(stored.content) as Document;
  const second = structuredClone(original);
  const text = second.modules[0]!.blocks.find((block) => block.type === 'paragraph');
  assert(text?.type === 'paragraph');
  text.text = [...text.text, { t: ' 第二版补充：先验证用户回访的触发时机。' }];
  db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,2,\'publish\',?,?,?)')
    .run(documentId, JSON.stringify(second), owner, at);
  db.prepare('UPDATE documents SET current_version=2 WHERE id=?').run(documentId);
  const blockDocument = showcase(original);
  db.prepare('INSERT INTO documents(id,space_id,title,current_version,ai_enabled,created_by,created_at,updated_at) VALUES(?,?,?,1,1,?,?,?)')
    .run(showcaseId, 'sp_demo000000', blockDocument.title, owner, at, at);
  db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,1,\'create\',?,?,?)')
    .run(showcaseId, JSON.stringify(blockDocument), owner, at);
  for (const [i, kind] of ['mention', 'submission_pending', 'ai_task_done'].entries())
    db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,read_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(`nt_ui_${i}`, owner, documentId, kind, JSON.stringify({ docTitle: original.title,
        actor: { name: '周予安' }, version: 2, reason: '请查看本地验收数据中的最新进展。' }), i === 2 ? at : null, at);
  for (const [i, status] of ['requested', 'approved', 'failed'].entries())
    db.prepare('INSERT INTO ai_tasks(id,doc_id,requested_by,kind,status,instruction,module_ids,attempts,created_at,updated_at,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(`at_ui_${i}`, documentId, owner, 'edit', status,
        '请补充回访触发条件、验证标准和可执行的后续步骤。', JSON.stringify([original.modules[0]!.id]), i, at, at,
        status === 'failed' ? 'CLAIM_EXPIRED' : null);
  const invite = issueInvitation(db, 'u_editor00000', 'invite', owner, { secretKey, appUrl: origin });
  const reset = issueInvitation(db, 'u_editor_e000', 'reset', owner, { secretKey, appUrl: origin });
  await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/', wildcard: false });
  app.setNotFoundHandler((request, reply) => request.headers.accept?.includes('text/html')
    ? reply.type('text/html').sendFile('index.html') : reply.code(404).send({ error: { code: 'NOT_FOUND' } }));
  await app.listen({ host: '127.0.0.1', port });
  return { app, db, origin, invite, reset, async close() {
    await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  } };
}

export type SurfaceFixture = Awaited<ReturnType<typeof createSurfaceFixture>>;
