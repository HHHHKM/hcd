import { isInternalRequest, requestActors } from './internal-request';
import { base32, personalAccessToken, PERSONAL_ACCESS_TOKEN_BYTES } from '../../core/src/tokens';
import { diffValues } from './legacy-diff';
import { createChangeWorker } from './change-worker-client';
import { submissionChanges, captureReviewPresentation, type ReviewPresentationInput } from './change-presentation';
import { mergeOperationSubmission, MergeValidationError, type MergeConflict, type MergeResolution, type MergeItem } from '../../core/src/merge';
import type { Op } from '../../core/src/ops';
import { SubmissionInputError, parseSubmissionInput, materializeSubmission, submissionRequestFingerprint } from './submission-input';
import { AiTaskError, adoptAiResolution, createResolveAiTask, suggestAiResolution, addSystemReply, claimAiTask, completeAiTask, expireAiTasks, failAiTask, getAiTask, publicAiTask, taskStatuses, validateTaskSubmission, type AiTask } from './ai-tasks';
import { canAccessExport, createExportWorker, type ExportJob, type ExportOptions } from './exports';
import { buildExport, ExportError } from './export-content';
import { runMaintenance } from './maintenance';
import { createFeishuTransport, createIntegrationStore, integrationCard, IntegrationError, type FeishuOptions, type IntegrationKind } from './feishu';
import { createFeishuWorker } from './feishu-worker';
import { createDigestScheduler } from './digests';
import { createGuestAccess, registerGuestVerification } from './guests';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest, type FastifyBaseLogger } from 'fastify';
import pino, { type LoggerOptions, type DestinationStream } from 'pino';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { AnchorSchema, relocateAnchor, type Anchor, type AnchorState } from '../../core/src/anchors';
import { projectCommentAnchor, validateCommentAnchor } from './comment-anchor';
import { AssetError, createAssetStore, imageAssetIds, documentAssetIds, assetBlocks, maxAssetBytes } from './assets';
import { enqueueSecurityMail } from './security-mail';
import { createOutboxWorker, mailEvents, notificationPreferences, type MailDelivery, type MailEvent } from './outbox';
import { registerRenderOrigin } from './render-origin';
import { createRateLimiter } from './rate-limit';
import { stageImportImages } from './import-images';
import { ArchiveError, archiveLimits, inspectArchive, sha256 } from './archive';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { parseFragment } from 'parse5';
import { canonicalJson, canonicalizeDocument, validateDocument, type Document, type Block, type Inline, type TextRun } from '../../core/src/model';
import { SnapshotConversionError, snapshotToOperations } from '../../core/src/snapshot-ops';
import { markUncertainOperations } from '../../core/src/reconcile';
import { parseSpecDocument } from '../../core/src/spec-html';
import { isImportTreeBounded, recognizeDataGroup } from '../../core/src/import-patterns';
import { openDatabase, type HcdDatabase } from './db';
import { issueInvitation, pendingPasswordHash } from './accounts';
import { mcpSpec } from './mcp-spec';
import { registerOAuth, revokeOAuthGrant, type OAuthOptions } from './oauth';
import { registerCliAuth, type CliAuthOptions } from './cli-auth';

type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
type Scope = 'read' | 'comment' | 'submit' | 'ai_tasks' | 'preview';
type TokenScopes = Set<Scope> & { docIds: Set<string> | null; oauth: boolean; tokenId: string };
type User = { id: string; email: string; name: string; locale: string; is_admin: number };
type AppOptions = { trustProxy?: false | string | string[]; logger?: LoggerOptions; logStream?: DestinationStream; cliAuth?: CliAuthOptions; oauth?: OAuthOptions; exports?: ExportOptions & { autoStart?: boolean }; feishu?: FeishuOptions; mailDigestTimeZone?: string; mailDigestHour?: number; mailDelivery?: MailDelivery; renderUrl?: string; dataDir?: string; databasePath?: string; secretKey?: string; appUrl?: string; db?: HcdDatabase; seed?: boolean };
type Conflict = { id: string; kind: MergeConflict['kind']; path: string; moduleId: string | null; base: unknown; current: unknown; incoming: unknown; allowed: string[]; fingerprint?: string; resolution?: MergeResolution; submissionId?: string; opIndex?: number };
type Resolution = MergeResolution;

class TemplateLogController extends LogController {
  constructor() { super({ disableRequestLogging: true }); }
}

const isoNow = () => new Date().toISOString();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const randomId = (prefix: string, length = 12) => `${prefix}_${base32(randomBytes(12)).slice(0, length)}`;
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const asJson = <T>(value: string): T => JSON.parse(value) as T;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isIdArray = (value: unknown): value is Array<Record<string, unknown>> => Array.isArray(value) && value.every((item) => isObject(item) && typeof item.id === 'string');

type HtmlNode = { nodeName: string; tagName?: string; value?: string; childNodes?: HtmlNode[]; attrs?: Array<{ name: string; value: string }> };
function importedHtml(html: string, docId: string, title: string): { content: Document; report: { removed: number; warnings: string[]; recognized?: { kpis: number; timelines: number } } } {
  const root = parseFragment(html) as unknown as HtmlNode;
  if (!isImportTreeBounded(root)) throw new HttpError(422, 'IMPORT_TOO_COMPLEX');
  if (/data-hcd\s*=\s*["']?1/i.test(html)) {
    const parsed = parseSpecDocument(html);
    if (parsed.ok) {
      const content = normalizeContent({ ...parsed.value.doc, id: docId, title }, randomNodeId, title, docId);
      const validation = validateDocument(content);
      if (!validation.ok) throw new HttpError(422, 'IMPORT_TOO_COMPLEX');
      const warnings = parsed.value.issues.map((item) => item.code);
      return { content, report: { removed: warnings.filter((code) => code.includes('unsafe')).length, warnings } };
    }
  }
  let removed = 0;
  const warnings = new Set<string>();
  const recognized = { kpis: 0, timelines: 0 };
  const nodeText = (node: HtmlNode): string => node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(nodeText).join('');
  const inline = (node: HtmlNode, marks: Partial<TextRun> = {}): Inline => {
    if (node.nodeName === '#text') return node.value ? [{ t: node.value, ...marks }] : [];
    const tag = node.tagName?.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'template') return [];
    if (tag === 'br') return [{ br: true }];
    const next: Partial<TextRun> = { ...marks };
    if (tag === 'b' || tag === 'strong') next.b = true;
    if (tag === 'i' || tag === 'em') next.i = true;
    if (tag === 'code') next.code = true;
    if (tag === 'sup') next.sup = true;
    if (tag === 'sub') next.sub = true;
    const href = node.attrs?.find((attribute) => attribute.name === 'href')?.value;
    if (tag === 'a' && href && /^(https?:|mailto:)/i.test(href)) next.href = href;
    return (node.childNodes ?? []).flatMap((child) => inline(child, next));
  };
  type Item = { heading?: string; block?: Block };
  const parseListItem = (node: HtmlNode): import('../../core/src/model').ListItem => {
    const children = node.childNodes ?? [];
    const own = children.filter((child) => child.tagName?.toLowerCase() !== 'ul' && child.tagName?.toLowerCase() !== 'ol');
    const nested = children.filter((child) => child.tagName?.toLowerCase() === 'ul' || child.tagName?.toLowerCase() === 'ol');
    const subItems = nested.flatMap((list) => (list.childNodes ?? []).filter((child) => child.tagName?.toLowerCase() === 'li').map(parseListItem));
    return { id: randomNodeId(), text: own.flatMap((child) => inline(child)), items: subItems };
  };
  const parseBlock = (node: HtmlNode): Item[] => {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript' || tag === 'link' || tag === 'meta' || tag === 'base') { removed += 1; return []; }
    if (node.nodeName === '#text') {
      const text = (node.value ?? '').trim();
      return text ? [{ block: { id: randomNodeId(), type: 'paragraph', text: [{ t: text }] } }] : [];
    }
    if (!tag) return (node.childNodes ?? []).flatMap(parseBlock);
    const rawAsset = node.attrs?.find((attribute) => attribute.name === 'data-hcd-raw-asset')?.value;
    if (rawAsset) return [{ block: { id: randomNodeId(), type: 'raw', asset: rawAsset, height: 480, allowScripts: false, note: node.attrs?.find((attribute) => attribute.name === 'data-reason')?.value ?? '' } }];
    const dataGroup = recognizeDataGroup(node, randomNodeId);
    if (dataGroup) { recognized[dataGroup.type === 'kpis' ? 'kpis' : 'timelines'] += 1; return [{ block: dataGroup }]; }
    if (tag === 'pre') {
      const text: Inline = [];
      nodeText(node).split(/\r?\n/).forEach((line, index) => { if (index) text.push({ br: true }); if (line) text.push({ t: line, code: true }); });
      return [{ block: { id: randomNodeId(), type: 'paragraph', text } }];
    }
    if (tag === 'figure') {
      const image = (node.childNodes ?? []).find((child) => child.tagName === 'img');
      if (image) {
        const caption = (node.childNodes ?? []).find((child) => child.tagName === 'figcaption');
        return [{ block: { id: randomNodeId(), type: 'image', asset: image.attrs?.find((attribute) => attribute.name === 'src')?.value.startsWith('asset:') ? image.attrs.find((attribute) => attribute.name === 'src')!.value.slice(6) : null, alt: image.attrs?.find((attribute) => attribute.name === 'alt')?.value ?? '', caption: caption ? nodeText(caption).trim() : '', width: 'normal' } }];
      }
    }
    if (tag === 'h1' || tag === 'h2') {
      const heading = nodeText(node).trim();
      return heading ? [{ heading }] : [];
    }
    if (['h3', 'h4', 'h5', 'h6'].includes(tag)) return [{ block: { id: randomNodeId(), type: 'heading', level: tag === 'h3' ? 3 : 4, text: inline(node) } }];
    if (tag === 'p') {
      const result: Item[] = []; let text: Inline = [];
      const flush = () => { if (text.length) result.push({ block: { id: randomNodeId(), type: 'paragraph', text } }); text = []; };
      for (const child of node.childNodes ?? []) {
        if (child.tagName === 'img' || child.attrs?.some((attr) => attr.name === 'data-hcd-raw-asset')) { flush(); result.push(...parseBlock(child)); } else text.push(...inline(child));
      }
      flush(); return result;
    }
    if (tag === 'blockquote') return [{ block: { id: randomNodeId(), type: 'quote', text: inline(node) } }];
    if (tag === 'hr') return [{ block: { id: randomNodeId(), type: 'divider' } }];
    if (tag === 'ul' || tag === 'ol') return [{ block: { id: randomNodeId(), type: 'list', ordered: tag === 'ol', items: (node.childNodes ?? []).filter((child) => child.tagName?.toLowerCase() === 'li').map(parseListItem) } }];
    if (tag === 'img') {
      const alt = node.attrs?.find((attribute) => attribute.name === 'alt')?.value ?? '';
      return [{ block: { id: randomNodeId(), type: 'image', asset: node.attrs?.find((attribute) => attribute.name === 'src')?.value.startsWith('asset:') ? node.attrs.find((attribute) => attribute.name === 'src')!.value.slice(6) : null, alt, caption: '', width: 'normal' } }];
    }
    if (tag === 'table') {
      const rows = (node.childNodes ?? []).flatMap((child) => child.tagName?.toLowerCase() === 'tr' ? [child] : child.childNodes ?? []).filter((child) => child.tagName?.toLowerCase() === 'tr');
      const columns: import('../../core/src/model').TableColumn[] = [];
      const dataRows: import('../../core/src/model').TableRow[] = [];
      for (const [rowIndex, row] of rows.entries()) {
        const cells = (row.childNodes ?? []).filter((child) => ['th', 'td'].includes(child.tagName?.toLowerCase() ?? ''));
        if (rowIndex === 0 && cells.some((cell) => cell.tagName?.toLowerCase() === 'th')) {
          for (const cell of cells) columns.push({ id: randomNodeId(), header: inline(cell), align: 'left' });
        } else {
          if (!columns.length && cells.length) cells.forEach((_, index) => columns.push({ id: randomNodeId(), header: [{ t: `Column ${index + 1}` }], align: 'left' }));
          const values: Record<string, Inline> = {};
          cells.forEach((cell, index) => { const column = columns[index]; if (column) values[column.id] = inline(cell); });
          dataRows.push({ id: randomNodeId(), cells: values });
        }
      }
      if (!columns.length) { warnings.add('A table without headers was converted to readable paragraphs.'); return rows.map((row) => ({ block: { id: randomNodeId(), type: 'paragraph', text: inline(row) } })); }
      return [{ block: { id: randomNodeId(), type: 'table', caption: '', columns, rows: dataRows } }];
    }
    // Preserve readable text from unknown markup, while never carrying source tags or attributes into the document.
    const meaningful = (node.childNodes ?? []).flatMap(parseBlock);
    if (meaningful.length) { if (!['div', 'section', 'article', 'main', 'header', 'footer', 'ul', 'ol', 'li', 'thead', 'tbody'].includes(tag)) warnings.add(`Unsupported <${tag}> markup was removed; its readable text was kept.`); return meaningful; }
    const text = nodeText(node).trim();
    if (text) { warnings.add(`Unsupported <${tag}> markup was removed; its readable text was kept.`); return [{ block: { id: randomNodeId(), type: 'paragraph', text: [{ t: text }] } }]; }
    return [];
  };
  const scan = (node: HtmlNode) => {
    for (const attribute of node.attrs ?? []) {
      if (attribute.name.startsWith('on') || (attribute.name === 'href' && /^\s*javascript:/i.test(attribute.value))) removed += 1;
    }
    (node.childNodes ?? []).forEach(scan);
  };
  scan(root);
  const items = (root.childNodes ?? []).flatMap(parseBlock);
  const modules: Document['modules'] = [];
  let active: Document['modules'][number] = { id: `m_${base32(randomBytes(5)).slice(0, 8)}`, title: 'Imported content', blocks: [] };
  for (const item of items) {
    if (item.heading !== undefined) {
      if (active.blocks.length || active.title !== 'Imported content') modules.push(active);
      active = { id: `m_${base32(randomBytes(5)).slice(0, 8)}`, title: item.heading.slice(0, 200), blocks: [] };
    } else if (item.block) active.blocks.push(item.block);
  }
  if (active.blocks.length || !modules.length) modules.push(active);
  const content = canonicalizeDocument({ schemaVersion: 1, id: docId, title, theme: { id: 'default', version: 1, overrides: {} }, modules });
  if (!validateDocument(content).ok) throw new HttpError(422, 'IMPORT_TOO_COMPLEX');
  if (removed) warnings.add(`${removed} unsafe scripts, attributes, or metadata item(s) were removed.`);
  if (!items.length) warnings.add('No supported content was found; an empty module was created.');
  return { content, report: { removed, warnings: [...warnings], recognized } };
}

function normalizeContent(input: unknown, ids: () => string, title?: string, expectedDocId?: string): Document {
  const value = isObject(input) ? clone(input) as Record<string, unknown> : {};
  const doc = {
    schemaVersion: 1 as const,
    id: expectedDocId ?? (typeof value.id === 'string' && /^d_[a-z2-7]{8}$/.test(value.id) ? value.id : `d_${base32(randomBytes(5)).slice(0, 8)}`),
    title: (title ?? (typeof value.title === 'string' ? value.title : 'Untitled document')).slice(0, 200),
    theme: isObject(value.theme) ? value.theme : { id: 'default', version: 1, overrides: {} },
    modules: Array.isArray(value.modules) ? value.modules : [],
  } as unknown as Document;
  const seen = new Set<string>([doc.id]);
  const assign = (node: Record<string, unknown>, prefix: 'm' | 'n') => {
    const current = node.id;
    if (typeof current !== 'string' || !new RegExp(`^${prefix}_[a-z2-7]{8}$`).test(current) || seen.has(current)) node.id = prefix === 'm' ? `m_${base32(randomBytes(5)).slice(0, 8)}` : ids();
    seen.add(node.id as string);
  };
  const walkLeaf = (block: Record<string, unknown>) => {
    assign(block, 'n');
    for (const listKey of ['items', 'columns', 'rows', 'categories', 'series']) {
      const list = block[listKey];
      if (!Array.isArray(list)) continue;
      for (const child of list) {
        if (!isObject(child)) continue;
        assign(child, 'n');
        if (isIdArray(child.items)) child.items.forEach((item) => assign(item, 'n'));
      }
    }
    if (isIdArray(block.items)) block.items.forEach((item) => {
      if (isIdArray(item.blocks)) item.blocks.forEach((child) => walkLeaf(child));
    });
    if (isIdArray(block.cols)) block.cols.forEach((column) => {
      assign(column, 'n');
      if (isIdArray(column.blocks)) column.blocks.forEach((child) => walkLeaf(child));
    });
  };
  for (const module of doc.modules) {
    assign(module as unknown as Record<string, unknown>, 'm');
    for (const block of module.blocks) walkLeaf(block as unknown as Record<string, unknown>);
  }
  return canonicalizeDocument(doc);
}

function createSeedDocument(id: string, title: string): Document {
  const mk = (id: string, type: string, extra: Record<string, unknown> = {}): Block => ({ id, type, ...extra } as Block);
  return {
    schemaVersion: 1, id, title, theme: { id: 'default', version: 1, overrides: { accent: '#d7a84e' } },
    modules: [
      { id: 'm_aaaaaaaa', title: '背景与机会', blocks: [mk('n_aaaaaaaa', 'heading', { level: 3, text: [{ t: '让好奇心变成习惯' }] }), mk('n_aaaaaaab', 'paragraph', { text: [{ t: '本季度重点提升新用户第 7 天留存。我们已经找到足够多的人，下一步要让第一次体验自然地连向第二次打开。' }] }), mk('n_aaaaaaac', 'paragraph', { text: [{ t: '把「我知道这个产品」变成「我愿意一直用它」，需要产品、内容与运营在同一条节奏上。' }] })] },
      { id: 'm_aaaaaaab', title: '季度目标', blocks: [mk('n_aaaaaaad', 'paragraph', { text: [{ t: '围绕新用户首月体验，我们把结果定义成可以共同追踪的信号。' }] }), mk('n_aaaaaaae', 'kpis', { items: [{ id: 'n_aaaaaaaf', label: '日活跃用户', value: '15 万', delta: '+18%', tone: 'good' }, { id: 'n_aaaaaaag', label: '7 日留存', value: '28%', delta: '+4.2pt', tone: 'good' }, { id: 'n_aaaaaaah', label: '平均收入 / 用户', value: '¥3.2', delta: '+0.6', tone: 'neutral' }, { id: 'n_aaaaaaai', label: '付费转化', value: '2.1%', delta: '+0.4pt', tone: 'good' }] })] },
      { id: 'm_aaaaaaac', title: '用户与洞察', blocks: [mk('n_aaaaaaaj', 'paragraph', { text: [{ t: '新用户更愿意相信来自朋友与真实体验的推荐。我们要让这类信任更早出现，也更容易传递。' }] }), mk('n_aaaaaaak', 'chart', { kind: 'bar', title: '新用户首次触达来源', unit: '%', categories: [{ id: 'n_aaaaaaal', label: '应用商店' }, { id: 'n_aaaaaaam', label: '朋友推荐' }, { id: 'n_aaaaaaan', label: '内容投放' }], series: [{ id: 'n_aaaaaaao', name: '新增占比', values: { n_aaaaaaal: 52, n_aaaaaaam: 31, n_aaaaaaan: 17 } }] })] },
      { id: 'm_aaaaaaad', title: '玩法设计', blocks: [mk('n_aaaaaaap', 'heading', { level: 3, text: [{ t: '让每一次回访都有收获' }] }), mk('n_aaaaaaaq', 'paragraph', { text: [{ t: '设计一条轻量的新手路径：先给一个小目标，再用看得见的进度告诉用户已经走了多远。' }] }), mk('n_aaaaaabq', 'callout', { tone: 'info', title: '设计原则', text: [{ t: '完成一次核心动作后，24 小时内给出与他相关的下一步。' }] })] },
      { id: 'm_aaaaaaae', title: '运营节奏', blocks: [mk('n_aaaaaaar', 'timeline', { items: [{ id: 'n_aaaaaaas', label: '10 月', title: '找到第一批同行者', text: [{ t: '邀请种子用户体验新手路径。' }] }, { id: 'n_aaaaaaat', label: '11 月', title: '让体验自己说话', text: [{ t: '上线分享卡片与轻量社群活动。' }] }, { id: 'n_aaaaaaau', label: '12 月', title: '为回访加一点仪式', text: [{ t: '发布年终回顾与个性化目标。' }] }] })] },
      { id: 'm_aaaaaaaf', title: '活动方案', blocks: [mk('n_aaaaaaav', 'cards', { perRow: 3, items: [{ id: 'n_aaaaaaaw', title: '七日新手信', blocks: [mk('n_aaaaaaax', 'paragraph', { text: [{ t: '在合适的时刻送出一条有用提示。' }] })] }, { id: 'n_aaaaaaay', title: '小目标挑战', blocks: [mk('n_aaaaaaaz', 'paragraph', { text: [{ t: '把复杂任务拆成能完成的一小步。' }] })] }] })] },
      { id: 'm_aaaaaaag', title: '数据回顾', blocks: [mk('n_aaaaaaba', 'paragraph', { text: [{ t: '渠道质量的差异正在变小；下一阶段重点从增加曝光转向提升到达后的体验。' }] }), mk('n_aaaaaabb', 'table', { caption: '渠道表现', columns: [{ id: 'n_aaaaaabc', header: [{ t: '渠道' }], align: 'left' }, { id: 'n_aaaaaabd', header: [{ t: '新增占比' }], align: 'right' }, { id: 'n_aaaaaabe', header: [{ t: '7 日留存' }], align: 'right' }], rows: [{ id: 'n_aaaaaabf', cells: { n_aaaaaabc: [{ t: '应用商店' }], n_aaaaaabd: [{ t: '52%' }], n_aaaaaabe: [{ t: '26%' }] } }, { id: 'n_aaaaaabg', cells: { n_aaaaaabc: [{ t: '社群推荐' }], n_aaaaaabd: [{ t: '31%' }], n_aaaaaabe: [{ t: '41%' }] } }] })] },
      { id: 'm_aaaaaaah', title: '预算与风险', blocks: [mk('n_aaaaaabh', 'callout', { tone: 'warn', title: '风险预案', text: [{ t: '活动高峰前提前扩容服务器，确保邀请活动开启时仍然稳定。预算预留 12% 作为弹性空间。' }] })] },
    ],
  };
}

function calculatePreview(db: HcdDatabase, docId: string, baseVersion: number, submissionIds: string[], resolutions: Record<string, Resolution>, includePresentation = false) {
  const currentRow = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=(SELECT current_version FROM documents WHERE id=?)').get(docId, docId) as { content: string };
  let candidate = asJson<Document>(currentRow.content);
  const conflicts: Conflict[] = [];
  const batchInserted = new Set<string>();
  const submissions = submissionIds.map((id) => db.prepare('SELECT * FROM submissions WHERE id=? AND doc_id=? AND status=?').get(id, docId, 'pending') as { id: string; base_version: number; content: string; created_at: string; uncertain_ids: string | null; operations: string | null } | undefined).filter((item): item is { id: string; base_version: number; content: string; created_at: string; uncertain_ids: string | null; operations: string | null } => !!item).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const items: Array<Omit<MergeItem, 'ops'> & { ops?: MergeItem['ops'] }> = [];
  for (const submission of submissions) {
    const row = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(docId, submission.base_version) as { content: string } | undefined;
    if (!row) throw new HttpError(422, 'BASE_VERSION_NOT_FOUND');
    const base = asJson<Document>(row.content);
    let ops: Op[];
    try {
      // Legacy conversion is read-only: immutable content and old receipts stay byte-for-byte intact.
      ops = submission.operations ? asJson<Op[]>(submission.operations) : snapshotToOperations(base, asJson<Document>(submission.content)).ops;
      if (!submission.operations && submission.uncertain_ids) ops = markUncertainOperations(ops, new Set(asJson<string[]>(submission.uncertain_ids)));
    } catch (error) {
      if (!(error instanceof SnapshotConversionError)) throw error;
      // An incompatible old snapshot remains inspectable/withdrawable. Never silently
      // switch back to snapshot merging or block the other submissions in this batch.
      const id = `${submission.id}:snapshot`;
      const fingerprint = hash(canonicalJson({ id, base, content: submission.content, code: error.code, details: error.details }));
      const chosen = resolutions[id];
      const resolution = chosen?.choice === 'drop' && (!chosen.fingerprint || chosen.fingerprint === fingerprint) ? chosen : undefined;
      conflicts.push({ id, submissionId: submission.id, kind: 'invalid_structure', path: '/snapshot', moduleId: null, base: null, current: null, incoming: { code: error.code, details: error.details }, allowed: ['drop'], fingerprint, ...(resolution ? { resolution } : {}) });
      items.push({ submissionId: submission.id, status: resolution ? 'resolved' : 'needs_resolution', conflictIds: [id], ops: [] });
      continue;
    }
    const result = mergeOperationSubmission(candidate, { id: submission.id, createdAt: submission.created_at, baseVersion: submission.base_version, ops }, resolutions, base, batchInserted);
    candidate = result.candidate; conflicts.push(...result.conflicts); items.push(result.item); result.inserted.forEach(id => batchInserted.add(id));
  }
  const unresolved = items.some(item => item.status === 'needs_resolution');
  return { candidate: canonicalizeDocument(candidate), candidateHash: hash(canonicalJson(candidate)), conflicts, items, publishable: !unresolved && submissions.length > 0, ...(includePresentation ? { presentationInput: captureReviewPresentation(db, docId, baseVersion, asJson<Document>(currentRow.content), candidate, items, conflicts) } : {}) };
}

function resolutionCandidate(db: HcdDatabase, docId: string, baseVersion: number, ids: string[], conflicts: Conflict[], resolutions: Record<string, Resolution>) {
  const validationChoices = { ...resolutions };
  for (const conflict of conflicts) if (!validationChoices[conflict.id]) validationChoices[conflict.id] = { choice: conflict.allowed.includes('keep_current') ? 'keep_current' : conflict.allowed.includes('drop') ? 'drop' : conflict.allowed.includes('accept') ? 'accept' : 'take_incoming' };
  return calculatePreview(db, docId, baseVersion, ids, validationChoices).candidate;
}

export function createApp(options: AppOptions = {}): FastifyInstance {
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? './data';
  const db = options.db ?? openDatabase(options.databasePath ?? join(dataDir, 'hcd.sqlite'));
  const proxySetting = options.trustProxy ?? process.env.TRUST_PROXY;
  const trustProxy = typeof proxySetting === 'string' ? proxySetting.split(',').map(value => value.trim()).filter(Boolean) : proxySetting;
  const logger: FastifyBaseLogger = pino(options.logger ?? { level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info') }, options.logStream);
  const app = Fastify({ loggerInstance: logger, logController: new TemplateLogController(), trustProxy: trustProxy && trustProxy.length ? trustProxy : false, bodyLimit: 3 * 1024 * 1024 });
  const archiveRequests = new Set<string>();
  const requestLimit = createRateLimiter();
  const changeWorker = createChangeWorker();
  async function saveReviewPresentation(previewId: string, revision: number, input: ReviewPresentationInput, request: FastifyRequest, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1], docId: string) {
    const presentation = await changeWorker.review(input);
    if (!recheckDocumentAccess(request, reply, docId, 'owner')) return null;
    // Another resolution may have advanced the preview while the display was computed.
    // Never attach an older presentation to a newer candidate or overwrite its display.
    db.prepare('UPDATE previews SET presentation=? WHERE id=? AND revision=? AND presentation IS NULL').run(JSON.stringify(presentation), previewId, revision);
    return publicPreview(db, previewId);
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.url.startsWith('/api/v1/s/')) {
      const retry = requestLimit(`guest:${request.ip}`, 60, Date.now());
      if (retry) return reply.code(429).header('Retry-After', String(retry)).send({ error: { code: 'RATE_LIMITED' } });
    }
    if (request.method === 'POST' && request.url.split('?')[0] === '/api/v1/imports/archive') {
      if (archiveRequests.size >= 2) return reply.code(429).header('Retry-After', '5').send({ error: { code: 'IMPORT_BUSY' } });
      archiveRequests.add(request.id);
    }
    if (request.url.startsWith('/api/') || request.url.startsWith('/s/')) reply.header('Cache-Control', 'no-store');
  });
  app.addHook('onResponse', async (request, reply) => {
    archiveRequests.delete(request.id);
    const route = request.routeOptions?.url ?? '<unmatched>';
    if (!requestActors.has(request) && route.startsWith('/api/v1/s/:token/') && request.cookies?.hcd_guest) {
      const link = shareLink((request.params as { token: string }).token);
      const guest = link && guestAccess.session(request, link.id);
      if (guest) requestActors.set(request, guest.guest_id);
    }
    request.log.info({ method: request.method, route, status: reply.statusCode, durationMs: Math.max(0, Math.round(reply.elapsedTime)), actorId: requestActors.get(request) ?? null, requestId: request.id }, 'request');
  });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: maxAssetBytes, files: 1, fields: 0, parts: 1 } });
  const assetStore = createAssetStore(db, dataDir);
  const exportWorker = createExportWorker(db, dataDir, { exporterUrl: process.env.EXPORTER_URL, ...options.exports });
  let exportTimer: ReturnType<typeof setInterval> | undefined;
  if (options.exports?.autoStart !== false) app.addHook('onReady', async () => {
    const tick = () => { void exportWorker.tick().catch(() => { app.log.error('Export processing failed'); }); };
    exportTimer = setInterval(tick, 2000); exportTimer.unref(); tick();
  });
  const secretKey = options.secretKey ?? process.env.SECRET_KEY ?? 'development-only-secret-key-change-me';
  const appUrl = options.appUrl ?? process.env.APP_URL ?? 'http://localhost:5173';
  const guestAccess = createGuestAccess(db, secretKey);
  const shareLink = (token: string) => db.prepare('SELECT * FROM share_links WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').get(hash(`${secretKey}:${token}`), isoNow()) as { id: string; doc_id: string; role: 'viewer' | 'commenter'; show_comments: number; version_pin: number | null } | undefined;
  const renderSigner = registerRenderOrigin(app, {
    appUrl, renderUrl: options.renderUrl ?? process.env.RENDER_URL ?? (process.env.RENDER_HOST ? `https://${process.env.RENDER_HOST}` : undefined), secret: secretKey,
    async read(assetId, kind, context) {
      if (kind === 'x') {
        const job = db.prepare('SELECT * FROM exports WHERE id=?').get(assetId) as ExportJob | undefined;
        return job ? exportWorker.read(job, context) : null;
      }
      const asset = db.prepare('SELECT id,doc_id,hash,mime,size FROM assets WHERE id=?').get(assetId) as { id: string; doc_id: string; hash: string; mime: string; size: number } | undefined;
      const staged = !asset ? db.prepare("SELECT a.id,a.hash,a.mime,a.size,i.created_by,i.space_id FROM import_assets a JOIN imports i ON i.id=a.import_id WHERE a.id=? AND i.status='ready'").get(assetId) as { id: string; hash: string; mime: string; size: number; created_by: string; space_id: string } | undefined : undefined;
      const resource = asset ?? (staged ? { ...staged, doc_id: '' } : undefined);
      if (!resource || (kind === 'raw' ? resource.mime !== 'text/html' : !resource.mime.startsWith('image/'))) return null;
      if (context.startsWith('tok_')) {
        if (!asset) return null;
        const token = db.prepare('SELECT token_hash FROM api_tokens WHERE id=?').get(context) as { token_hash: string } | undefined;
        const user = token && tokenUser(token.token_hash);
        if (!user || !roleFor(user, asset.doc_id) || user.doc_ids && !(JSON.parse(user.doc_ids) as string[]).includes(asset.doc_id)) return null;
        if (!(JSON.parse(user.scopes) as string[]).some((scope) => ['read', 'comment', 'submit', 'preview'].includes(scope))) return null;
        if (!db.prepare('SELECT 1 FROM documents WHERE id=? AND ai_enabled=1').get(asset.doc_id)) return null;
      } else if (context.startsWith('u_')) {
        const user = db.prepare('SELECT * FROM users WHERE id=? AND disabled_at IS NULL').get(context) as User | undefined;
        if (!user || (asset ? !roleFor(user, asset.doc_id) : !staged || staged.created_by !== user.id || (!user.is_admin && !db.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').get(staged.space_id, user.id)))) return null;
      } else {
        if (!asset) return null;
        const guest = context.startsWith('gs_') ? db.prepare('SELECT link_id FROM guest_sessions WHERE id=? AND expires_at>?').get(context, isoNow()) as { link_id: string } | undefined : undefined;
        if (context.startsWith('gs_') && !guest) return null;
        const snapshot = db.prepare('SELECT v.content FROM share_links l JOIN documents d ON d.id=l.doc_id JOIN versions v ON v.doc_id=d.id AND v.version=COALESCE(l.version_pin,d.current_version) WHERE l.id=? AND l.doc_id=? AND l.role=? AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>?)').get(guest?.link_id ?? context, asset.doc_id, guest ? 'commenter' : 'viewer', isoNow()) as { content: string } | undefined;
        if (!snapshot || !documentAssetIds(asJson<Document>(snapshot.content)).has(assetId)) return null;
      }
      return { bytes: await assetStore.read(resource), mime: resource.mime };
    },
  });
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    const sweep = () => { try { runMaintenance(db); } catch { app.log.error('Credential cleanup failed'); } };
    maintenanceTimer = setInterval(sweep, 60000); maintenanceTimer.unref(); sweep();
  });
  const feishu = createFeishuTransport({ baseUrl: process.env.FEISHU_BASE_URL, ...options.feishu });
  const integrations = createIntegrationStore(db, secretKey, feishu);
  const feishuWorker = createFeishuWorker(db, integrations, feishu, appUrl);
  let feishuTimer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    const tick = () => { void feishuWorker.tick().catch(() => { app.log.error('Integration delivery failed'); }); };
    feishuTimer = setInterval(tick, 30000); feishuTimer.unref(); tick();
  });
  const outbox = createOutboxWorker(db, options.mailDelivery, appUrl, Date.now, secretKey);
  let mailTimer: ReturnType<typeof setInterval> | undefined;
  const digests = options.mailDelivery ? createDigestScheduler(db, options.mailDigestTimeZone ?? process.env.MAIL_DIGEST_TIMEZONE ?? 'UTC', options.mailDigestHour ?? Number(process.env.MAIL_DIGEST_HOUR ?? 9)) : null;
  const processMail = async () => { try { digests?.enqueue(); await outbox.tick(); } catch { app.log.error('Outbox processing failed'); } };
  if (options.mailDelivery) app.addHook('onReady', async () => { mailTimer = setInterval(() => { void processMail(); }, 30000); mailTimer.unref(); void processMail(); });
  const sessionCookie = 'hcd_session';
  const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const passwordHash = (password: string, salt: string) => `${salt}:${scryptSync(password, salt, 64, scryptOptions).toString('hex')}`;
  const verifyPassword = (password: string, stored: string | null | undefined) => {
    if (!stored) return false;
    const [salt, key] = stored.split(':');
    if (!salt || !key) return false;
    const candidate = scryptSync(password, salt, 64, scryptOptions);
    const expected = Buffer.from(key, 'hex');
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  };
  const sessionSecret = (value: string) => hash(`${secretKey}:${value}`);
  const dummyPasswordHash = passwordHash('invalid-password-placeholder', 'hcd-login-dummy-salt');
  const loginLimited = (email: string, ip: string) => {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM login_attempts WHERE attempted_at<?').run(cutoff);
    const emailAttempts = (db.prepare('SELECT COUNT(*) count FROM login_attempts WHERE email=? AND attempted_at>=?').get(email, cutoff) as { count: number }).count;
    const ipAttempts = (db.prepare('SELECT COUNT(*) count FROM login_attempts WHERE ip=? AND attempted_at>=?').get(ip, cutoff) as { count: number }).count;
    return emailAttempts >= 5 || ipAttempts >= 20;
  };
  const recordLoginFailure = (email: string, ip: string) => db.prepare('INSERT INTO login_attempts(email,ip,attempted_at) VALUES(?,?,?)').run(email, ip, isoNow());
  const issueInvite = (userId: string, kind: 'invite' | 'reset', createdBy: string, lifetimeMs: number) => db.transaction(() => {
    const invite = issueInvitation(db, userId, kind, createdBy, { secretKey, appUrl, lifetimeMs });
    if (options.mailDelivery) {
      const user = db.prepare('SELECT email,locale FROM users WHERE id=?').get(userId) as { email: string; locale: string };
      enqueueSecurityMail(db, secretKey, { kind, refId: invite.id, recipient: user.email, locale: user.locale, value: invite.token, expiresAt: invite.expiresAt });
    }
    return invite;
  })();

  if (options.seed === true) seedDemo(db, passwordHash);

  function tokenUser(tokenHash: string) {
    return db.prepare(`SELECT u.*, t.scopes, t.doc_ids,t.kind,t.id token_id FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>?) AND u.disabled_at IS NULL AND (t.kind='pat' OR (t.kind='oauth_access' AND t.resource=? AND EXISTS(SELECT 1 FROM oauth_grants g WHERE g.id=t.grant_id AND g.user_id=t.user_id AND g.client_id=t.client_id AND g.resource=t.resource AND g.revoked_at IS NULL AND g.expires_at>?)))`).get(tokenHash, isoNow(), `${new URL(appUrl).origin}/mcp`, isoNow()) as (User & { scopes: string; doc_ids: string | null; kind: string; token_id: string }) | undefined;
  }
  function currentUser(request: FastifyRequest, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]): { user: User; tokenScopes: TokenScopes | null } | null {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const row = tokenUser(sessionSecret(token));
      if (!row) return null;
      const usedAt = isoNow();
      const usageCutoff = new Date(Date.parse(usedAt) - 60000).toISOString();
      db.prepare('UPDATE api_tokens SET last_used_at=?, last_used_ip=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?)').run(usedAt, request.ip || 'unknown', row.token_id, usageCutoff);
      const scopes = new Set(asJson<Scope[]>(row.scopes)) as TokenScopes;
      scopes.oauth = row.kind === 'oauth_access'; scopes.tokenId = row.token_id;
      scopes.docIds = row.doc_ids ? new Set(asJson<string[]>(row.doc_ids)) : null;
      return { user: row, tokenScopes: scopes };
    }
    const token = request.cookies[sessionCookie];
    if (!token) return null;
    const row = db.prepare('SELECT u.*,s.id session_id,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL').get(sessionSecret(token), isoNow()) as (User & { session_id: string; expires_at: string }) | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) - Date.now() < 15 * 86400000) {
      const renewed = new Date(Date.now() + 30 * 86400000).toISOString();
      db.prepare('UPDATE sessions SET expires_at=? WHERE id=?').run(renewed, row.session_id);
      reply.setCookie(sessionCookie, token, { httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https:'), path: '/', maxAge: 30 * 86400 });
    }
    return { user: row, tokenScopes: null };
  }
  async function auth(request: FastifyRequest, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]) {
    const actor = await currentUser(request, reply);
    if (actor) requestActors.set(request, actor.user.id);
    if (!actor) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED' } }); return null; }
    const path = request.url.split('?')[0]!;
    if (actor.tokenScopes?.oauth && !/^\/api\/v1\/(?:me$|spec$|docs$|ai-tasks$|docs\/[^/]+(?:$|\/(?:versions|comments|submissions|exports|assets|ai-tasks|previews)(?:\/|$))|(?:submissions|previews|comments|ai-tasks)\/)/.test(path)) { reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } }); return null; }
    const heavy = request.method === 'POST' && (path === '/api/v1/imports' || path === '/api/v1/imports/archive' || /^\/api\/v1\/docs\/[^/]+\/(?:assets|exports)$/.test(path)) || request.method === 'GET' && /^\/api\/v1\/docs\/[^/]+\/export$/.test(path);
    const retry = (isInternalRequest(app, request) ? 0 : requestLimit(`user:${actor.user.id}`, 300, Date.now())) || (heavy ? requestLimit(`files:${actor.user.id}`, 10, Date.now()) : 0);
    if (retry) { reply.code(429).header('Retry-After', String(retry)).send({ error: { code: 'RATE_LIMITED' } }); return null; }
    return actor;
  }
  function roleFor(user: User, docId: string): Role | null {
    if (user.is_admin) return 'owner';
    const rows = db.prepare(`SELECT role FROM document_members WHERE doc_id=? AND user_id=? UNION ALL SELECT sm.role FROM documents d JOIN space_members sm ON sm.space_id=d.space_id WHERE d.id=? AND sm.user_id=?`).all(docId, user.id, docId, user.id) as Array<{ role: Role }>;
    const levels: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
    return rows.map((row) => row.role).sort((a, b) => levels[b] - levels[a])[0] ?? null;
  }
  function requireRole(user: User, docId: string, minimum: Role, tokenScopes: TokenScopes | null, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1], scopeOverride?: Scope): boolean {
    if (!db.prepare('SELECT 1 FROM documents WHERE id=?').get(docId)) { reply.code(404).send({ error: { code: 'NOT_FOUND' } }); return false; }
    if (tokenScopes?.docIds && !tokenScopes.docIds.has(docId)) { reply.code(404).send({ error: { code: 'NOT_FOUND' } }); return false; }
    const role = roleFor(user, docId);
    const levels: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
    if (!role || levels[role] < levels[minimum]) { reply.code(role ? 403 : 404).send({ error: { code: role ? 'FORBIDDEN' : 'NOT_FOUND' } }); return false; }
    if (tokenScopes) {
      if (!db.prepare('SELECT 1 FROM documents WHERE id=? AND ai_enabled=1').get(docId)) { reply.code(403).send({ error: { code: 'AI_DISABLED' } }); return false; }
      if (minimum === 'owner') { reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } }); return false; }
      const scopeFor: Partial<Record<Role, Scope>> = { viewer: 'read', commenter: 'comment', editor: 'submit', owner: 'submit' };
      const required = scopeOverride ?? scopeFor[minimum] ?? 'read';
      if (!tokenScopes.has(required) && !(required === 'comment' && tokenScopes.has('submit')) && !(required === 'read' && (tokenScopes.has('comment') || tokenScopes.has('submit') || tokenScopes.has('preview')))) { reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } }); return false; }
    }
    return true;
  }
  // Worker computation yields to other requests, including logout and membership changes.
  // Reauthenticate without charging another request quota before releasing its result.
  function recheckDocumentAccess(request: FastifyRequest, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1], docId: string, minimum: Role, scopeOverride?: Scope): boolean {
    const actor = currentUser(request, reply);
    if (!actor) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED' } }); return false; }
    return requireRole(actor.user, docId, minimum, actor.tokenScopes, reply, scopeOverride);
  }
  function createAiTask(docId: string, requestedBy: string, instruction: string, moduleIds: string[], commentId: string, approved = false) {
    const id = randomId('at'); const now = isoNow(); const guest = requestedBy.startsWith('g_');
    const status = approved && !guest ? 'approved' : 'requested';
    db.prepare('INSERT INTO ai_tasks(id,doc_id,requested_by,guest_id,kind,status,instruction,module_ids,comment_id,approved_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, docId, guest ? null : requestedBy, guest ? requestedBy : null, 'edit', status, instruction.slice(0, 5000), JSON.stringify(moduleIds), commentId, status === 'approved' ? requestedBy : null, now, now);
    if (status === 'requested') {
      const recipients = db.prepare(`SELECT DISTINCT u.id FROM users u WHERE u.disabled_at IS NULL AND (u.is_admin=1 OR EXISTS(SELECT 1 FROM document_members dm WHERE dm.doc_id=? AND dm.user_id=u.id AND dm.role IN ('owner','editor')) OR EXISTS(SELECT 1 FROM documents d JOIN space_members sm ON sm.space_id=d.space_id WHERE d.id=? AND sm.user_id=u.id AND sm.role IN ('owner','editor'))) AND u.id<>?`).all(docId, docId, requestedBy) as Array<{ id: string }>;
      for (const recipient of recipients) db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(randomId('nt'), recipient.id, docId, 'ai_task_requested', JSON.stringify({ taskId: id }), now);
    }
    return publicAiTask(getAiTask(db, id));
  }
  function rejectToken(actor: { tokenScopes: TokenScopes | null }, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]): boolean {
    if (!actor.tokenScopes) return false;
    reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    return true;
  }
  function locateNewCommentAnchor(anchor: Anchor, docId: string, content: string, version: number, allowHistory = true) {
    const sourceVersion = anchor.version ?? version;
    if (sourceVersion > version || !allowHistory && sourceVersion !== version) throw new HttpError(400, 'INVALID_ANCHOR_VERSION');
    const historical = sourceVersion === version ? undefined : db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(docId, sourceVersion) as { content: string } | undefined;
    if (sourceVersion !== version && !historical) throw new HttpError(400, 'INVALID_ANCHOR_VERSION');
    const target = asJson<Document>(content);
    const invalid = validateCommentAnchor(anchor, historical ? asJson<Document>(historical.content) : target);
    if (invalid) throw new HttpError(400, invalid);
    const located = relocateAnchor(anchor, target);
    if (located.state === 'lost') throw new HttpError(409, 'ANCHOR_STALE');
    return { ...located, anchor: { ...located.anchor, version } };
  }
  function requireAdmin(user: User, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]): boolean {
    if (user.is_admin) return true;
    reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    return false;
  }
  function requireSpaceOwner(user: User, spaceId: string, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]): boolean {
    const row = db.prepare('SELECT role FROM space_members WHERE space_id=? AND user_id=?').get(spaceId, user.id) as { role: Role } | undefined;
    const exists = db.prepare('SELECT 1 FROM spaces WHERE id=?').get(spaceId);
    if (!exists) { reply.code(404).send({ error: { code: 'NOT_FOUND' } }); return false; }
    if (user.is_admin || row?.role === 'owner') return true;
    reply.code(row ? 403 : 404).send({ error: { code: row ? 'FORBIDDEN' : 'NOT_FOUND' } });
    return false;
  }
  function changeMembership(kind: 'space' | 'document', containerId: string, userId: string, role: Role | null) {
    const table = kind === 'space' ? 'space_members' : 'document_members';
    const column = kind === 'space' ? 'space_id' : 'doc_id';
    db.transaction(() => {
      const previous = db.prepare(`SELECT m.role,u.disabled_at FROM ${table} m JOIN users u ON u.id=m.user_id WHERE m.${column}=? AND m.user_id=?`).get(containerId, userId) as { role: Role; disabled_at: string | null } | undefined;
      if (previous?.role === 'owner' && !previous.disabled_at && role !== 'owner') {
        const count = (db.prepare(`SELECT COUNT(*) count FROM ${table} m JOIN users u ON u.id=m.user_id WHERE m.${column}=? AND m.role='owner' AND u.disabled_at IS NULL`).get(containerId) as { count: number }).count;
        if (count <= 1) throw new HttpError(409, 'LAST_OWNER');
      }
      if (role) db.prepare(`INSERT INTO ${table}(${column},user_id,role) VALUES(?,?,?) ON CONFLICT(${column},user_id) DO UPDATE SET role=excluded.role`).run(containerId, userId, role);
      else db.prepare(`DELETE FROM ${table} WHERE ${column}=? AND user_id=?`).run(containerId, userId);
    })();
  }
  function writeGuard(request: FastifyRequest, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]): boolean {
    if (request.headers['x-hcd-request'] !== '1') { reply.code(403).send({ error: { code: 'CSRF_REQUIRED' } }); return false; }
    const origin = request.headers.origin;
    if (origin && origin !== appUrl && origin !== appUrl.replace(/\/$/, '')) { reply.code(403).send({ error: { code: 'ORIGIN_MISMATCH' } }); return false; }
    return true;
  }
  const route = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, handler: (request: FastifyRequest, reply: Parameters<Parameters<typeof app.route>[0]['handler']>[1]) => unknown) => app.route({ method, url: `/api/v1${url}`, ...(url === '/imports/archive' ? { bodyLimit: 42 * 1024 * 1024 } : url === '/imports' ? { bodyLimit: 6 * 1024 * 1024 } : {}), handler: handler as never });

  app.get('/healthz', async () => ({ ok: true, version: '0.1.0' }));
  route('POST', '/auth/login', async (request, reply) => {
    if (request.headers['x-hcd-request'] !== '1') return reply.code(403).send({ error: { code: 'CSRF_REQUIRED' } });
    const origin = request.headers.origin;
    if (origin && origin !== appUrl && origin !== appUrl.replace(/\/$/, '')) return reply.code(403).send({ error: { code: 'ORIGIN_MISMATCH' } });
    const body = isObject(request.body) ? request.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = request.ip || 'unknown';
    if (loginLimited(email, ip)) return reply.code(429).send({ error: { code: 'RATE_LIMITED' } });
    const user = db.prepare('SELECT * FROM users WHERE email=? AND disabled_at IS NULL').get(email) as (User & { password_hash: string }) | undefined;
    if (!verifyPassword(password, user?.password_hash ?? dummyPasswordHash) || !user) {
      recordLoginFailure(email, ip);
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS' } });
    }
    db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
    requestActors.set(request, user.id);
    const raw = randomBytes(32).toString('base64url');
    const now = Date.now();
    db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(randomId('se'), user.id, sessionSecret(raw), isoNow(), new Date(now + 30 * 86400000).toISOString());
    reply.setCookie(sessionCookie, raw, { httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https:'), path: '/', maxAge: 30 * 86400 });
    return { user: publicUser(user) };
  });
  registerGuestVerification(app, { db, secret: secretKey, appUrl, mailEnabled: Boolean(options.mailDelivery), access: guestAccess, link: shareLink, writeGuard });
  const integrationKind = (value: string): value is IntegrationKind => value === 'feishu_webhook' || value === 'feishu_app';
  route('GET', '/spaces/:id/integrations', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (rejectToken(actor, reply) || !requireSpaceOwner(actor.user, id, reply)) return;
    return { baseUrl: feishu.baseUrl, items: (['feishu_webhook', 'feishu_app'] as const).map((kind) => {
      const row = integrations.get(id, kind);
      const lastDelivery = db.prepare('SELECT status,last_error error,created_at createdAt,sent_at sentAt FROM feishu_outbox WHERE space_id=? AND kind=? ORDER BY created_at DESC,id DESC LIMIT 1').get(id, kind);
      return { kind, configured: Boolean(row), enabled: Boolean(row?.enabled), summary: row?.summary ?? '', lastDelivery: lastDelivery ?? null };
    }) };
  });
  route('PUT', '/spaces/:id/integrations/:kind', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id, kind } = request.params as { id: string; kind: string };
    if (rejectToken(actor, reply) || !requireSpaceOwner(actor.user, id, reply)) return;
    if (!integrationKind(kind)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    try { integrations.save(id, kind, request.body); } catch (error) { return reply.code(400).send({ error: { code: error instanceof IntegrationError ? error.code : 'INTEGRATION_CONFIG_INVALID' } }); }
    return reply.code(204).send();
  });
  route('POST', '/spaces/:id/integrations/:kind/test', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id, kind } = request.params as { id: string; kind: string };
    if (rejectToken(actor, reply) || !requireSpaceOwner(actor.user, id, reply)) return;
    if (!integrationKind(kind)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const retry = requestLimit(`integration-test:${actor.user.id}:${id}`, 3, Date.now());
    if (retry) return reply.code(429).header('Retry-After', String(retry)).send({ error: { code: 'RATE_LIMITED' } });
    const row = integrations.get(id, kind); if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    try {
      const space = db.prepare('SELECT name FROM spaces WHERE id=?').get(id) as { name: string };
      await feishu.send(db, row, integrations.read(row), integrationCard('test', space.name, appUrl, actor.user.locale), randomId('test'), actor.user.email, () => {
        const current = db.prepare('SELECT email,is_admin FROM users WHERE id=? AND disabled_at IS NULL').get(actor.user.id) as { email: string; is_admin: number } | undefined;
        return integrations.get(id, kind)?.revision === row.revision && Boolean(current && current.email === actor.user.email && (current.is_admin === 1 || db.prepare("SELECT 1 FROM space_members WHERE space_id=? AND user_id=? AND role='owner'").get(id, actor.user.id)));
      });
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof IntegrationError ? error.code : 'INTEGRATION_DELIVERY_FAILED' }; }
  });
  route('GET', '/auth/config', async () => ({ selfResetEnabled: Boolean(options.mailDelivery), passwordResetEnabled: Boolean(options.mailDelivery) }));
  route('POST', '/auth/forgot', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    if (!options.mailDelivery) return reply.code(503).send({ error: { code: 'SMTP_NOT_CONFIGURED' } });
    const body = isObject(request.body) ? request.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const now = Date.now();
    const retry = requestLimit(`reset-ip:${request.ip}`, 10, now);
    if (retry) return reply.code(204).send();
    db.transaction(() => {
      const emailHash = sessionSecret(email);
      db.prepare('DELETE FROM password_reset_attempts WHERE attempted_at<=?').run(now - 3600000);
      const attempts = db.prepare('SELECT COUNT(*) count,MAX(attempted_at) latest FROM password_reset_attempts WHERE email_hash=?').get(emailHash) as { count: number; latest: number | null };
      // Keep the existing one-minute retry cooldown alongside the durable hourly quota.
      if (attempts.count >= 3 || attempts.latest !== null && now - attempts.latest < 60000) return;
      db.prepare('INSERT INTO password_reset_attempts(email_hash,attempted_at) VALUES(?,?)').run(emailHash, now);
      const user = db.prepare('SELECT id FROM users WHERE email=? AND disabled_at IS NULL AND password_hash<>?').get(email, pendingPasswordHash) as { id: string } | undefined;
      if (user) issueInvite(user.id, 'reset', user.id, 3600000);
    }).immediate();
    return reply.code(204).send();
  });
  route('POST', '/auth/logout', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const token = request.cookies[sessionCookie];
    if (token) {
      const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(sessionSecret(token)) as { user_id: string } | undefined;
      if (session) requestActors.set(request, session.user_id);
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionSecret(token));
    }
    reply.clearCookie(sessionCookie, { path: '/' });
    return reply.code(204).send();
  });
  route('POST', '/auth/logout-all', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(actor.user.id);
    reply.clearCookie(sessionCookie, { path: '/' });
    return reply.code(204).send();
  });
  route('GET', '/auth/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = db.prepare(`SELECT i.kind,u.email,u.name FROM invites i JOIN users u ON u.id=i.user_id
      WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>? AND u.disabled_at IS NULL`).get(sessionSecret(token), isoNow()) as { kind: 'invite' | 'reset'; email: string; name: string } | undefined;
    if (!invite) return reply.code(410).send({ error: { code: 'INVITE_INVALID' } });
    return invite;
  });
  route('POST', '/auth/invites/:token/accept', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const { token } = request.params as { token: string };
    const body = isObject(request.body) ? request.body : {};
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
    if (password.length < 10 || password.length > 1024) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const sessionToken = randomBytes(32).toString('base64url');
    const now = isoNow();
    try {
      const accepted = db.transaction(() => {
        const invite = db.prepare(`SELECT i.*,u.email,u.name,u.password_hash,u.disabled_at,u.locale,u.is_admin FROM invites i JOIN users u ON u.id=i.user_id
          WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>? AND u.disabled_at IS NULL`).get(sessionSecret(token), now) as (Record<string, unknown> & User & { kind: 'invite' | 'reset'; email: string; password_hash: string }) | undefined;
        if (!invite) throw new HttpError(410, 'INVITE_INVALID');
        if (invite.kind === 'invite' && invite.password_hash !== pendingPasswordHash) throw new HttpError(410, 'INVITE_INVALID');
        if (invite.kind === 'invite' && !name) throw new HttpError(400, 'VALIDATION_FAILED');
        const changed = db.prepare('UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?').run(now, invite.id, now);
        if (!changed.changes) throw new HttpError(410, 'INVITE_INVALID');
        const salt = randomBytes(16).toString('base64url');
        const digest = passwordHash(password, salt);
        if (invite.kind === 'invite') db.prepare('UPDATE users SET password_hash=?,name=? WHERE id=?').run(digest, name, invite.user_id);
        else {
          db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(digest, invite.user_id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(invite.user_id);
          db.prepare('UPDATE invites SET used_at=? WHERE user_id=? AND kind=\'reset\' AND used_at IS NULL').run(now, invite.user_id);
          db.prepare('UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now, invite.user_id);
          db.prepare('UPDATE oauth_grants SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(now, invite.user_id);
          db.prepare('DELETE FROM oauth_requests WHERE user_id=?').run(invite.user_id);
        }
        db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(randomId('se'), invite.user_id, sessionSecret(sessionToken), now, new Date(Date.now() + 30 * 86400000).toISOString());
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(invite.user_id) as User;
        return { user, kind: invite.kind };
      })();
      requestActors.set(request, accepted.user.id);
      reply.setCookie(sessionCookie, sessionToken, { httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https:'), path: '/', maxAge: 30 * 86400 });
      return { user: publicUser(accepted.user), kind: accepted.kind };
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } });
      throw error;
    }
  });
  route('GET', '/me', async (request, reply) => {
    const actor = await auth(request, reply); return actor ? { user: publicUser(actor.user) } : undefined;
  });
  route('PATCH', '/me', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const changingPassword = body.currentPassword !== undefined || body.newPassword !== undefined;
    if (changingPassword) {
      if (typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 1024 || typeof body.newPassword !== 'string' || body.newPassword.length < 10 || body.newPassword.length > 1024) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
      if (loginLimited(actor.user.email, request.ip)) return reply.code(429).send({ error: { code: 'RATE_LIMITED' } });
      const current = db.prepare('SELECT password_hash FROM users WHERE id=? AND disabled_at IS NULL').get(actor.user.id) as { password_hash: string } | undefined;
      if (!verifyPassword(body.currentPassword, current?.password_hash)) {
        recordLoginFailure(actor.user.email, request.ip);
        return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS' } });
      }
    }
    db.transaction(() => {
      if (changingPassword) {
        const now = isoNow();
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(body.newPassword as string, randomBytes(16).toString('base64url')), actor.user.id);
        db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(actor.user.id, sessionSecret(request.cookies[sessionCookie]!));
        db.prepare("UPDATE invites SET used_at=? WHERE user_id=? AND kind='reset' AND used_at IS NULL").run(now, actor.user.id);
        db.prepare('DELETE FROM login_attempts WHERE email=?').run(actor.user.email);
      }
      if (typeof body.name === 'string' && body.name.trim()) db.prepare('UPDATE users SET name=? WHERE id=?').run(body.name.trim().slice(0, 100), actor.user.id);
      if (body.locale === 'zh-CN' || body.locale === 'en') db.prepare('UPDATE users SET locale=? WHERE id=?').run(body.locale, actor.user.id);
    }).immediate();
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(actor.user.id) as User) };
  });
  route('GET', '/admin/users', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (rejectToken(actor, reply) || !requireAdmin(actor.user, reply)) return;
    const users = db.prepare('SELECT id,email,name,locale,is_admin,disabled_at,created_at FROM users ORDER BY created_at DESC,email').all() as Array<Record<string, unknown>>;
    return { users: users.map((user) => ({ id: user.id, email: user.email, name: user.name, locale: user.locale, isAdmin: Boolean(user.is_admin), disabledAt: user.disabled_at, createdAt: user.created_at })) };
  });
  route('POST', '/admin/users', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    if (rejectToken(actor, reply) || !requireAdmin(actor.user, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || (body.isAdmin !== undefined && typeof body.isAdmin !== 'boolean')) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return reply.code(409).send({ error: { code: 'EMAIL_IN_USE' } });
    const id = randomId('u'); const now = isoNow();
    const invite = db.transaction(() => {
      db.prepare('INSERT INTO users(id,email,name,password_hash,locale,is_admin,created_at) VALUES(?,?,?,?,\'zh-CN\',?,?)').run(id, email, name, pendingPasswordHash, Number(body.isAdmin === true), now);
      return issueInvite(id, 'invite', actor.user.id, 7 * 86400000);
    })();
    return reply.code(201).send({ user: { id, email, name, locale: 'zh-CN', isAdmin: body.isAdmin === true }, inviteUrl: invite.url, expiresAt: invite.expiresAt });
  });
  route('POST', '/admin/users/:id/reset-link', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    if (rejectToken(actor, reply) || !requireAdmin(actor.user, reply)) return;
    const { id } = request.params as { id: string };
    const user = db.prepare('SELECT id FROM users WHERE id=? AND disabled_at IS NULL').get(id) as { id: string } | undefined;
    if (!user) return reply.code(404).send({ error: { code: 'USER_NOT_FOUND' } });
    const invite = issueInvite(id, 'reset', actor.user.id, 24 * 3600000);
    return { resetUrl: invite.url, expiresAt: invite.expiresAt };
  });
  route('PATCH', '/admin/users/:id', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    if (rejectToken(actor, reply) || !requireAdmin(actor.user, reply)) return;
    const { id } = request.params as { id: string };
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(id) as (User & { disabled_at: string | null }) | undefined;
    if (!current) return reply.code(404).send({ error: { code: 'USER_NOT_FOUND' } });
    const body = isObject(request.body) ? request.body : {};
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    if (body.isAdmin !== undefined && typeof body.isAdmin !== 'boolean') return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    if (body.disabled !== undefined && typeof body.disabled !== 'boolean') return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const nextAdmin = typeof body.isAdmin === 'boolean' ? body.isAdmin : Boolean(current.is_admin);
    const nextDisabled = typeof body.disabled === 'boolean' ? body.disabled : Boolean(current.disabled_at);
    const now = isoNow();
    try {
      const updated = db.transaction(() => {
        const removingAdmin = Boolean(current.is_admin) && !current.disabled_at && (!nextAdmin || nextDisabled);
        if (removingAdmin) {
          const activeAdmins = (db.prepare('SELECT COUNT(*) count FROM users WHERE is_admin=1 AND disabled_at IS NULL').get() as { count: number }).count;
          if (activeAdmins <= 1) throw new HttpError(409, 'LAST_ADMIN');
        }
        if (nextDisabled && !current.disabled_at) {
          for (const [table, column] of [['space_members', 'space_id'], ['document_members', 'doc_id']] as const) {
            const lastOwned = db.prepare(`SELECT 1 FROM ${table} mine WHERE mine.user_id=? AND mine.role='owner' AND NOT EXISTS (SELECT 1 FROM ${table} other JOIN users u ON u.id=other.user_id WHERE other.${column}=mine.${column} AND other.role='owner' AND other.user_id<>? AND u.disabled_at IS NULL) LIMIT 1`).get(id, id);
            if (lastOwned) throw new HttpError(409, 'LAST_OWNER');
          }
        }
        if (body.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(String(body.name).trim().slice(0, 100), id);
        db.prepare('UPDATE users SET is_admin=?,disabled_at=? WHERE id=?').run(Number(nextAdmin), nextDisabled ? current.disabled_at ?? now : null, id);
        if (nextDisabled) {
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
          db.prepare('UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(now, id);
          db.prepare('UPDATE oauth_grants SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(now, id);
          db.prepare('DELETE FROM oauth_requests WHERE user_id=?').run(id);
        }
        return db.prepare('SELECT * FROM users WHERE id=?').get(id) as User;
      })();
      return { user: publicUser(updated) };
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } });
      throw error;
    }
  });
  route('GET', '/users', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (actor.tokenScopes && !['read', 'comment', 'submit'].some((scope) => actor.tokenScopes?.has(scope as Scope))) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    const qRaw = (request.query as { q?: string }).q ?? '';
    const q = qRaw.trim().slice(0, 100);
    const items = db.prepare(`SELECT id,name,email FROM users WHERE disabled_at IS NULL AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name LIMIT 20`).all(`%${q.replace(/[\\%_]/g, '\\$&')}%`, `%${q.replace(/[\\%_]/g, '\\$&')}%`);
    return { items };
  });

  route('GET', '/spaces', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const rows = actor.user.is_admin ? db.prepare("SELECT *, 'owner' AS role FROM spaces").all() : db.prepare('SELECT s.*,sm.role FROM spaces s JOIN space_members sm ON sm.space_id=s.id WHERE sm.user_id=?').all(actor.user.id);
    return { spaces: rows };
  });
  route('POST', '/spaces', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.name !== 'string' || !body.name.trim()) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const id = randomId('sp'); const now = isoNow(); const name = body.name.trim().slice(0, 200);
    const tx = db.transaction(() => { db.prepare('INSERT INTO spaces(id,name,created_by,created_at) VALUES(?,?,?,?)').run(id, name, actor.user.id, now); db.prepare('INSERT INTO space_members(space_id,user_id,role) VALUES(?,?,?)').run(id, actor.user.id, 'owner'); }); tx();
    return reply.code(201).send({ space: { id, name, role: 'owner' } });
  });
  route('PATCH', '/spaces/:id', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const membership = db.prepare('SELECT role FROM space_members WHERE space_id=? AND user_id=?').get(id, actor.user.id) as { role: Role } | undefined;
    if (actor.user.is_admin === 0 && membership?.role !== 'owner') return reply.code(membership ? 403 : 404).send({ error: { code: membership ? 'FORBIDDEN' : 'NOT_FOUND' } });
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.name === 'string' && body.name.trim()) db.prepare('UPDATE spaces SET name=? WHERE id=?').run(body.name.trim().slice(0, 200), id);
    const space = db.prepare('SELECT id,name,created_by,created_at FROM spaces WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!space) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return { space: { ...space, role: membership?.role ?? 'owner' } };
  });
  route('GET', '/spaces/:id/members', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const membership = db.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').get(id, actor.user.id);
    if (!actor.user.is_admin && !membership) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!db.prepare('SELECT 1 FROM spaces WHERE id=?').get(id)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const members = db.prepare('SELECT u.id,u.name,u.email,sm.role FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=? ORDER BY u.name').all(id);
    return { members };
  });
  route('PUT', '/spaces/:id/members/:userId', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id, userId } = request.params as { id: string; userId: string };
    if (!requireSpaceOwner(actor.user, id, reply)) return;
    if (!db.prepare('SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL').get(userId)) return reply.code(404).send({ error: { code: 'USER_NOT_FOUND' } });
    const body = isObject(request.body) ? request.body : {};
    if (!['owner', 'editor', 'commenter', 'viewer'].includes(String(body.role))) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    try { changeMembership('space', id, userId, body.role as Role); }
    catch (error) { if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
    return reply.code(204).send();
  });
  route('DELETE', '/spaces/:id/members/:userId', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id, userId } = request.params as { id: string; userId: string };
    if (!requireSpaceOwner(actor.user, id, reply)) return;
    try { changeMembership('space', id, userId, null); }
    catch (error) { if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
    return reply.code(204).send();
  });

  route('GET', '/templates', async (request, reply) => {
    if (!await auth(request, reply)) return;
    return { templates: [{ id: 'blank', title: '空白文档', description: '从零开始撰写' }, { id: 'growth-plan', title: '增长方案', description: '目标、洞察、节奏与数据回顾' }] };
  });
  route('POST', '/imports', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const spaceId = typeof body.spaceId === 'string' ? body.spaceId : '';
    const spaceRole = actor.user.is_admin ? 'owner' : (db.prepare('SELECT role FROM space_members WHERE space_id=? AND user_id=?').get(spaceId, actor.user.id) as { role: Role } | undefined)?.role;
    if (!db.prepare('SELECT 1 FROM spaces WHERE id=?').get(spaceId) || !spaceRole || !['owner', 'editor'].includes(spaceRole)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const html = typeof body.html === 'string' ? body.html : '';
    const filename = typeof body.filename === 'string' ? body.filename.slice(0, 200) : 'import.html';
    if (!html || Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024 || (filename && !/\.html?$/i.test(filename))) return reply.code(413).send({ error: { code: 'IMPORT_TOO_LARGE_OR_UNSUPPORTED' } });
    const rawTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : filename.replace(/\.html?$/i, '').slice(0, 200);
    const id = randomId('im'); const docId = `d_${base32(randomBytes(5)).slice(0, 8)}`;
    let converted: ReturnType<typeof importedHtml>;
    let staged: Awaited<ReturnType<typeof stageImportImages>>;
    try { staged = await stageImportImages(html, assetStore); converted = importedHtml(staged.html, docId, rawTitle || 'Imported document'); }
    catch (error) { if (error instanceof AssetError) return reply.code(error.status).send({ error: { code: error.code } }); if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
    const report = { ...converted.report, images: staged.images, rawBlocks: staged.rawBlocks, modules: converted.content.modules.length, blocks: converted.content.modules.reduce((sum, module) => sum + module.blocks.length, 0) };
    const now = isoNow();
    db.transaction(() => {
      db.prepare('INSERT INTO imports(id,space_id,created_by,filename,source_html,content,report,status,created_at) VALUES(?,?,?,?,?,?,?,\'ready\',?)').run(id, spaceId, actor.user.id, filename, html, JSON.stringify(converted.content), JSON.stringify(report), now);
      const used = documentAssetIds(converted.content);
      if ([...used].some((id) => !staged.assets.some((asset) => asset.id === id))) throw new HttpError(422, 'IMPORT_ASSET_MISSING');
      for (const asset of staged.assets) if (used.has(asset.id)) db.prepare('INSERT INTO import_assets(id,import_id,hash,mime,size) VALUES(?,?,?,?,?)').run(asset.id, id, asset.hash, asset.mime, asset.size);
    })();
    return reply.code(201).send({ import: { id, status: 'ready', filename, report, content: converted.content } });
  });
  route('POST', '/imports/archive', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const spaceId = typeof body.spaceId === 'string' ? body.spaceId : '';
    const role = actor.user.is_admin ? 'owner' : (db.prepare('SELECT role FROM space_members WHERE space_id=? AND user_id=?').get(spaceId, actor.user.id) as { role: Role } | undefined)?.role;
    if (!db.prepare('SELECT 1 FROM spaces WHERE id=?').get(spaceId) || !role || !['owner', 'editor'].includes(role)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const filename = typeof body.filename === 'string' && body.filename.length <= 200 ? body.filename : '';
    if (!/\.zip$/i.test(filename) || typeof body.archiveBase64 !== 'string') return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const encoded = body.archiveBase64;
    if (encoded.length > Math.ceil(archiveLimits.bytes * 4 / 3) + 8 || /[^A-Za-z0-9+/=]/.test(encoded)) return reply.code(413).send({ error: { code: 'IMPORT_TOO_LARGE_OR_UNSUPPORTED' } });
    const source = Buffer.from(encoded, 'base64');
    if (source.toString('base64') !== encoded) return reply.code(400).send({ error: { code: 'IMPORT_ARCHIVE_INVALID' } });
    try {
      const archive = inspectArchive(source);
      const manifestBytes = archive['manifest.json']; const documentBytes = archive['document.json'];
      if (!manifestBytes || !documentBytes || manifestBytes.length > 1024 * 1024 || documentBytes.length > 3 * 1024 * 1024) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as { format?: unknown; archiveVersion?: unknown; documentFile?: unknown; themeFile?: unknown; modules?: unknown; assets?: unknown };
      if (manifest.format !== 'hcd-archive' || manifest.archiveVersion !== 1 || manifest.documentFile !== 'document.json' || manifest.themeFile !== 'theme.css' || !archive['theme.css'] || !Array.isArray(manifest.modules) || !Array.isArray(manifest.assets) || manifest.modules.length > 200 || manifest.assets.length > 1000) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(documentBytes));
      const docId = `d_${base32(randomBytes(5)).slice(0, 8)}`;
      if (!validateDocument(parsed).ok) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      const content = normalizeContent(parsed, randomNodeId, undefined, docId);
      if (!validateDocument(content).ok || content.modules.length !== manifest.modules.length) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      const declaredPaths = new Set(['manifest.json', 'document.json', 'theme.css']);
      for (const [index, entry] of (manifest.modules as Array<{ id?: unknown; path?: unknown }>).entries()) {
        if (entry.id !== content.modules[index]!.id || typeof entry.path !== 'string' || !entry.path.startsWith('modules/') || !archive[entry.path] || archive[entry.path]!.length > 2 * 1024 * 1024) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
        if (declaredPaths.has(entry.path)) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
        declaredPaths.add(entry.path);
        const moduleSource = new TextDecoder('utf-8', { fatal: true }).decode(archive[entry.path]!);
        if (!isImportTreeBounded(parseFragment(moduleSource))) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
        const parsedModule = parseSpecDocument(moduleSource);
        if (!parsedModule.ok || parsedModule.value.doc.modules.length !== 1 || canonicalJson(parsedModule.value.doc.modules[0]) !== canonicalJson(content.modules[index])) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      }
      const replacements = new Map<string, string>(); const normalizedAssets: Array<{ id: string; mime: string; size: number; sha256: string }> = [];
      for (const entry of manifest.assets as Array<{ id?: unknown; mime?: unknown; size?: unknown; sha256?: unknown }>) {
        if (typeof entry.id !== 'string' || !/^as_[a-z2-7]{12}$/.test(entry.id) || typeof entry.mime !== 'string' || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.size)) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
        declaredPaths.add(`assets/${entry.id}`);
        const data = archive[`assets/${entry.id}`];
        if (!data || data.length !== entry.size || sha256(data) !== entry.sha256) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
        if (replacements.has(entry.id)) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
        const asset = await assetStore.stage(Buffer.from(data), entry.mime);
        const existing = normalizedAssets.find((item) => item.sha256 === asset.hash);
        replacements.set(entry.id, existing?.id ?? asset.id);
        if (!existing) normalizedAssets.push({ id: asset.id, mime: asset.mime, size: asset.size, sha256: asset.hash });
      }
      if (Object.keys(archive).some((path) => !declaredPaths.has(path))) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      const referenced = documentAssetIds(content);
      if (referenced.size !== replacements.size || [...referenced].some((id) => !replacements.has(id))) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      const remap = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(remap); return; }
        if (!isObject(value)) return;
        if (value.type === 'raw' && value.allowScripts) throw new ArchiveError('RAW_SCRIPTS_UNAVAILABLE');
        if ((value.type === 'image' || value.type === 'raw') && typeof value.asset === 'string') { const replacement = replacements.get(value.asset); if (!replacement) throw new ArchiveError('IMPORT_ARCHIVE_INVALID'); value.asset = replacement; }
        Object.values(value).forEach(remap);
      };
      remap(content);
      for (const block of assetBlocks(content)) if (block.asset) {
        const asset = normalizedAssets.find((item) => item.id === block.asset);
        if (!asset || (block.type === 'raw' ? asset.mime !== 'text/html' : !asset.mime.startsWith('image/'))) throw new ArchiveError('IMPORT_ARCHIVE_INVALID');
      }
      const id = randomId('im'); const now = isoNow();
      const report = { removed: 0, warnings: [] as string[], modules: content.modules.length, blocks: content.modules.reduce((count, module) => count + module.blocks.length, 0), recognized: { kpis: 0, timelines: 0 }, archiveAssets: normalizedAssets.filter((asset) => asset.mime.startsWith('image/')).length, rawBlocks: normalizedAssets.filter((asset) => asset.mime === 'text/html').length };
      db.transaction(() => {
        db.prepare('INSERT INTO imports(id,space_id,created_by,filename,source_html,content,report,status,created_at,source_data) VALUES(?,?,?,?,?,?,?,\'ready\',?,?)').run(id, spaceId, actor.user.id, filename, '[Preserved HCD ZIP archive]', JSON.stringify(content), JSON.stringify(report), now, source);
        const insert = db.prepare('INSERT INTO import_assets(id,import_id,hash,mime,size) VALUES(?,?,?,?,?)');
        for (const asset of normalizedAssets) insert.run(asset.id, id, asset.sha256, asset.mime, asset.size);
      })();
      return reply.code(201).send({ import: { id, status: 'ready', filename, report, content } });
    } catch (error) {
      if (error instanceof ArchiveError) return reply.code(422).send({ error: { code: error.code } });
      if (error instanceof AssetError) return reply.code(error.status).send({ error: { code: error.code } });
      if (error instanceof SyntaxError || error instanceof TypeError) return reply.code(422).send({ error: { code: 'IMPORT_ARCHIVE_INVALID' } });
      throw error;
    }
  });
  route('GET', '/imports/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM imports WHERE id=? AND created_by=?').get(id, actor.user.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return { import: { id, status: row.status, filename: row.filename, report: asJson(row.report as string), content: asJson(row.content as string), ...(row.confirmed_doc_id ? { docId: row.confirmed_doc_id } : {}) } };
  });
  route('GET', '/imports/:id/assets/:assetId', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id, assetId } = request.params as { id: string; assetId: string };
    const row = db.prepare('SELECT i.space_id,i.confirmed_doc_id,a.id,a.hash,a.mime,a.size FROM imports i JOIN import_assets a ON a.import_id=i.id WHERE i.id=? AND i.created_by=? AND a.id=? AND i.status IN (\'ready\',\'confirmed\')').get(id, actor.user.id, assetId) as { space_id: string; confirmed_doc_id: string | null; id: string; hash: string; mime: string; size: number } | undefined;
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const permission = row.confirmed_doc_id ? roleFor(actor.user, row.confirmed_doc_id) : actor.user.is_admin || db.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').get(row.space_id, actor.user.id);
    if (!permission) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!row.mime.startsWith('image/')) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.type(row.mime).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'").send(await assetStore.read({ ...row, doc_id: row.confirmed_doc_id ?? '' }));
  });
  route('GET', '/imports/:id/assets/:assetId/url', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id, assetId } = request.params as { id: string; assetId: string };
    const row = db.prepare("SELECT a.mime,i.space_id FROM imports i JOIN import_assets a ON a.import_id=i.id WHERE i.id=? AND i.created_by=? AND a.id=? AND i.status='ready'").get(id, actor.user.id, assetId) as { mime: string; space_id: string } | undefined;
    if (!row || (!actor.user.is_admin && !db.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?').get(row.space_id, actor.user.id))) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!renderSigner) return reply.code(503).send({ error: { code: 'RENDER_NOT_CONFIGURED' } });
    return { url: renderSigner.url(row.mime === 'text/html' ? 'raw' : 'a', assetId, actor.tokenScopes?.tokenId ?? actor.user.id) };
  });
  route('POST', '/imports/:id/confirm', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const result = db.transaction(() => {
      const row = db.prepare('SELECT * FROM imports WHERE id=? AND created_by=?').get(id, actor.user.id) as Record<string, unknown> | undefined;
      if (!row) throw new HttpError(404, 'NOT_FOUND');
      if (row.status === 'confirmed' && typeof row.confirmed_doc_id === 'string') {
        if (!roleFor(actor.user, row.confirmed_doc_id)) throw new HttpError(404, 'NOT_FOUND');
        const version = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=1').get(row.confirmed_doc_id) as { content: string };
        return { docId: row.confirmed_doc_id, content: asJson<Document>(version.content), created: false };
      }
      if (row.status !== 'ready') throw new HttpError(409, 'IMPORT_NOT_READY');
      const permission = actor.user.is_admin ? 'owner' : (db.prepare('SELECT role FROM space_members WHERE space_id=? AND user_id=?').get(row.space_id, actor.user.id) as { role: Role } | undefined)?.role;
      if (!permission || !['owner', 'editor'].includes(permission)) throw new HttpError(403, 'FORBIDDEN');
      const body = isObject(request.body) ? request.body : {};
      const content = asJson<Document>(String(row.content));
      if (typeof body.title === 'string' && body.title.trim()) content.title = body.title.trim().slice(0, 200);
      const now = isoNow();
      db.prepare('INSERT INTO documents(id,space_id,title,current_version,created_by,created_at,updated_at) VALUES(?,?,?,1,?,?,?)').run(content.id, row.space_id, content.title, actor.user.id, now, now);
      db.prepare('INSERT INTO assets(id,doc_id,hash,mime,size,created_by,created_at) SELECT id,?,hash,mime,size,?,? FROM import_assets WHERE import_id=?').run(content.id, actor.user.id, now, id);
      db.prepare('INSERT INTO document_members(doc_id,user_id,role) VALUES(?,?,\'owner\')').run(content.id, actor.user.id);
      db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,1,\'import\',?,?,?)').run(content.id, JSON.stringify(content), actor.user.id, now);
      db.prepare('UPDATE imports SET status=\'confirmed\',confirmed_doc_id=? WHERE id=?').run(content.id, id);
      return { docId: content.id, content, created: true };
    });
    try { const confirmed = result(); return reply.code(confirmed.created ? 201 : 200).send({ doc: { id: confirmed.docId, title: confirmed.content.title, currentVersion: 1, aiEnabled: false, role: 'owner' }, content: confirmed.content }); }
    catch (error) { if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
  });
  route('POST', '/imports/:id/discard', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    db.prepare('UPDATE imports SET status=\'discarded\' WHERE id=? AND created_by=? AND status=\'ready\'').run(id, actor.user.id);
    return reply.code(204).send();
  });
  route('GET', '/docs', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (actor.tokenScopes && !['read', 'comment', 'submit', 'preview'].some(scope => actor.tokenScopes!.has(scope as Scope))) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    const rows = actor.user.is_admin
      ? db.prepare('SELECT d.*,sm.role FROM documents d LEFT JOIN space_members sm ON sm.space_id=d.space_id AND sm.user_id=? ORDER BY d.updated_at DESC').all(actor.user.id)
      : db.prepare('SELECT DISTINCT d.*, COALESCE(dm.role,sm.role) role FROM documents d LEFT JOIN document_members dm ON dm.doc_id=d.id AND dm.user_id=? LEFT JOIN space_members sm ON sm.space_id=d.space_id AND sm.user_id=? WHERE dm.user_id IS NOT NULL OR sm.user_id IS NOT NULL ORDER BY d.updated_at DESC').all(actor.user.id, actor.user.id);
    const docs = rows.map((item) => { const row = item as Record<string, unknown>; return { id: String(row.id), title: row.title, currentVersion: row.current_version, updatedAt: row.updated_at, spaceId: row.space_id, aiEnabled: Boolean(row.ai_enabled), role: roleFor(actor.user, String(row.id)) }; }).filter((doc) => (!actor.tokenScopes?.docIds || actor.tokenScopes.docIds.has(doc.id)) && (!actor.tokenScopes || doc.aiEnabled));
    return { docs };
  });
  route('POST', '/docs', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const spaceId = typeof body.spaceId === 'string' ? body.spaceId : null;
    const space = spaceId ? db.prepare('SELECT * FROM spaces WHERE id=?').get(spaceId) as { id: string } | undefined : undefined;
    if (!space || (!actor.user.is_admin && !db.prepare('SELECT 1 FROM space_members WHERE space_id=? AND user_id=? AND role IN (\'owner\',\'editor\')').get(spaceId, actor.user.id))) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const docId = `d_${base32(randomBytes(5)).slice(0, 8)}`;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : 'Untitled document';
    const content = body.templateId === 'growth-plan' ? createSeedDocument(docId, title) : normalizeContent({ id: docId, title, theme: { id: 'default', version: 1, overrides: {} }, modules: [] }, () => randomNodeId(), title);
    const now = isoNow();
    const tx = db.transaction(() => { db.prepare('INSERT INTO documents(id,space_id,title,current_version,created_by,created_at,updated_at) VALUES(?,?,?,1,?,?,?)').run(docId, spaceId, title, actor.user.id, now, now); db.prepare('INSERT INTO document_members(doc_id,user_id,role) VALUES(?,?,?)').run(docId, actor.user.id, 'owner'); db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,1,\'create\',?,?,?)').run(docId, JSON.stringify(content), actor.user.id, now); }); tx();
    return reply.code(201).send({ doc: { id: docId, title, currentVersion: 1, aiEnabled: false, role: 'owner' }, content });
  });
  route('GET', '/docs/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!doc) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const version = Number((request.query as { v?: string }).v ?? doc.current_version);
    const snapshot = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(id, version) as { content: string } | undefined;
    if (!snapshot) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const draft = db.prepare('SELECT base_version,content,updated_at FROM drafts WHERE doc_id=? AND user_id=?').get(id, actor.user.id) as { base_version: number; content: string; updated_at: string } | undefined;
    return { doc: { id, title: doc.title, currentVersion: doc.current_version, aiEnabled: Boolean(doc.ai_enabled), role: roleFor(actor.user, id) }, content: asJson(snapshot.content), ...(draft && !actor.tokenScopes ? { draft: { baseVersion: draft.base_version, content: asJson(draft.content), updatedAt: draft.updated_at } } : {}) };
  });
  route('GET', '/docs/:id/head', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const row = db.prepare('SELECT current_version,updated_at FROM documents WHERE id=?').get(id) as { current_version: number; updated_at: string } | undefined;
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const pendingCount = (db.prepare('SELECT COUNT(*) count FROM submissions WHERE doc_id=? AND status=\'pending\'').get(id) as { count: number }).count;
    return { currentVersion: row.current_version, pendingCount, updatedAt: row.updated_at };
  });
  route('GET', '/docs/:id/members', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const members = db.prepare(`SELECT u.id,u.name,u.email,dm.role AS documentRole,sm.role AS spaceRole FROM users u
      LEFT JOIN document_members dm ON dm.user_id=u.id AND dm.doc_id=?
      LEFT JOIN documents d ON d.id=? LEFT JOIN space_members sm ON sm.user_id=u.id AND sm.space_id=d.space_id
      WHERE dm.user_id IS NOT NULL OR sm.user_id IS NOT NULL ORDER BY u.name`).all(id, id) as Array<{ id: string; name: string; email: string; documentRole: Role | null; spaceRole: Role | null }>;
    const levels: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
    return { members: members.map((member) => {
      const roles = [member.documentRole, member.spaceRole].filter((role): role is Role => role !== null).sort((a, b) => levels[b] - levels[a]);
      return { ...member, role: roles[0], inherited: !member.documentRole || (member.spaceRole !== null && levels[member.spaceRole] > levels[member.documentRole]) };
    }) };
  });
  route('PUT', '/docs/:id/members/:userId', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id, userId } = request.params as { id: string; userId: string };
    if (!requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    const user = db.prepare('SELECT id FROM users WHERE id=? AND disabled_at IS NULL').get(userId);
    if (!user) return reply.code(404).send({ error: { code: 'USER_NOT_FOUND' } });
    const body = isObject(request.body) ? request.body : {};
    if (!['owner', 'editor', 'commenter', 'viewer'].includes(String(body.role))) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    try { changeMembership('document', id, userId, body.role as Role); }
    catch (error) { if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
    return reply.code(204).send();
  });
  route('DELETE', '/docs/:id/members/:userId', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id, userId } = request.params as { id: string; userId: string };
    if (!requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    try { changeMembership('document', id, userId, null); }
    catch (error) { if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
    return reply.code(204).send();
  });
  route('POST', '/docs/:id/assets', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'editor', actor.tokenScopes, reply)) return;
    if (!request.isMultipart()) return reply.code(415).send({ error: { code: 'ASSET_UNSUPPORTED' } });
    try {
      let file: { bytes: Buffer; mime: string } | undefined;
      for await (const part of request.parts()) {
        if (part.type !== 'file' || part.fieldname !== 'file') throw new AssetError(400, 'VALIDATION_FAILED');
        file = { bytes: await part.toBuffer(), mime: part.mimetype };
      }
      if (!file) throw new AssetError(400, 'VALIDATION_FAILED');
      const asset = await assetStore.save(id, actor.user.id, file.bytes, file.mime);
      return reply.code(201).send({ asset: { id: asset.id, mime: asset.mime, size: asset.size }, url: `/api/v1/docs/${id}/assets/${asset.id}` });
    } catch (error) {
      if (error instanceof AssetError) return reply.code(error.status).send({ error: { code: error.code } });
      if (error instanceof Error && 'code' in error && String(error.code).startsWith('FST_')) return reply.code(413).send({ error: { code: 'ASSET_TOO_LARGE' } });
      throw error;
    }
  });
  route('GET', '/docs/:id/assets/:assetId', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id, assetId } = request.params as { id: string; assetId: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const asset = assetStore.get(id, assetId);
    if (!asset || !asset.mime.startsWith('image/')) return reply.code(404).send({ error: { code: 'ASSET_NOT_FOUND' } });
    return reply.type(asset.mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'none'").header('Content-Disposition', 'inline').send(await assetStore.read(asset));
  });
  route('GET', '/docs/:id/assets/:assetId/url', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id, assetId } = request.params as { id: string; assetId: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const asset = assetStore.get(id, assetId); if (!asset) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!renderSigner) return reply.code(503).send({ error: { code: 'RENDER_NOT_CONFIGURED' } });
    return { url: renderSigner.url(asset.mime === 'text/html' ? 'raw' : 'a', assetId, actor.tokenScopes?.tokenId ?? actor.user.id) };
  });
  const publicExport = (job: ExportJob) => ({ id: job.id, docId: job.doc_id, version: job.version, format: job.format, includePending: Boolean(job.include_pending), excludedSubmissionIds: asJson<string[]>(job.excluded_ids), status: job.status, error: job.error, createdAt: job.created_at, expiresAt: job.expires_at, ...(job.status === 'done' && renderSigner ? { downloadUrl: renderSigner.url('x', job.id, job.created_by) } : {}) });
  route('POST', '/docs/:id/exports', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    if (!renderSigner) return reply.code(503).send({ error: { code: 'RENDER_NOT_CONFIGURED' } });
    const body = isObject(request.body) ? request.body : {};
    if (!['html', 'pdf', 'zip'].includes(String(body.format)) || (body.version !== undefined && (!Number.isInteger(body.version) || Number(body.version) < 1)) || (body.includePending !== undefined && typeof body.includePending !== 'boolean')) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    if (body.includePending && roleFor(actor.user, id) === 'viewer') return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    const job = db.transaction(() => {
      const doc = db.prepare('SELECT current_version,ai_enabled FROM documents WHERE id=?').get(id) as { current_version: number; ai_enabled: number };
      if (actor.tokenScopes && (!actor.tokenScopes.has('read') || !doc.ai_enabled)) throw new HttpError(403, !doc.ai_enabled ? 'AI_DISABLED' : 'TOKEN_SCOPE');
      const version = Number(body.version ?? doc.current_version);
      if (body.includePending && version !== doc.current_version) throw new HttpError(409, 'PENDING_REQUIRES_CURRENT_VERSION');
      const source = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(id, version) as { content: string } | undefined;
      if (!source) throw new HttpError(404, 'VERSION_NOT_FOUND');
      const active = (db.prepare("SELECT count(*) n FROM exports WHERE created_by=? AND status IN ('queued','running')").get(actor.user.id) as { n: number }).n;
      const daily = (db.prepare('SELECT count(*) n FROM exports WHERE created_by=? AND created_at>?').get(actor.user.id, new Date(Date.now() - 86400000).toISOString()) as { n: number }).n;
      const global = (db.prepare("SELECT count(*) n FROM exports WHERE status IN ('queued','running')").get() as { n: number }).n;
      if (active >= 3 || daily >= 20 || global >= 100) throw new HttpError(429, 'EXPORT_QUEUE_FULL');
      let snapshot = source.content; let excluded: string[] = [];
      if (body.includePending) {
        const ids = (db.prepare("SELECT id FROM submissions WHERE doc_id=? AND status='pending' ORDER BY created_at,id").all(id) as Array<{ id: string }>).map((row) => row.id);
        const preview = calculatePreview(db, id, version, ids, {}); snapshot = JSON.stringify(preview.candidate); excluded = preview.items.filter((item) => item.status === 'needs_resolution').map((item) => item.submissionId);
      }
      if (Buffer.byteLength(snapshot) > 3 * 1024 * 1024) throw new HttpError(413, 'EXPORT_TOO_LARGE');
      assetStore.validate(id, asJson<Document>(snapshot));
      const exportId = randomId('ex'); const createdAt = isoNow();
      const tokenHash = actor.tokenScopes ? sessionSecret(request.headers.authorization!.slice(7)) : null;
      db.prepare('INSERT INTO exports(id,doc_id,version,format,include_pending,snapshot,excluded_ids,locale,created_by,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(exportId, id, version, String(body.format), Number(Boolean(body.includePending)), snapshot, JSON.stringify(excluded), actor.user.locale, actor.user.id, tokenHash, createdAt, new Date(Date.now() + 86400000).toISOString());
      return db.prepare('SELECT * FROM exports WHERE id=?').get(exportId) as ExportJob;
    })();
    return reply.code(202).send({ export: publicExport(job) });
  });
  route('GET', '/exports/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const job = db.prepare('SELECT * FROM exports WHERE id=?').get((request.params as { id: string }).id) as ExportJob | undefined;
    if (!job || job.created_by !== actor.user.id) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, job.doc_id, 'viewer', actor.tokenScopes, reply)) return;
    if (actor.tokenScopes && (!actor.tokenScopes.has('read') || !db.prepare('SELECT 1 FROM documents WHERE id=? AND ai_enabled=1').get(job.doc_id))) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    if (Date.parse(job.expires_at) <= Date.now()) return reply.code(410).send({ error: { code: 'EXPORT_EXPIRED' } });
    if (!canAccessExport(db, job, actor.user.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return { export: publicExport(job) };
  });
  route('GET', '/docs/:id/export', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const query = request.query as { format?: string; v?: string };
    const docRow = db.prepare('SELECT current_version FROM documents WHERE id=?').get(id) as { current_version: number } | undefined;
    if (!docRow) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const version = query.v ? Number(query.v) : docRow.current_version;
    const row = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(id, version) as { content: string } | undefined;
    if (!row) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const content = asJson<Document>(row.content);
    const referencedAssets = [...documentAssetIds(content)].map((assetId) => assetStore.get(id, assetId));
    if (referencedAssets.some((asset) => !asset)) return reply.code(409).send({ error: { code: 'ASSET_NOT_FOUND' } });
    const assetBytes = referencedAssets.reduce((total, asset) => total + asset!.size, 0);
    if (assetBytes + Buffer.byteLength(row.content) > archiveLimits.expandedBytes) return reply.code(413).send({ error: { code: 'EXPORT_TOO_LARGE' } });
    if (query.format === 'json') return reply.type('application/json; charset=utf-8').header('Content-Disposition', `attachment; filename="${id}-v${version}.json"`).send(JSON.stringify({ version, content }, null, 2));
    if (query.format !== 'html' && query.format !== 'zip') return reply.code(400).send({ error: { code: 'UNSUPPORTED_EXPORT_FORMAT' } });
    try {
      const result = await buildExport(content, version, query.format, assetStore, actor.user.locale === 'en' ? 'en' : 'zh-CN', isoNow());
      return reply.type(result.mime).header('Content-Disposition', `attachment; filename="${id}-v${version}.${query.format}"`).send(result.bytes);
    } catch (error) { if (error instanceof ExportError) return reply.code(409).send({ error: { code: error.code } }); throw error; }
  });
  route('PATCH', '/docs/:id', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.aiEnabled === 'boolean') db.prepare('UPDATE documents SET ai_enabled=?,updated_at=? WHERE id=?').run(Number(body.aiEnabled), isoNow(), id);
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as Record<string, unknown>;
    return { doc: { id, title: doc.title, currentVersion: doc.current_version, aiEnabled: Boolean(doc.ai_enabled), role: 'owner' } };
  });

  route('GET', '/docs/:id/source', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const imported = db.prepare("SELECT source_html,source_data,filename FROM imports WHERE confirmed_doc_id=? AND status='confirmed' ORDER BY created_at LIMIT 1").get(id) as { source_html: string; source_data: Buffer | null; filename: string } | undefined;
    if (!imported) return reply.code(404).send({ error: { code: 'IMPORT_SOURCE_NOT_FOUND' } });
    const extension = /\.zip$/i.test(imported.filename) ? 'zip' : 'html';
    const filename = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-original.${extension}`;
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "sandbox; default-src 'none'").send(imported.source_data ?? imported.source_html);
  });
  route('GET', '/docs/:id/share-links', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (rejectToken(actor, reply) || !requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    const links = db.prepare('SELECT id,role,version_pin,show_comments,expires_at,revoked_at,created_at FROM share_links WHERE doc_id=? ORDER BY created_at DESC').all(id) as Array<Record<string, unknown>>;
    return { commenterAvailable: Boolean(options.mailDelivery), links: links.map((link) => ({ id: link.id, role: link.role, versionPin: link.version_pin, showComments: Boolean(link.show_comments), commenterAvailable: Boolean(options.mailDelivery), expiresAt: link.expires_at, revokedAt: link.revoked_at, createdAt: link.created_at, active: !link.revoked_at && (!link.expires_at || String(link.expires_at) > isoNow()) })) };
  });
  route('POST', '/docs/:id/share-links', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (rejectToken(actor, reply) || !requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const role = body.role === 'commenter' ? 'commenter' : body.role === 'viewer' ? 'viewer' : null;
    if (!role) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    if (role === 'commenter' && !options.mailDelivery) return reply.code(503).send({ error: { code: 'SMTP_NOT_CONFIGURED' } });
    const pin = body.versionPin === undefined || body.versionPin === null ? null : Number(body.versionPin);
    if (pin !== null && (!Number.isInteger(pin) || pin < 1 || !db.prepare('SELECT 1 FROM versions WHERE doc_id=? AND version=?').get(id, pin))) return reply.code(400).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const days = body.expiresInDays === undefined || body.expiresInDays === null ? null : Number(body.expiresInDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 90)) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const raw = randomBytes(32).toString('base64url'); const now = isoNow(); const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString(); const linkId = randomId('sl');
    db.prepare('INSERT INTO share_links(id,doc_id,token_hash,role,version_pin,show_comments,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(linkId, id, sessionSecret(raw), role, pin, body.showComments === false ? 0 : 1, expiresAt, actor.user.id, now);
    return reply.code(201).send({ link: { id: linkId, role, versionPin: pin, showComments: body.showComments !== false, commenterAvailable: Boolean(options.mailDelivery), expiresAt, createdAt: now, url: `${appUrl}/s/${raw}` } });
  });
  route('DELETE', '/docs/:id/share-links/:linkId', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id, linkId } = request.params as { id: string; linkId: string };
    if (rejectToken(actor, reply) || !requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    const changed = db.prepare('UPDATE share_links SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND doc_id=?').run(isoNow(), linkId, id);
    if (!changed.changes) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    db.prepare('DELETE FROM guest_sessions WHERE link_id=?').run(linkId);
    return reply.code(204).send();
  });
  route('GET', '/s/:token/doc', async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = db.prepare('SELECT * FROM share_links WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').get(sessionSecret(token), isoNow()) as Record<string, unknown> | undefined;
    if (!link) return reply.code(404).send({ error: { code: 'INVITE_INVALID' } });
    const doc = db.prepare('SELECT id,title,current_version FROM documents WHERE id=?').get(link.doc_id) as { id: string; title: string; current_version: number } | undefined;
    if (!doc) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const version = link.version_pin ? Number(link.version_pin) : doc.current_version;
    const snapshot = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(doc.id, version) as { content: string } | undefined;
    if (!snapshot) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const content = asJson<Document>(snapshot.content);
    return { doc: { id: doc.id, title: content.title, ...(link.version_pin === null ? { currentVersion: doc.current_version } : {}), version, role: link.role, showComments: Boolean(link.show_comments), commenterAvailable: Boolean(options.mailDelivery), expiresAt: link.expires_at, aiEnabled: Boolean((db.prepare('SELECT ai_enabled FROM documents WHERE id=?').get(doc.id) as { ai_enabled: number }).ai_enabled) }, content, guest: (() => { const guest = link.role === 'commenter' ? guestAccess.session(request, String(link.id)) : undefined; return guest ? { id: guest.guest_id, name: guest.name } : null; })() };
  });
  route('GET', '/s/:token/assets/:assetId', async (request, reply) => {
    const { token, assetId } = request.params as { token: string; assetId: string };
    const link = db.prepare('SELECT doc_id,version_pin FROM share_links WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').get(sessionSecret(token), isoNow()) as { doc_id: string; version_pin: number | null } | undefined;
    if (!link) return reply.code(404).send({ error: { code: 'INVITE_INVALID' } });
    const snapshot = db.prepare('SELECT v.content FROM versions v JOIN documents d ON d.id=v.doc_id WHERE v.doc_id=? AND v.version=COALESCE(?,d.current_version)').get(link.doc_id, link.version_pin) as { content: string } | undefined;
    if (!snapshot || !imageAssetIds(asJson<Document>(snapshot.content)).has(assetId)) return reply.code(404).send({ error: { code: 'ASSET_NOT_FOUND' } });
    const asset = assetStore.get(link.doc_id, assetId);
    if (!asset || !asset.mime.startsWith('image/')) return reply.code(404).send({ error: { code: 'ASSET_NOT_FOUND' } });
    return reply.type(asset.mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'none'").header('Content-Disposition', 'inline').send(await assetStore.read(asset));
  });
  route('GET', '/s/:token/assets/:assetId/url', async (request, reply) => {
    const { token, assetId } = request.params as { token: string; assetId: string };
    const link = db.prepare('SELECT l.id,l.doc_id,l.role,v.content FROM share_links l JOIN documents d ON d.id=l.doc_id JOIN versions v ON v.doc_id=d.id AND v.version=COALESCE(l.version_pin,d.current_version) WHERE l.token_hash=? AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>?)').get(sessionSecret(token), isoNow()) as { id: string; doc_id: string; role: string; content: string } | undefined;
    if (!link || !documentAssetIds(asJson<Document>(link.content)).has(assetId)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const asset = assetStore.get(link.doc_id, assetId); if (!asset) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!renderSigner) return reply.code(503).send({ error: { code: 'RENDER_NOT_CONFIGURED' } });
    return { url: renderSigner.url(asset.mime === 'text/html' ? 'raw' : 'a', assetId, link.role === 'commenter' ? guestAccess.session(request, link.id)!.id : link.id) };
  });
  route('GET', '/s/:token/comments', async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = db.prepare('SELECT doc_id,show_comments,version_pin FROM share_links WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').get(sessionSecret(token), isoNow()) as { doc_id: string; show_comments: number; version_pin: number | null } | undefined;
    if (!link) return reply.code(404).send({ error: { code: 'INVITE_INVALID' } });
    if (!link.show_comments) return reply.code(404).send({ error: { code: 'COMMENTS_HIDDEN' } });
    const snapshot = db.prepare('SELECT v.version,v.content FROM documents d JOIN versions v ON v.doc_id=d.id AND v.version=COALESCE(?,d.current_version) WHERE d.id=?').get(link.version_pin, link.doc_id) as { version: number; content: string } | undefined;
    if (!snapshot) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const visible = asJson<Document>(snapshot.content);
    const roots = db.prepare("SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.doc_id=? AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.status='open' AND (? IS NULL OR c.created_version<=?) ORDER BY c.created_at DESC").all(link.doc_id, link.version_pin, link.version_pin) as Record<string, unknown>[];
    return { threads: roots.map((root) => {
      const projected = projectCommentAnchor(asJson<Anchor>(String(root.anchor)), visible, snapshot.version, root.anchor_state as AnchorState);
      const comment = publicComment({ ...root, anchor: JSON.stringify(projected.anchor), anchor_state: projected.state, anchor_range: projected.range ? JSON.stringify(projected.range) : null });
      const replies = (db.prepare('SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.parent_id=? AND c.doc_id=? AND c.deleted_at IS NULL AND (? IS NULL OR ? IS NOT NULL OR c.created_version<=?) ORDER BY c.created_at').all(root.id, link.doc_id, link.version_pin, root.guest_id, link.version_pin) as Record<string, unknown>[]).map((reply) => publicComment({ ...reply, anchor: '{}', anchor_state: 'ok', anchor_range: null }));
      return { root: comment, replies, anchorState: projected.state, ...(projected.range ? { range: projected.range } : {}) };
    }) };
  });
  route('POST', '/s/:token/comments', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const link = shareLink((request.params as { token: string }).token)!;
    const guest = guestAccess.session(request, link.id);
    if (link.role !== 'commenter' || !guest) return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    if (!link.show_comments) return reply.code(404).send({ error: { code: 'COMMENTS_HIDDEN' } });
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 5000) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const parsed = AnchorSchema.safeParse(body.anchor ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const snapshot = db.prepare('SELECT d.ai_enabled,v.version,v.content FROM documents d JOIN versions v ON v.doc_id=d.id AND v.version=COALESCE(?,d.current_version) WHERE d.id=?').get(link.version_pin, link.doc_id) as { ai_enabled: number; version: number; content: string };
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    const located = locateNewCommentAnchor(parentId ? {} : parsed.data, link.doc_id, snapshot.content, snapshot.version, false);
    const parent = parentId ? db.prepare("SELECT thread_id FROM comments WHERE id=? AND doc_id=? AND parent_id IS NULL AND deleted_at IS NULL AND status='open' AND (? IS NULL OR created_version<=?)").get(parentId, link.doc_id, link.version_pin, link.version_pin) as { thread_id: string } | undefined : undefined;
    if (parentId && !parent) return reply.code(404).send({ error: { code: 'COMMENT_NOT_FOUND' } });
    const id = randomId('cm'); const threadId = parent?.thread_id ?? id; const now = isoNow();
    const text = body.body.trim().replace(/@\[([^\]\n]{1,100})\]\(u_[a-zA-Z0-9]+\)/g, '@$1');
    let aiTask: ReturnType<typeof createAiTask> | undefined;
    db.transaction(() => {
      if (!parentId && !link.version_pin && (db.prepare('SELECT current_version FROM documents WHERE id=?').get(link.doc_id) as { current_version: number }).current_version !== snapshot.version) throw new HttpError(409, 'ANCHOR_STALE');
      db.prepare('INSERT INTO comments(id,doc_id,thread_id,parent_id,guest_id,body,anchor,anchor_state,anchor_range,created_at,created_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, link.doc_id, threadId, parentId, guest.guest_id, text, JSON.stringify(parentId ? {} : { ...located.anchor, version: snapshot.version }), parentId ? 'ok' : located.state, !parentId && located.range ? JSON.stringify(located.range) : null, now, snapshot.version);
      if (!parentId && snapshot.ai_enabled && /@\[(?:ai|AI)\]\(ai\)/.test(text)) aiTask = createAiTask(link.doc_id, guest.guest_id, text.replace(/@\[(?:ai|AI)\]\(ai\)/g, '').trim(), located.anchor.moduleId ? [located.anchor.moduleId] : [], id);
      if (!parentId && !snapshot.ai_enabled && /@\[(?:ai|AI)\]\(ai\)/.test(text)) addSystemReply(db, id, '这份文档没有开启 AI。 / AI is disabled for this document.', now);
      if (parentId) {
        const participants = db.prepare('SELECT DISTINCT user_id FROM comments WHERE thread_id=? AND user_id IS NOT NULL AND deleted_at IS NULL').all(threadId) as Array<{ user_id: string }>;
        for (const participant of participants) {
          const user = db.prepare('SELECT * FROM users WHERE id=? AND disabled_at IS NULL').get(participant.user_id) as User | undefined;
          if (user && roleFor(user, link.doc_id)) db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(randomId('nt'), user.id, link.doc_id, 'reply', JSON.stringify({ commentId: id, threadId, actor: { id: guest.guest_id, name: guest.name, external: true } }), now);
        }
      }
    })();
    return reply.code(201).send({ comment: publicComment(db.prepare('SELECT c.*,g.name author FROM comments c JOIN guests g ON g.id=c.guest_id WHERE c.id=?').get(id) as Record<string, unknown>), ...(aiTask ? { aiTask } : {}) });
  });
  route('GET', '/docs/:id/import-report', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const imported = db.prepare("SELECT id,filename,report,created_at FROM imports WHERE confirmed_doc_id=? AND status='confirmed' ORDER BY created_at LIMIT 1").get(id) as { id: string; filename: string; report: string; created_at: string } | undefined;
    if (!imported) return reply.code(404).send({ error: { code: 'IMPORT_SOURCE_NOT_FOUND' } });
    return reply.header('Cache-Control', 'no-store').send({ importId: imported.id, documentId: id, filename: imported.filename, createdAt: imported.created_at, report: asJson(imported.report) });
  });

  route('GET', '/docs/:id/draft', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'editor', actor.tokenScopes, reply)) return;
    const draft = db.prepare('SELECT base_version,content,updated_at FROM drafts WHERE doc_id=? AND user_id=?').get(id, actor.user.id) as { base_version: number; content: string; updated_at: string } | undefined;
    return { draft: draft ? { baseVersion: draft.base_version, content: asJson(draft.content), updatedAt: draft.updated_at } : null };
  });
  route('PUT', '/docs/:id/draft', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'editor', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const baseVersion = Number(body.baseVersion);
    if (!Number.isInteger(baseVersion) || baseVersion < 1 || !db.prepare('SELECT 1 FROM versions WHERE doc_id=? AND version=?').get(id, baseVersion)) return reply.code(400).send({ error: { code: 'INVALID_BASE_VERSION' } });
    const content = normalizeContent(body.content, randomNodeId, undefined, id);
    const valid = validateDocument(content);
    if (!valid.ok) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', details: valid.error } });
    try { assetStore.validate(id, content); } catch (error) { if (error instanceof AssetError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
    const now = isoNow();
    db.prepare('INSERT INTO drafts(doc_id,user_id,base_version,content,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(doc_id,user_id) DO UPDATE SET base_version=excluded.base_version,content=excluded.content,updated_at=excluded.updated_at').run(id, actor.user.id, baseVersion, JSON.stringify(content), now);
    return { draft: { baseVersion, content, updatedAt: now } };
  });
  route('DELETE', '/docs/:id/draft', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'editor', actor.tokenScopes, reply)) return;
    db.prepare('DELETE FROM drafts WHERE doc_id=? AND user_id=?').run(id, actor.user.id); return reply.code(204).send();
  });
  route('POST', '/docs/:id/submissions', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id: docId } = request.params as { id: string };
    if (!requireRole(actor.user, docId, 'editor', actor.tokenScopes, reply)) return;
    const body = parseSubmissionInput(request.body);
    if ((body.aiTaskId !== undefined || body.claimId !== undefined) && (!body.aiTaskId || !body.claimId || !actor.tokenScopes?.has('ai_tasks'))) throw new SubmissionInputError(403, 'TOKEN_SCOPE');
    if (body.aiTaskId && body.content !== undefined && (!isObject(body.content) || body.content.id !== docId)) throw new SubmissionInputError(403, 'TOKEN_SCOPE', { paths: ['/document/id'] });
    const baseVersion = body.baseVersion;
    const row = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(docId, baseVersion) as { content: string } | undefined;
    if (!row) throw new SubmissionInputError(400, 'BASE_VERSION_NOT_FOUND');
    const idem = request.headers['idempotency-key'] ?? body.idempotencyKey;
    if (typeof idem !== 'string' || !idem.trim() || idem.length > 100) throw new SubmissionInputError(400, 'IDEMPOTENCY_KEY_REQUIRED');
    const requestHash = hash(submissionRequestFingerprint(body));
    if (body.aiTaskId) expireAiTasks(db);
    const result = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM submissions WHERE doc_id=? AND author_id=? AND idempotency_key=?').get(docId, actor.user.id, idem) as Record<string, unknown> | undefined;
      if (existing) {
        if (existing.ai_task_id && existing.created_token !== actor.tokenScopes?.tokenId) throw new SubmissionInputError(409, 'TASK_CLAIM_MISMATCH');
        if (existing.request_hash) {
          if (existing.request_hash !== requestHash) throw new SubmissionInputError(409, 'IDEMPOTENCY_MISMATCH');
        } else {
          if (body.content === undefined) throw new SubmissionInputError(409, 'IDEMPOTENCY_MISMATCH');
          const content = normalizeContent(body.content, randomNodeId, undefined, docId);
          const payloadHash = hash(canonicalJson({ baseVersion, content, message: body.message ?? '', ...(body.aiTaskId ? { aiTaskId: body.aiTaskId, claimId: body.claimId } : {}) }));
          if (existing.payload_hash !== payloadHash) throw new SubmissionInputError(409, 'IDEMPOTENCY_MISMATCH');
        }
        return { created: false, row: existing };
      }
      const materialized = materializeSubmission(asJson<Document>(row.content), body, { next: (prefix) => randomId(prefix, 8) });
      const { content } = materialized; assetStore.validate(docId, content);
      if (body.aiTaskId) validateTaskSubmission(db, body.aiTaskId, { userId: actor.user.id, tokenId: actor.tokenScopes!.tokenId }, body.claimId, docId, baseVersion, content, materialized.ops);
      const submissionId = randomId('sub'); const now = isoNow();
      const payloadHash = hash(canonicalJson({ baseVersion, content, message: body.message ?? '', ...(body.aiTaskId ? { aiTaskId: body.aiTaskId, claimId: body.claimId } : {}) }));
      db.prepare("INSERT INTO submissions(id,doc_id,author_id,base_version,message,content,status,idempotency_key,payload_hash,created_at,request_hash,id_map,operations,uncertain_ids,ai_task_id,ai_claim_id,created_token) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?)").run(submissionId, docId, actor.user.id, baseVersion, body.message ?? '', JSON.stringify(content), idem, payloadHash, now, requestHash, JSON.stringify(materialized.idMap), materialized.ops ? JSON.stringify(materialized.ops) : null, JSON.stringify(materialized.uncertain), body.aiTaskId ?? null, body.claimId ?? null, actor.tokenScopes?.tokenId ?? null);
      if (!actor.tokenScopes) db.prepare('DELETE FROM drafts WHERE doc_id=? AND user_id=?').run(docId, actor.user.id);
      notifyOwners(db, docId, actor.user.id, submissionId, now);
      return { created: true, row: db.prepare('SELECT * FROM submissions WHERE id=?').get(submissionId) as Record<string, unknown> };
    })();
    const submission = publicSubmission(result.row);
    return reply.code(result.created ? 201 : 200).send({ submission, submissionId: submission.id, opCount: submission.opCount, uncertainCount: submission.uncertainCount, idMap: submission.idMap });
  });
  route('GET', '/docs/:id/submissions', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'commenter', actor.tokenScopes, reply, 'read')) return;
    const query = request.query as { status?: string; author?: string };
    const rows = db.prepare(`SELECT s.*,u.name author FROM submissions s JOIN users u ON u.id=s.author_id WHERE s.doc_id=? ${query.status ? 'AND s.status=?' : ''} ${query.author ? 'AND s.author_id=?' : ''} ORDER BY s.created_at DESC`).all(...[id, ...(query.status ? [query.status] : []), ...(query.author ? [query.author] : [])]) as Record<string, unknown>[];
    return { submissions: rows.map(publicSubmission) };
  });
  route('GET', '/submissions/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT s.*,u.name author FROM submissions s JOIN users u ON u.id=s.author_id WHERE s.id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(row.doc_id), 'commenter', actor.tokenScopes, reply, 'read')) return;
    const base = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(row.doc_id, row.base_version) as { content: string } | undefined;
    const changeSet = base ? submissionChanges(asJson<Document>(base.content), asJson<Document>(String(row.content)), row.operations ? String(row.operations) : null, row.uncertain_ids ? String(row.uncertain_ids) : null) : { changes: [], unavailable: 'BASE_VERSION_NOT_FOUND' };
    return { submission: { ...publicSubmission(row), changes: base ? diffValues(asJson(base.content), asJson(String(row.content))) : [], changeSet } };
  });
  route('POST', '/submissions/:id/withdraw', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const submission = db.prepare('SELECT * FROM submissions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!submission || submission.author_id !== actor.user.id) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(submission.doc_id), 'editor', actor.tokenScopes, reply)) return;
    const updated = db.prepare('UPDATE submissions SET status=\'withdrawn\' WHERE id=? AND status=\'pending\'').run(id);
    if (!updated.changes) return reply.code(409).send({ error: { code: 'SUBMISSION_STATE_CONFLICT' } });
    return { submission: publicSubmission(db.prepare('SELECT s.*,u.name author FROM submissions s JOIN users u ON u.id=s.author_id WHERE s.id=?').get(id) as Record<string, unknown>) };
  });
  route('POST', '/submissions/:id/reject', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const submission = db.prepare('SELECT * FROM submissions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!submission) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(submission.doc_id), 'owner', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const updated = db.prepare('UPDATE submissions SET status=\'rejected\' WHERE id=? AND status=\'pending\'').run(id);
    if (!updated.changes) return reply.code(409).send({ error: { code: 'SUBMISSION_STATE_CONFLICT' } });
    db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(randomId('nt'), submission.author_id, submission.doc_id, 'submission_rejected', JSON.stringify({ submissionId: id, reason: body.reason.trim() }), isoNow());
    return { submission: publicSubmission(db.prepare('SELECT s.*,u.name author FROM submissions s JOIN users u ON u.id=s.author_id WHERE s.id=?').get(id) as Record<string, unknown>) };
  });
  route('POST', '/docs/:id/previews/prepare', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'commenter', actor.tokenScopes, reply, 'preview')) return;
    const body = isObject(request.body) ? request.body : {};
    if (body.submissionIds !== undefined && (!Array.isArray(body.submissionIds) || body.submissionIds.length > 100 || body.submissionIds.some((value) => typeof value !== 'string') || new Set(body.submissionIds).size !== body.submissionIds.length)) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const ids = (body.submissionIds ?? (db.prepare("SELECT id FROM submissions WHERE doc_id=? AND status='pending' ORDER BY created_at,id LIMIT 101").all(id) as Array<{ id: string }>).map((row) => row.id)) as string[];
    if (ids.length > 100) return reply.code(400).send({ error: { code: 'PREVIEW_LIMIT' } });
    if (ids.some((submissionId) => !db.prepare("SELECT 1 FROM submissions WHERE id=? AND doc_id=? AND status='pending'").get(submissionId, id))) return reply.code(409).send({ error: { code: 'SUBMISSION_STATE_CONFLICT' } });
    const doc = db.prepare('SELECT current_version FROM documents WHERE id=?').get(id) as { current_version: number };
    const computed = calculatePreview(db, id, doc.current_version, ids, {}, true);
    if (!validateDocument(computed.candidate).ok) throw new HttpError(422, 'INVALID_PREVIEW_CANDIDATE');
    const { presentationInput, ...candidate } = computed;
    const presentation = await changeWorker.review(presentationInput!);
    if (!recheckDocumentAccess(request, reply, id, 'commenter', 'preview')) return;
    return { preview: { ...candidate, presentation, baseVersion: doc.current_version, submissionIds: ids, readOnly: true } };
  });
  route('POST', '/docs/:id/previews', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id: docId } = request.params as { id: string };
    if (!requireRole(actor.user, docId, 'owner', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (body.submissionIds !== undefined && (!Array.isArray(body.submissionIds) || body.submissionIds.length > 100 || body.submissionIds.some(value => typeof value !== 'string') || new Set(body.submissionIds).size !== body.submissionIds.length)) throw new HttpError(400, 'VALIDATION_FAILED');
    const ids = (body.submissionIds ?? (db.prepare("SELECT id FROM submissions WHERE doc_id=? AND status='pending' ORDER BY created_at,id LIMIT 101").all(docId) as Array<{ id: string }>).map(row => row.id)) as string[];
    if (ids.length > 100) throw new HttpError(400, 'PREVIEW_LIMIT');
    if (ids.some(submissionId => !db.prepare("SELECT 1 FROM submissions WHERE id=? AND doc_id=? AND status='pending'").get(submissionId, docId))) throw new HttpError(409, 'SUBMISSION_STATE_CONFLICT');
    const doc = db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId) as { current_version: number } | undefined;
    if (!doc || ids.length === 0) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const result = calculatePreview(db, docId, doc.current_version, ids, {}, true);
    if (!validateDocument(result.candidate).ok) throw new HttpError(422, 'INVALID_PREVIEW_CANDIDATE');
    const previewId = randomId('pv'); const now = isoNow();
    db.prepare('UPDATE previews SET status=\'stale\' WHERE doc_id=? AND status=\'open\'').run(docId);
    db.prepare('INSERT INTO previews(id,doc_id,base_version,revision,submission_ids,resolutions,candidate,conflicts,publishable,status,created_by,created_at) VALUES(?,?,?,1,? ,\'{}\',?,?,?,\'open\',?,?)').run(previewId, docId, doc.current_version, JSON.stringify(ids), JSON.stringify(result.candidate), JSON.stringify(result.conflicts), Number(result.publishable), actor.user.id, now);
    db.prepare('UPDATE previews SET items=?,presentation=NULL WHERE id=?').run(JSON.stringify(result.items), previewId);
    const preview = await saveReviewPresentation(previewId, 1, result.presentationInput!, request, reply, docId);
    if (!preview) return;
    return { preview };
  });
  route('GET', '/previews/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const preview = db.prepare('SELECT * FROM previews WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!preview) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(preview.doc_id), 'commenter', actor.tokenScopes, reply, 'preview')) return;
    return { preview: publicPreview(db, String(preview.id)) };
  });
  route('POST', '/previews/:id/conflicts/:conflictId/ai-suggest', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id, conflictId } = request.params as { id: string; conflictId: string };
    const preview = db.prepare('SELECT doc_id FROM previews WHERE id=?').get(id) as { doc_id: string } | undefined;
    if (!preview) throw new AiTaskError(404, 'NOT_FOUND');
    if (!requireRole(actor.user, preview.doc_id, 'owner', actor.tokenScopes, reply)) return;
    if (!db.prepare('SELECT 1 FROM documents WHERE id=? AND ai_enabled=1').get(preview.doc_id)) throw new AiTaskError(403, 'AI_DISABLED');
    const body = isObject(request.body) ? request.body : {};
    if (body.instruction !== undefined && (typeof body.instruction !== 'string' || body.instruction.length > 2000)) throw new AiTaskError(400, 'VALIDATION_FAILED');
    return { task: createResolveAiTask(db, id, conflictId, actor.user.id, String(body.instruction || 'Suggest a resolution for this conflict. Explain the reasoning; a human must review the result.'), body.revision) };
  });
  route('POST', '/previews/:id/resolutions', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const preview = db.prepare('SELECT * FROM previews WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!preview) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(preview.doc_id), 'owner', actor.tokenScopes, reply)) return;
    const updated = db.transaction(() => {
    const preview = db.prepare('SELECT * FROM previews WHERE id=?').get(id) as Record<string, unknown>;
    if (publicPreview(db, String(preview.id)).status !== 'open') return reply.code(409).send({ error: { code: 'PREVIEW_STALE' } });
    if (Number((request.body as { revision?: number })?.revision) !== Number(preview.revision)) return reply.code(409).send({ error: { code: 'PREVIEW_REVISION_STALE' } });
    const body = isObject(request.body) ? request.body : {};
    const conflictId = typeof body.conflictId === 'string' ? body.conflictId : '';
    const currentConflicts = asJson<Conflict[]>(String(preview.conflicts));
    const conflict = currentConflicts.find((item) => item.id === conflictId);
    if (!conflict) return reply.code(body.choice === 'ai' ? 409 : 404).send({ error: { code: body.choice === 'ai' ? 'PREVIEW_STALE' : 'CONFLICT_NOT_FOUND' } });
    let resolution: Resolution;
    if (body.choice === 'ai' && typeof body.taskId === 'string') resolution = adoptAiResolution(db, body.taskId, id, conflictId);
    else {
      const choice = body.choice as Resolution['choice'];
      if (!conflict.allowed.includes(choice)) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
      if (choice === 'manual' && typeof body.value !== 'string' && !Array.isArray(body.value)) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
      resolution = { choice, ...(body.value !== undefined ? { value: body.value } : {}), ...(choice === 'place' ? { parent: body.parent as Resolution['parent'], after: body.after as Resolution['after'] } : {}) };
      if (choice === 'place' && (!isObject(body.parent) || typeof body.parent.id !== 'string' || typeof body.parent.list !== 'string' || !(body.after === null || typeof body.after === 'string'))) throw new HttpError(400, 'VALIDATION_FAILED');
    }
    const resolutions = asJson<Record<string, Resolution>>(String(preview.resolutions));
    resolutions[conflictId] = { ...resolution, ...(conflict.fingerprint ? { fingerprint: conflict.fingerprint } : {}) };
    const ids = asJson<string[]>(String(preview.submission_ids));
    const currentVersion = Number((db.prepare('SELECT current_version FROM documents WHERE id=?').get(preview.doc_id) as { current_version: number }).current_version);
    const validatedCandidate = resolutionCandidate(db, String(preview.doc_id), currentVersion, ids, currentConflicts, resolutions);
    if (!validateDocument(validatedCandidate).ok) throw new HttpError(422, 'INVALID_PREVIEW_CANDIDATE');
    assetStore.validate(String(preview.doc_id), validatedCandidate);
    const result = calculatePreview(db, String(preview.doc_id), currentVersion, ids, resolutions, true);
    if (!validateDocument(result.candidate).ok) throw new HttpError(422, 'INVALID_PREVIEW_CANDIDATE');
    assetStore.validate(String(preview.doc_id), result.candidate);
    for (const item of result.conflicts) if (item.fingerprint && !item.resolution) delete resolutions[item.id];
    db.prepare('UPDATE previews SET revision=revision+1,resolutions=?,candidate=?,conflicts=?,publishable=? WHERE id=?').run(JSON.stringify(resolutions), JSON.stringify(result.candidate), JSON.stringify(result.conflicts), Number(result.publishable), id);
    db.prepare('UPDATE previews SET items=?,presentation=NULL WHERE id=?').run(JSON.stringify(result.items), id);
    return { presentationInput: result.presentationInput!, revision: Number(preview.revision) + 1 };
    })();
    if ('presentationInput' in updated) {
      const saved = await saveReviewPresentation(id, updated.revision, updated.presentationInput, request, reply, String(preview.doc_id));
      if (!saved) return;
      return { preview: saved };
    }
    return updated;
  });
  route('POST', '/previews/:id/publish', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const preview = db.prepare('SELECT * FROM previews WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!preview) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(preview.doc_id), 'owner', actor.tokenScopes, reply)) return;
    if (preview.status === 'published') {
      const version = Number(preview.published_version);
      const snapshot = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(preview.doc_id, version) as { content: string };
      return { doc: publicDoc(db, String(preview.doc_id), actor.user), version: { version, content: asJson(snapshot.content) } };
    }
    const body = isObject(request.body) ? request.body : {};
    const result = db.transaction(() => {
      // Reauthenticate after acquiring the publication lock: session validity,
      // account state and administrator status can change while it is queued.
      const freshActor = currentUser(request, reply);
      if (!freshActor) throw new HttpError(401, 'UNAUTHENTICATED');
      const fresh = db.prepare('SELECT * FROM previews WHERE id=?').get(id) as Record<string, unknown>;
      if (!requireRole(freshActor.user, String(fresh.doc_id), 'owner', freshActor.tokenScopes, reply)) return null;
      if (fresh.status === 'published') {
        const version = Number(fresh.published_version);
        const snapshot = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(fresh.doc_id, version) as { content: string };
        return { version, content: asJson<Document>(snapshot.content), doc: publicDoc(db, String(fresh.doc_id), freshActor.user) };
      }
      const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(fresh.doc_id) as Record<string, unknown>;
      if (fresh.status !== 'open' || Number(fresh.base_version) !== Number(doc.current_version) || Number(body.revision) !== Number(fresh.revision)) throw new HttpError(409, 'PREVIEW_STALE');
      const conflicts = asJson<Conflict[]>(String(fresh.conflicts));
      const resolutions = asJson<Record<string, Resolution>>(String(fresh.resolutions));
      if (!Boolean(fresh.publishable) || conflicts.some((item) => !resolutions[item.id])) throw new HttpError(409, 'CONFLICTS_UNRESOLVED');
      const submissions = asJson<string[]>(String(fresh.submission_ids));
      const pending = submissions.map((subId) => db.prepare('SELECT id,status FROM submissions WHERE id=? AND doc_id=?').get(subId, fresh.doc_id) as { id: string; status: string } | undefined);
      if (pending.some((item) => !item || item.status !== 'pending')) throw new HttpError(409, 'PREVIEW_STALE');
      const candidate = asJson<Document>(String(fresh.candidate));
      if (fresh.kind !== 'restore') {
        const recomputed = calculatePreview(db, String(fresh.doc_id), Number(doc.current_version), submissions, resolutions);
        if (!recomputed.publishable || canonicalJson(recomputed.candidate) !== canonicalJson(candidate)) throw new HttpError(409, 'PREVIEW_STALE');
      }
      const validation = validateDocument(candidate);
      if (!validation.ok) throw new HttpError(422, 'INVALID_PUBLISH_CANDIDATE');
      const content = JSON.stringify(candidate);
      const version = Number(doc.current_version) + 1; const now = isoNow();
      db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,?,?,?,?,?)').run(fresh.doc_id, version, fresh.kind === 'restore' ? 'restore' : 'publish', content, freshActor.user.id, now);
      db.prepare('UPDATE documents SET current_version=?,title=?,updated_at=? WHERE id=?').run(version, asJson<Document>(content).title, now, fresh.doc_id);
      const comments = db.prepare('SELECT id,anchor,anchor_state FROM comments WHERE doc_id=? AND parent_id IS NULL AND deleted_at IS NULL').all(fresh.doc_id) as Array<{ id: string; anchor: string; anchor_state: string }>;
      const updateAnchor = db.prepare('UPDATE comments SET anchor=?,anchor_state=?,anchor_range=? WHERE id=?');
      for (const comment of comments) {
        const located = relocateAnchor(asJson<Anchor>(comment.anchor), candidate);
        // A prior missing block remains a module fallback until explicitly relocated.
        const state = comment.anchor_state === 'block_deleted' && located.state === 'ok' && !located.anchor.blockId ? 'block_deleted' : located.state;
        updateAnchor.run(JSON.stringify({ ...located.anchor, version }), state, located.range ? JSON.stringify(located.range) : null, comment.id);
        if (state === 'lost' && comment.anchor_state !== 'lost') {
          const owners = db.prepare(`SELECT DISTINCT u.id FROM users u WHERE u.disabled_at IS NULL AND u.id<>? AND (EXISTS(SELECT 1 FROM document_members dm WHERE dm.doc_id=? AND dm.user_id=u.id AND dm.role='owner') OR EXISTS(SELECT 1 FROM documents d JOIN space_members sm ON sm.space_id=d.space_id WHERE d.id=? AND sm.user_id=u.id AND sm.role='owner'))`).all(freshActor.user.id, fresh.doc_id, fresh.doc_id) as Array<{ id: string }>;
          const notification = db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)');
          for (const owner of owners) notification.run(randomId('nt'), owner.id, fresh.doc_id, 'anchor_lost', JSON.stringify({ docId: fresh.doc_id, docTitle: candidate.title, commentId: comment.id, version, actor: { id: freshActor.user.id, name: freshActor.user.name } }), now);
        }
      }
      const update = db.prepare('UPDATE submissions SET status=\'published\',published_version=? WHERE id=? AND status=\'pending\'');
      submissions.forEach((subId) => { update.run(version, subId); const sub = db.prepare('SELECT author_id FROM submissions WHERE id=?').get(subId) as { author_id: string }; if (sub.author_id !== freshActor.user.id) db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(randomId('nt'), sub.author_id, fresh.doc_id, 'submission_published', JSON.stringify({ version }), now); });
      db.prepare('UPDATE previews SET status=\'published\',published_version=? WHERE id=?').run(version, id);
      return { version, content: asJson<Document>(content), doc: publicDoc(db, String(fresh.doc_id), freshActor.user) };
    });
    // A deferred transaction can read the old head in both instances, then fail
    // to upgrade its SQLite snapshot with SQLITE_BUSY. Lock before reading so
    // the second publisher observes the committed preview/head consistently.
    try { const published = result.immediate(); if (!published) return; return { doc: published.doc, version: { version: published.version, content: published.content } }; }
    catch (error) { if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code } }); throw error; }
  });

  route('GET', '/docs/:id/versions', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const versions = (db.prepare('SELECT v.version,v.kind,v.created_by,v.created_at,u.name author_name FROM versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.doc_id=? ORDER BY v.version DESC').all(id) as Array<{ version: number; kind: string; created_by: string; created_at: string; author_name: string | null }>).map((row) => ({ version: row.version, kind: row.kind, createdBy: row.created_by, authorName: row.author_name, createdAt: row.created_at }));
    return { versions };
  });
  route('GET', '/docs/:id/versions/:version', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id, version: versionParam } = request.params as { id: string; version: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const version = Number(versionParam);
    const row = db.prepare('SELECT v.*,u.name author_name FROM versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.doc_id=? AND v.version=?').get(id, version) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    return { version: { number: version, kind: row.kind, content: asJson(row.content as string), createdBy: row.created_by, authorName: row.author_name, createdAt: row.created_at } };
  });
  route('GET', '/docs/:id/compare', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const retry = requestLimit(`compare:${actor.user.id}`, 10, Date.now());
    if (retry) return reply.code(429).header('Retry-After', String(retry)).send({ error: { code: 'RATE_LIMITED' } });
    const query = request.query as { from?: string; to?: string };
    const from = Number(query.from); const to = Number(query.to);
    const snapshots = db.prepare('SELECT version,content FROM versions WHERE doc_id=? AND version IN (?,?)').all(id, from, to) as Array<{ version: number; content: string }>;
    const before = snapshots.find((snapshot) => snapshot.version === from); const after = snapshots.find((snapshot) => snapshot.version === to);
    if (!before || !after) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const result = await changeWorker.compare(id, from, to, before.content, after.content);
    if (!recheckDocumentAccess(request, reply, id, 'viewer')) return;
    return reply.type('application/json').send(result);
  });
  route('POST', '/docs/:id/restore', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'owner', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const source = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(id, Number(body.version)) as { content: string } | undefined;
    const doc = db.prepare('SELECT current_version FROM documents WHERE id=?').get(id) as { current_version: number } | undefined;
    if (!source || !doc) return reply.code(404).send({ error: { code: 'VERSION_NOT_FOUND' } });
    const current = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(id, doc.current_version) as { content: string };
    const candidate = asJson<Document>(source.content); const previewId = randomId('pv'); const now = isoNow();
    db.prepare('INSERT INTO previews(id,doc_id,base_version,revision,submission_ids,resolutions,candidate,conflicts,publishable,status,created_by,created_at,kind) VALUES(?,?,?,1,\'[]\',\'{}\',?,\'[]\',1,\'open\',?,?,\'restore\')').run(previewId, id, doc.current_version, JSON.stringify(candidate), actor.user.id, now);
    const input = captureReviewPresentation(db, id, doc.current_version, asJson<Document>(current.content), candidate, [], []);
    const preview = await saveReviewPresentation(previewId, 1, input, request, reply, id);
    if (!preview) return;
    return { preview: { ...preview, kind: 'restore', restoreVersion: Number(body.version) } };
  });

  route('GET', '/docs/:id/comments', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'viewer', actor.tokenScopes, reply)) return;
    const status = String((request.query as { status?: string }).status ?? 'open');
    const roots = db.prepare("SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.doc_id=? AND c.parent_id IS NULL AND (?='all' OR (?='relocate' AND c.anchor_state='lost' AND c.deleted_at IS NULL) OR c.status=?) ORDER BY c.created_at DESC").all(id, status, status, status) as Record<string, unknown>[];
    return { threads: roots.map((root) => ({ root: publicComment(root), replies: (db.prepare('SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.parent_id=? AND c.doc_id=? ORDER BY c.created_at').all(root.id, id) as Record<string, unknown>[]).map(publicComment), anchorState: root.anchor_state ?? 'ok', ...(root.anchor_range ? { range: asJson(String(root.anchor_range)) } : {}) })) };
  });
  route('POST', '/docs/:id/comments', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id: docId } = request.params as { id: string };
    if (!requireRole(actor.user, docId, 'commenter', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 5000) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const parsedAnchor = AnchorSchema.safeParse(body.anchor ?? {});
    if (!parsedAnchor.success) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const current = db.prepare('SELECT d.current_version,v.content FROM documents d JOIN versions v ON v.doc_id=d.id AND v.version=d.current_version WHERE d.id=?').get(docId) as { current_version: number; content: string };
    const commentBody = body.body.trim();
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    const located = locateNewCommentAnchor(parentId ? {} : parsedAnchor.data, docId, current.content, current.current_version);
    let threadId = randomId('cm');
    if (parentId) { const parent = db.prepare('SELECT thread_id FROM comments WHERE id=? AND doc_id=? AND parent_id IS NULL').get(parentId, docId) as { thread_id: string } | undefined; if (!parent) return reply.code(404).send({ error: { code: 'COMMENT_NOT_FOUND' } }); threadId = parent.thread_id; }
    const id = parentId ? randomId('cm') : threadId; const now = isoNow();
    let task: ReturnType<typeof createAiTask> | undefined;
    db.transaction(() => {
      if (!parentId && (db.prepare('SELECT current_version FROM documents WHERE id=?').get(docId) as { current_version: number }).current_version !== current.current_version) throw new HttpError(409, 'ANCHOR_STALE');
      db.prepare('INSERT INTO comments(id,doc_id,thread_id,parent_id,user_id,body,anchor,created_at,created_version) VALUES(?,?,?,?,?,?,?,?,?)').run(id, docId, threadId, parentId, actor.user.id, commentBody, JSON.stringify(parentId ? {} : { ...located.anchor, version: current.current_version }), now, current.current_version);
      if (!parentId) db.prepare('UPDATE comments SET anchor_state=?,anchor_range=? WHERE id=?').run(located.state, located.range ? JSON.stringify(located.range) : null, id);
      if (!parentId && /@\[(?:ai|AI)\]\(ai\)/.test(commentBody)) {
        const doc = db.prepare('SELECT ai_enabled FROM documents WHERE id=?').get(docId) as { ai_enabled: number };
        if (doc.ai_enabled) {
          const moduleIds = located.anchor.moduleId ? [located.anchor.moduleId] : [];
          task = createAiTask(docId, actor.user.id, commentBody.replace(/@\[(?:ai|AI)\]\(ai\)/g, '').trim(), moduleIds, id, !actor.tokenScopes && ['owner', 'editor'].includes(roleFor(actor.user, docId) ?? ''));
        } else addSystemReply(db, id, '这份文档没有开启 AI。 / AI is disabled for this document.', now);
      }
      const recipients = new Map<string, 'mention' | 'reply'>();
      if (parentId) {
        const participants = db.prepare('SELECT DISTINCT user_id FROM comments WHERE thread_id=? AND deleted_at IS NULL AND user_id IS NOT NULL').all(threadId) as Array<{ user_id: string }>;
        for (const participant of participants) recipients.set(participant.user_id, 'reply');
      }
      for (const match of commentBody.matchAll(/@\[[^\]\n]{1,100}\]\((u_[a-zA-Z0-9]+)\)/g)) recipients.set(match[1]!, 'mention');
      const doc = db.prepare('SELECT title FROM documents WHERE id=?').get(docId) as { title: string };
      const payload = JSON.stringify({ docId, docTitle: doc.title, commentId: id, threadId, actor: { id: actor.user.id, name: actor.user.name }, link: `/d/${docId}#comment-${id}` });
      const insert = db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)');
      for (const [userId, kind] of recipients) {
        if (userId === actor.user.id) continue;
        const recipient = db.prepare('SELECT * FROM users WHERE id=? AND disabled_at IS NULL').get(userId) as User | undefined;
        if (recipient && roleFor(recipient, docId)) insert.run(randomId('nt'), userId, docId, kind, payload, now);
      }
    })();
    return reply.code(201).send({ comment: publicComment(db.prepare('SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.id=?').get(id) as Record<string, unknown>), ...(task ? { aiTask: task } : {}) });
  });
  route('GET', '/comments/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.id=?').get(id) as Record<string, unknown> | undefined;
    if (!row || !requireRole(actor.user, String(row.doc_id), 'viewer', actor.tokenScopes, reply)) { if (!reply.sent) return reply.code(404).send({ error: { code: 'NOT_FOUND' } }); return; }
    return { comment: { ...publicComment(row), docId: row.doc_id } };
  });
  route('PATCH', '/comments/:id', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const comment = db.prepare('SELECT * FROM comments WHERE id=? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined;
    if (!comment || comment.user_id !== actor.user.id || !requireRole(actor.user, String(comment.doc_id), 'commenter', actor.tokenScopes, reply)) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 5000) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    db.prepare('UPDATE comments SET body=?,edited_at=? WHERE id=?').run(body.body.trim(), isoNow(), id);
    return { comment: publicComment(db.prepare('SELECT c.*,COALESCE(u.name,g.name) author FROM comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN guests g ON g.id=c.guest_id WHERE c.id=?').get(id) as Record<string, unknown>) };
  });
  route('DELETE', '/comments/:id', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const comment = db.prepare('SELECT * FROM comments WHERE id=? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined;
    if (!comment || comment.user_id !== actor.user.id) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(comment.doc_id), 'commenter', actor.tokenScopes, reply)) return;
    db.prepare('UPDATE comments SET deleted_at=?,body=\'\' WHERE id=?').run(isoNow(), id);
    return reply.code(204).send();
  });
  route('GET', '/ai-tasks', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (!actor.tokenScopes?.has('ai_tasks')) throw new AiTaskError(403, 'TOKEN_SCOPE');
    const query = request.query as { status?: string }; const status = query.status ?? 'approved';
    if (!taskStatuses.includes(status)) throw new AiTaskError(400, 'VALIDATION_FAILED');
    const allowedDocs = (db.prepare('SELECT id FROM documents WHERE ai_enabled=1').all() as Array<{ id: string }>).filter((doc) => (!actor.tokenScopes!.docIds || actor.tokenScopes!.docIds.has(doc.id)) && ['owner', 'editor', 'commenter'].includes(roleFor(actor.user, doc.id) ?? '')).map((doc) => doc.id);
    if (!allowedDocs.length) return { tasks: [] };
    const tasks = db.prepare(`SELECT * FROM ai_tasks WHERE status=? AND doc_id IN (${allowedDocs.map(() => '?').join(',')}) ORDER BY created_at DESC,id DESC LIMIT 200`).all(status, ...allowedDocs) as AiTask[];
    return { tasks: tasks.map(publicAiTask) };
  });
  route('GET', '/docs/:id/ai-tasks', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!requireRole(actor.user, id, 'commenter', actor.tokenScopes, reply, 'ai_tasks')) return;
    const query = request.query as { status?: string };
    if (query.status && !taskStatuses.includes(query.status)) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const rows = db.prepare(`SELECT * FROM ai_tasks WHERE doc_id=? ${query.status ? 'AND status=?' : ''} ORDER BY created_at DESC,id DESC LIMIT 200`).all(...(query.status ? [id, query.status] : [id])) as AiTask[];
    return { tasks: rows.map(publicAiTask) };
  });
  route('GET', '/ai-tasks/:id', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    const task = getAiTask(db, (request.params as { id: string }).id);
    if (!requireRole(actor.user, task.doc_id, 'commenter', actor.tokenScopes, reply, 'ai_tasks')) return;
    return { task: publicAiTask(task) };
  });
  route('POST', '/ai-tasks/:id/approve', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!task) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(task.doc_id), 'editor', actor.tokenScopes, reply)) return;
    const now = isoNow();
    const updated = db.prepare('UPDATE ai_tasks SET status=\'approved\',approved_by=?,updated_at=? WHERE id=? AND status=\'requested\'').run(actor.user.id, now, id);
    if (!updated.changes) return reply.code(409).send({ error: { code: 'TASK_STATE_CONFLICT' } });
    return { task: publicAiTask(getAiTask(db, id)) };
  });
  route('POST', '/ai-tasks/:id/reject', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!task) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(task.doc_id), 'editor', actor.tokenScopes, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const now = isoNow();
    const updated = db.prepare('UPDATE ai_tasks SET status=\'rejected\',result=?,approved_by=?,updated_at=? WHERE id=? AND status=\'requested\'').run(JSON.stringify({ reason: body.reason.trim() }), actor.user.id, now, id);
    if (!updated.changes) return reply.code(409).send({ error: { code: 'TASK_STATE_CONFLICT' } });
    if (task.requested_by) db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(randomId('nt'), task.requested_by, task.doc_id, 'ai_task_rejected', JSON.stringify({ taskId: id, reason: body.reason.trim() }), now);
    return { task: publicAiTask(getAiTask(db, id)) };
  });
  route('POST', '/ai-tasks/:id/cancel', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!task) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(task.doc_id), 'commenter', actor.tokenScopes, reply)) return;
    if (task.requested_by !== actor.user.id && !requireRole(actor.user, String(task.doc_id), 'editor', actor.tokenScopes, reply)) return;
    const updated = db.prepare('UPDATE ai_tasks SET status=\'cancelled\',updated_at=? WHERE id=? AND status IN (\'requested\',\'approved\')').run(isoNow(), id);
    if (!updated.changes) return reply.code(409).send({ error: { code: 'TASK_STATE_CONFLICT' } });
    return { task: publicAiTask(getAiTask(db, id)) };
  });
  for (const action of ['claim', 'complete', 'fail', 'suggest-resolution'] as const) route('POST', `/ai-tasks/:id/${action}`, async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    if (!actor.tokenScopes?.has('ai_tasks')) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    const task = getAiTask(db, id);
    if (!requireRole(actor.user, task.doc_id, 'editor', actor.tokenScopes, reply)) return;
    const worker = { userId: actor.user.id, tokenId: actor.tokenScopes.tokenId };
    const body = isObject(request.body) ? request.body : {};
    if (action === 'claim') return claimAiTask(db, id, worker);
    if (action === 'suggest-resolution') {
      if (!actor.tokenScopes.has('preview')) throw new AiTaskError(403, 'TOKEN_SCOPE');
      return { task: suggestAiResolution(db, id, worker, body.claimId, body.value, body.rationale, (preview, conflict, resolution) => {
        const resolutions = asJson<Record<string, Resolution>>(preview.resolutions); resolutions[conflict.id] = resolution;
        try {
          const candidate = resolutionCandidate(db, preview.doc_id, preview.base_version, asJson<string[]>(preview.submission_ids), asJson<Conflict[]>(preview.conflicts), resolutions);
          if (!validateDocument(candidate).ok) throw new AiTaskError(422, 'INVALID_SUGGESTION');
          assetStore.validate(preview.doc_id, candidate);
        } catch (error) {
          if (error instanceof MergeValidationError) throw new AiTaskError(422, 'INVALID_SUGGESTION');
          throw error;
        }
      }) };
    }
    return { task: action === 'complete' ? completeAiTask(db, id, worker, body.claimId, body.submissionId) : failAiTask(db, id, worker, body.claimId, body.reason) };
  });
  route('POST', '/comments/:id/resolve', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const comment = db.prepare('SELECT * FROM comments WHERE id=? AND parent_id IS NULL').get(id) as Record<string, unknown> | undefined;
    if (!comment) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(comment.doc_id), 'commenter', actor.tokenScopes, reply)) return;
    if (actor.tokenScopes && !actor.tokenScopes.has('comment')) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    const participant = db.prepare('SELECT 1 FROM comments WHERE doc_id=? AND thread_id=? AND user_id=? AND deleted_at IS NULL LIMIT 1').get(comment.doc_id, comment.thread_id, actor.user.id);
    if (!participant && roleFor(actor.user, String(comment.doc_id)) !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    db.prepare('UPDATE comments SET status=\'resolved\' WHERE thread_id=?').run(comment.thread_id); return { thread: { id: comment.thread_id, status: 'resolved' } };
  });
  route('POST', '/comments/:id/reopen', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const comment = db.prepare('SELECT * FROM comments WHERE id=? AND parent_id IS NULL').get(id) as Record<string, unknown> | undefined;
    if (!comment) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, String(comment.doc_id), 'commenter', actor.tokenScopes, reply)) return;
    if (actor.tokenScopes && !actor.tokenScopes.has('comment')) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    const participant = db.prepare('SELECT 1 FROM comments WHERE doc_id=? AND thread_id=? AND user_id=? AND deleted_at IS NULL LIMIT 1').get(comment.doc_id, comment.thread_id, actor.user.id);
    if (!participant && roleFor(actor.user, String(comment.doc_id)) !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
    db.prepare('UPDATE comments SET status=\'open\' WHERE thread_id=?').run(comment.thread_id); return { thread: { id: comment.thread_id, status: 'open' } };
  });
  route('POST', '/comments/:id/relocate', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return;
    const { id } = request.params as { id: string };
    const comment = db.prepare('SELECT doc_id FROM comments WHERE id=? AND parent_id IS NULL AND deleted_at IS NULL').get(id) as { doc_id: string } | undefined;
    if (!comment) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!requireRole(actor.user, comment.doc_id, 'owner', actor.tokenScopes, reply)) return;
    const parsed = AnchorSchema.safeParse(isObject(request.body) ? request.body.anchor : undefined);
    if (!parsed.success || !parsed.data.moduleId) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const current = db.prepare('SELECT d.current_version,v.content FROM documents d JOIN versions v ON v.doc_id=d.id AND v.version=d.current_version WHERE d.id=?').get(comment.doc_id) as { current_version: number; content: string };
    const located = locateNewCommentAnchor(parsed.data, comment.doc_id, current.content, current.current_version);
    if (located.state !== 'ok') return reply.code(400).send({ error: { code: 'ANCHOR_NOT_FOUND' } });
    db.transaction(() => {
      if ((db.prepare('SELECT current_version FROM documents WHERE id=?').get(comment.doc_id) as { current_version: number }).current_version !== current.current_version) throw new HttpError(409, 'ANCHOR_STALE');
      db.prepare('UPDATE comments SET anchor=?,anchor_state=?,anchor_range=? WHERE id=?').run(JSON.stringify(located.anchor), located.state, located.range ? JSON.stringify(located.range) : null, id);
    })();
    return { thread: { id, anchorState: located.state, anchor: located.anchor, range: located.range } };
  });
  route('GET', '/me/notification-preferences', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    return { emailConfigured: Boolean(options.mailDelivery), email: notificationPreferences(db, actor.user.id) };
  });
  route('PUT', '/me/notification-preferences', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (!isObject(body.email) || Object.keys(body.email).some((event) => !mailEvents.includes(event as MailEvent) || typeof (body.email as Record<string, unknown>)[event] !== 'boolean')) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    db.transaction(() => {
      for (const [event, enabled] of Object.entries(body.email as Record<string, boolean>)) db.prepare('INSERT INTO notification_preferences(user_id,event,email_enabled) VALUES(?,?,?) ON CONFLICT(user_id,event) DO UPDATE SET email_enabled=excluded.email_enabled').run(actor.user.id, event, Number(enabled));
    })();
    return { emailConfigured: Boolean(options.mailDelivery), email: notificationPreferences(db, actor.user.id) };
  });
  route('GET', '/notifications', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const unread = (request.query as { unread?: string }).unread === '1';
    const rows = db.prepare(`SELECT n.*,d.title AS docTitle FROM notifications n JOIN documents d ON d.id=n.doc_id WHERE n.user_id=? ${unread ? 'AND n.read_at IS NULL' : ''} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`).all(actor.user.id) as Record<string, unknown>[];
    return { notifications: rows.filter((row) => roleFor(actor.user, String(row.doc_id))).map((row) => ({ ...row, payload: asJson(row.payload as string) })) };
  });
  route('GET', '/notifications/unread-count', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const rows = db.prepare('SELECT doc_id,COUNT(*) count FROM notifications WHERE user_id=? AND read_at IS NULL GROUP BY doc_id').all(actor.user.id) as Array<{ doc_id: string; count: number }>;
    return { count: rows.reduce((total, row) => total + (roleFor(actor.user, row.doc_id) ? row.count : 0), 0) };
  });
  route('POST', '/notifications/read', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    if (body.all === true && body.ids === undefined) db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(isoNow(), actor.user.id);
    else if (body.all === undefined && Array.isArray(body.ids) && body.ids.length <= 100 && body.ids.every((id) => typeof id === 'string')) {
      const ids = body.ids as string[];
      db.transaction(() => { const update = db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND id=?'); for (const id of ids) update.run(isoNow(), actor.user.id, id); })();
    } else return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    return reply.code(204).send();
  });

  registerCliAuth(app, { ...options.cliAuth, db, appUrl, secret: secretKey, digest: sessionSecret, writeGuard, rateLimit: requestLimit,
    session: async (request, reply) => {
      if (request.headers.authorization) { reply.code(403).send({ error: { code: 'SESSION_REQUIRED' } }); return null; }
      const actor = await auth(request, reply); if (!actor) return null;
      return { id: actor.user.id, email: actor.user.email, name: actor.user.name, locale: actor.user.locale, sessionHash: sessionSecret(request.cookies[sessionCookie]!) };
    },
    documents: (session) => {
      const user = db.prepare('SELECT * FROM users WHERE id=? AND disabled_at IS NULL').get(session.id) as User | undefined;
      return user ? (db.prepare('SELECT id,title FROM documents ORDER BY title,id').all() as Array<{ id: string; title: string }>).filter(doc => roleFor(user, doc.id)) : [];
    },
  });
  registerOAuth(app, { ...options.oauth, db, appUrl, digest: sessionSecret, writeGuard, rateLimit: requestLimit,
    session: async (request, reply) => { const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return null; return { id: actor.user.id }; },
    documents: (session) => {
      const user = db.prepare('SELECT * FROM users WHERE id=? AND disabled_at IS NULL').get(session.id) as User | undefined;
      if (!user) return [];
      return (db.prepare('SELECT id,title FROM documents WHERE ai_enabled=1 ORDER BY title').all() as Array<{ id: string; title: string }>).filter((doc) => roleFor(user, doc.id));
    },
  });
  route('GET', '/spec', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor) return;
    if (actor.tokenScopes && !['read', 'comment', 'submit'].some((scope) => actor.tokenScopes!.has(scope as Scope))) return reply.code(403).send({ error: { code: 'TOKEN_SCOPE' } });
    return { spec: mcpSpec };
  });
  route('GET', '/me/tokens', async (request, reply) => {
    const actor = await auth(request, reply); if (!actor || rejectToken(actor, reply)) return;
    const tokens = db.prepare("SELECT id,name,scopes,doc_ids,expires_at,created_at,revoked_at,last_used_at,last_used_ip,kind FROM api_tokens WHERE user_id=? AND kind='pat' UNION ALL SELECT id,name,scopes,doc_ids,expires_at,created_at,revoked_at,NULL last_used_at,NULL last_used_ip,'oauth' kind FROM oauth_grants WHERE user_id=? ORDER BY created_at DESC").all(actor.user.id, actor.user.id);
    return { tokens };
  });
  route('POST', '/me/tokens', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const requestedScopes: unknown[] = Array.isArray(body.scopes) ? body.scopes : ['read'];
    if (!requestedScopes.length || requestedScopes.some((scope) => !['read','comment','submit','ai_tasks','preview'].includes(String(scope)))) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const scopes = requestedScopes as Scope[];
    const docIds = body.docIds === undefined || body.docIds === 'all' ? null : Array.isArray(body.docIds) && body.docIds.every((id) => typeof id === 'string' && roleFor(actor.user, id)) ? [...new Set(body.docIds as string[])] : undefined;
    if (docIds === undefined) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const expiresInDays = body.expiresInDays === undefined ? 30 : Number(body.expiresInDays);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED' } });
    const token = personalAccessToken(randomBytes(PERSONAL_ACCESS_TOKEN_BYTES)); const id = randomId('tok'); const now = isoNow();
    const name = typeof body.name === 'string' ? body.name.slice(0, 100) : 'Personal token';
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
    db.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,scopes,doc_ids,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, actor.user.id, name, sessionSecret(token), JSON.stringify(scopes), docIds ? JSON.stringify(docIds) : null, expiresAt, now);
    return reply.code(201).send({ token, meta: { id, name, scopes, docIds: docIds ?? 'all', createdAt: now, expiresAt } });
  });
  route('DELETE', '/me/tokens/:id', async (request, reply) => {
    if (!writeGuard(request, reply)) return;
    const actor = await auth(request, reply); if (!actor) return; if (rejectToken(actor, reply)) return;
    const { id } = request.params as { id: string };
    if (db.prepare('SELECT 1 FROM oauth_grants WHERE id=? AND user_id=?').get(id, actor.user.id)) revokeOAuthGrant(db, id);
    else db.prepare("UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=? AND kind='pat'").run(isoNow(), id, actor.user.id); return reply.code(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AiTaskError || error instanceof SubmissionInputError || error instanceof MergeValidationError) return reply.code(error.status).send({ error: { code: error.code, ...(error.details ? { details: error.details } : {}) } });
    if (error instanceof HttpError || error instanceof AssetError) return reply.code(error.status).send({ error: { code: error.code } });
    const status = isObject(error) && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    reply.code(status).send({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR' } });
  });
  app.addHook('onClose', async () => { await changeWorker.close(); if (exportTimer) clearInterval(exportTimer); await exportWorker.stop(); if (maintenanceTimer) clearInterval(maintenanceTimer); if (mailTimer) clearInterval(mailTimer); if (feishuTimer) clearInterval(feishuTimer); await feishuWorker.stop(); await outbox.stop(); if (!options.db) db.close(); });
  return app;
}

class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function randomNodeId() { return `n_${base32(randomBytes(5)).slice(0, 8)}`; }
function publicUser(user: User) { return { id: user.id, email: user.email, name: user.name, locale: user.locale, isAdmin: Boolean(user.is_admin) }; }
function publicDoc(db: HcdDatabase, docId: string, user: User) {
  const row = db.prepare('SELECT * FROM documents WHERE id=?').get(docId) as Record<string, unknown>;
  const memberRows = db.prepare(`SELECT role FROM document_members WHERE doc_id=? AND user_id=? UNION ALL SELECT sm.role FROM documents d JOIN space_members sm ON sm.space_id=d.space_id WHERE d.id=? AND sm.user_id=?`).all(docId, user.id, docId, user.id) as Array<{ role: Role }>;
  const role = user.is_admin ? 'owner' : memberRows.map((member) => member.role).sort((a, b) => ({ viewer: 0, commenter: 1, editor: 2, owner: 3 }[b] - { viewer: 0, commenter: 1, editor: 2, owner: 3 }[a]))[0] ?? null;
  return { id: docId, title: row.title, currentVersion: row.current_version, aiEnabled: Boolean(row.ai_enabled), role };
}
function publicSubmission(row: Record<string, unknown>) {
  const author = typeof row.author === 'string' ? { id: row.author_id, name: row.author } : undefined;
  return { id: row.id, docId: row.doc_id, aiTaskId: row.ai_task_id ?? null, idMap: row.id_map ? asJson<Record<string, string>>(String(row.id_map)) : {}, opCount: row.operations ? asJson<unknown[]>(String(row.operations)).length : null, uncertainCount: row.operations ? asJson<Op[]>(String(row.operations)).filter(op => op.uncertain).length : row.uncertain_ids ? asJson<string[]>(String(row.uncertain_ids)).length : 0, baseVersion: row.base_version, authorId: row.author_id, ...(author ? { author } : {}), message: row.message, content: typeof row.content === 'string' ? asJson(row.content) : row.content, status: row.status, createdAt: row.created_at, publishedVersion: row.published_version };
}
function publicComment(row: Record<string, unknown>) {
  const author = typeof row.author === 'string' ? { id: row.user_id ?? row.guest_id, name: row.author, external: Boolean(row.guest_id) } : !row.user_id && !row.guest_id ? { id: 'system', name: 'HCD', external: false } : undefined;
  return { id: row.id, threadId: row.thread_id, parentId: row.parent_id, ...(author ? { author } : {}), authorId: row.user_id ?? row.guest_id, external: Boolean(row.guest_id), body: row.body, submissionId: row.related_submission ?? undefined, anchor: asJson(row.anchor as string), anchorState: row.anchor_state ?? 'ok', ...(row.anchor_range ? { range: asJson(String(row.anchor_range)) } : {}), status: row.status, createdAt: row.created_at, editedAt: row.edited_at, deletedAt: row.deleted_at };
}
function publicPreview(db: HcdDatabase, previewId: string) {
  const row = db.prepare('SELECT * FROM previews WHERE id=?').get(previewId) as Record<string, unknown>;
  const doc = db.prepare('SELECT current_version FROM documents WHERE id=?').get(row.doc_id) as { current_version: number };
  const missingPending = row.status === 'open' && asJson<string[]>(String(row.submission_ids)).some((id) => !db.prepare("SELECT 1 FROM submissions WHERE id=? AND doc_id=? AND status='pending'").get(id, row.doc_id));
  const status = row.status === 'open' && (Number(row.base_version) !== Number(doc.current_version) || missingPending) ? 'stale' : row.status;
  return { id: row.id, docId: row.doc_id, revision: row.revision, baseVersion: row.base_version, submissionIds: asJson(row.submission_ids as string), candidate: asJson(row.candidate as string), candidateHash: hash(canonicalJson(asJson(row.candidate as string))), items: row.items ? asJson(String(row.items)) : [], presentation: row.presentation ? asJson(String(row.presentation)) : null, conflicts: asJson(row.conflicts as string), publishable: Boolean(row.publishable) && status === 'open', status, kind: row.kind ?? 'merge', createdAt: row.created_at };
}
function notifyOwners(db: HcdDatabase, docId: string, actorId: string, submissionId: string, now: string) {
  const owners = db.prepare(`SELECT DISTINCT u.id FROM users u WHERE (EXISTS(SELECT 1 FROM document_members dm WHERE dm.doc_id=? AND dm.user_id=u.id AND dm.role='owner') OR EXISTS(SELECT 1 FROM documents d JOIN space_members sm ON sm.space_id=d.space_id WHERE d.id=? AND sm.user_id=u.id AND sm.role='owner')) AND u.id<>?`).all(docId, docId, actorId) as Array<{ id: string }>;
  const insert = db.prepare('INSERT INTO notifications(id,user_id,doc_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)');
  for (const owner of owners) insert.run(randomId('nt'), owner.id, docId, 'submission_pending', JSON.stringify({ submissionId }), now);
}
function seedDemo(db: HcdDatabase, passwordHash: (password: string, salt: string) => string) {
  const count = (db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count;
  if (count) return;
  const now = isoNow(); const salt = 'hcd-demo-salt'; const password = process.env.DEMO_PASSWORD ?? 'hcd-demo-2026';
  const users = [
    ['u_admin000000', 'admin@example.com', '林管理', 1], ['u_owner000000', 'd@example.com', '林知夏', 0],
    ['u_editor00000', 'a@example.com', '周予安', 0], ['u_ops0000000', 'b@example.com', '王一诺', 0],
    ['u_data000000', 'c@example.com', '陈可', 0], ['u_comment000', 'f@example.com', 'Morgan Lee', 0], ['u_editor_e000', 'e@example.com', '顾以宁', 0],
  ] as const;
  const insertUser = db.prepare('INSERT INTO users(id,email,name,password_hash,locale,is_admin,created_at) VALUES(?,?,?,?,?,?,?)');
  users.forEach(([id,email,name,isAdmin]) => insertUser.run(id,email,name,passwordHash(password,salt),'zh-CN',isAdmin,now));
  const spaceId = 'sp_demo000000'; db.prepare('INSERT INTO spaces(id,name,created_by,created_at) VALUES(?,?,?,?)').run(spaceId, '示例空间 / Demo Space', users[1]![0], now);
  const members = db.prepare('INSERT INTO space_members(space_id,user_id,role) VALUES(?,?,?)');
  members.run(spaceId, users[1]![0], 'owner'); members.run(spaceId, users[2]![0], 'editor'); members.run(spaceId, users[3]![0], 'editor'); members.run(spaceId, users[4]![0], 'editor'); members.run(spaceId, users[5]![0], 'commenter'); members.run(spaceId, users[6]![0], 'editor');
  const docId = 'd_aaaaaaab'; const title = 'Q4 增长方案'; const content = createSeedDocument(docId, title);
  db.prepare('INSERT INTO documents(id,space_id,title,current_version,ai_enabled,created_by,created_at,updated_at) VALUES(?,?,?,1,1,?,?,?)').run(docId, spaceId, title, users[1]![0], now, now);
  const docMember = db.prepare('INSERT INTO document_members(doc_id,user_id,role) VALUES(?,?,?)');
  docMember.run(docId, users[1]![0], 'owner'); docMember.run(docId, users[2]![0], 'editor'); docMember.run(docId, users[3]![0], 'editor'); docMember.run(docId, users[4]![0], 'editor'); docMember.run(docId, users[5]![0], 'commenter'); docMember.run(docId, users[6]![0], 'editor');
  db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,1,\'create\',?,?,?)').run(docId, JSON.stringify(content), users[1]![0], now);
  const pending = [
    { user: users[2]![0], message: '调整背景叙述', path: [0, 1], text: '用户完成首次体验之后，下一步要让回访变得自然且值得期待。' },
    { user: users[3]![0], message: '补充首月目标', path: [0, 1], text: '首月留存应该优先于单次曝光，回访体验是当前增长的关键。' },
    { user: users[4]![0], message: '更新推荐渠道数据', path: [2, 1], text: '朋友推荐带来的新增用户，首周留存表现最好。' },
    { user: users[6]![0], message: '完善季度策略', path: [3, 1], text: '完成核心动作后，在 24 小时内给出与用户相关的下一步。' },
  ];
  const submissionInsert = db.prepare('INSERT INTO submissions(id,doc_id,author_id,base_version,message,content,status,idempotency_key,payload_hash,created_at) VALUES(?,?,?,1,?,?,\'pending\',?,?,?)');
  pending.forEach((item, index) => {
    const submitted = clone(content);
    const module = submitted.modules[item.path[0]!]!;
    const block = module.blocks[item.path[1]!]!;
    if ('text' in block) block.text = [{ t: item.text }];
    else if (block.type === 'chart') block.title = item.text;
    else if (block.type === 'table') block.caption = item.text;
    const submissionId = `sub_demo${index}abc`;
    submissionInsert.run(submissionId, docId, item.user, item.message, JSON.stringify(submitted), `seed-${index}`, hash(item.text), new Date(Date.parse(now) + index * 1000).toISOString());
  });
  const threadId = 'cm_demo000000';
  db.prepare('INSERT INTO comments(id,doc_id,thread_id,parent_id,user_id,body,anchor,status,created_at,created_version) VALUES(?,?,?,NULL,?,?,?,\'open\',?,1)').run(threadId, docId, threadId, users[5]![0], '能否补充用户回访的触发时机？这个部分会影响后续运营安排。', JSON.stringify({ moduleId: content.modules[0]!.id, blockId: content.modules[0]!.blocks[1]!.id, quote: '第一次体验' }), now);
  db.prepare('INSERT INTO comments(id,doc_id,thread_id,parent_id,user_id,body,anchor,status,created_at,created_version) VALUES(?,?,?,?,?,?,\'{}\',\'open\',?,1)').run('cm_demo_reply', docId, threadId, threadId, users[1]![0], '会在下一版加入触发条件和指标。', new Date(Date.parse(now) + 1000).toISOString());
  const enId = 'd_aaaaaaac'; const enContent = { ...content, id: enId, title: 'Launch Checklist', modules: content.modules.slice(0,3) };
  db.prepare('INSERT INTO documents(id,space_id,title,current_version,created_by,created_at,updated_at) VALUES(?,?,?,1,?,?,?)').run(enId, spaceId, 'Launch Checklist', users[1]![0], now, now);
  docMember.run(enId, users[1]![0], 'owner'); docMember.run(enId, users[2]![0], 'editor');
  db.prepare('INSERT INTO versions(doc_id,version,kind,content,created_by,created_at) VALUES(?,1,\'create\',?,?,?)').run(enId, JSON.stringify(enContent), users[1]![0], now);
}

export function hashTokenForTesting(secretKey: string, token: string) { return hash(`${secretKey}:${token}`); }
