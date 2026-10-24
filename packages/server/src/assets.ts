import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFragment } from 'parse5';
import type { Block, Document } from '../../core/src/model';
import type { ImportNode } from '../../core/src/import-patterns';
import { isImportTreeBounded } from '../../core/src/import-patterns';
import { sanitizeRawHtml } from './raw';
import type { HcdDatabase } from './db';

export const maxAssetBytes = 10 * 1024 * 1024;
export class AssetError extends Error { constructor(public status: number, public code: string) { super(code); } }
type Asset = { id: string; doc_id: string; hash: string; mime: string; size: number };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const svgElements = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath']);
const svgAttributes = new Set(['id', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'clip-path']);

export function prepareImage(bytes: Buffer, claimedMime: string): { bytes: Buffer; mime: string } {
  if (!bytes.length || bytes.length > maxAssetBytes) throw new AssetError(413, 'ASSET_TOO_LARGE');
  let mime: string | undefined;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') mime = 'image/png';
  else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) mime = 'image/jpeg';
  else if (bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) mime = 'image/gif';
  else if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && /^VP8[ LX]$/.test(bytes.toString('ascii', 12, 16))) mime = 'image/webp';
  else if (claimedMime === 'image/svg+xml') {
    const source = bytes.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new AssetError(415, 'ASSET_UNSUPPORTED');
    const tree = parseFragment(source.replace(/^\s*<\?xml[^?]*\?>/i, '')) as unknown as ImportNode;
    const roots = (tree.childNodes ?? []).filter((node) => node.tagName);
    if (roots.length !== 1 || roots[0]!.tagName !== 'svg' || !isImportTreeBounded(tree, 20000, 48)) throw new AssetError(415, 'ASSET_UNSUPPORTED');
    const render = (node: ImportNode): string => {
      if (node.nodeName === '#text') return escape(node.value ?? '');
      if (!node.tagName || !svgElements.has(node.tagName)) return '';
      const attributes = (node.attrs ?? []).filter(({ name, value }) => svgAttributes.has(name) && !/[<>\u0000-\u001f]/.test(value) && (!/url\s*\(/i.test(value) || /^url\(#[a-zA-Z_][\w.-]*\)$/.test(value)))
        .map(({ name, value }) => ` ${name}="${escape(value)}"`).join('');
      return `<${node.tagName}${node.tagName === 'svg' ? ' xmlns="http://www.w3.org/2000/svg"' : ''}${attributes}>${(node.childNodes ?? []).map(render).join('')}</${node.tagName}>`;
    };
    return { bytes: Buffer.from(render(roots[0]!)), mime: 'image/svg+xml' };
  }
  if (!mime || (claimedMime !== 'application/octet-stream' && claimedMime !== mime)) throw new AssetError(415, 'ASSET_UNSUPPORTED');
  return { bytes, mime };
}

export function createAssetStore(db: HcdDatabase, dataDir: string) {
  const location = (hash: string) => join(dataDir, 'assets', hash.slice(0, 2), hash);
  const get = (docId: string, id: string) => db.prepare('SELECT id,doc_id,hash,mime,size FROM assets WHERE id=? AND doc_id=?').get(id, docId) as Asset | undefined;
  async function stage(input: Buffer, mime: string) {
    if (!input.length || input.length > maxAssetBytes) throw new AssetError(413, 'ASSET_TOO_LARGE');
    const prepared = mime === 'text/html' ? { bytes: Buffer.from(sanitizeRawHtml(input.toString('utf8'))), mime } : prepareImage(input, mime); const hash = createHash('sha256').update(prepared.bytes).digest('hex');
    await mkdir(join(dataDir, 'assets', hash.slice(0, 2)), { recursive: true });
    await writeFile(location(hash), prepared.bytes, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    const id = `as_${Array.from(randomBytes(12), (value) => alphabet[value % alphabet.length]).join('')}`;
    return { id, hash, mime: prepared.mime, size: prepared.bytes.length };
  }
  return {
    get,
    stage,
    read: (asset: Asset) => readFile(location(asset.hash)),
    async save(docId: string, userId: string, input: Buffer, mime: string) {
      const prepared = prepareImage(input, mime);
      const hash = createHash('sha256').update(prepared.bytes).digest('hex');
      const existing = db.prepare('SELECT id,doc_id,hash,mime,size FROM assets WHERE doc_id=? AND hash=?').get(docId, hash) as Asset | undefined;
      if (existing) return existing;
      await mkdir(join(dataDir, 'assets', hash.slice(0, 2)), { recursive: true });
      await writeFile(location(hash), prepared.bytes, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
      const id = `as_${Array.from(randomBytes(12), (value) => alphabet[value % alphabet.length]).join('')}`;
      db.prepare('INSERT OR IGNORE INTO assets(id,doc_id,hash,mime,size,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id, docId, hash, prepared.mime, prepared.bytes.length, userId, new Date().toISOString());
      return db.prepare('SELECT id,doc_id,hash,mime,size FROM assets WHERE doc_id=? AND hash=?').get(docId, hash) as Asset;
    },
    validate(docId: string, document: Document) {
      for (const block of assetBlocks(document)) {
        if (!block.asset) continue;
        const asset = get(docId, block.asset);
        if (!asset || (block.type === 'raw' ? asset.mime !== 'text/html' : !asset.mime.startsWith('image/'))) throw new AssetError(400, 'ASSET_NOT_FOUND');
        if (block.type === 'raw' && block.allowScripts) throw new AssetError(400, 'RAW_SCRIPTS_UNAVAILABLE');
      }
    },
  };
}
export function imageAssetIds(document: Document): Set<string> {
  const ids = new Set<string>();
  const walk = (block: Block) => {
    if (block.type === 'image' && block.asset) ids.add(block.asset);
    else if (block.type === 'columns') block.cols.forEach((column) => column.blocks.forEach(walk));
    else if (block.type === 'cards') block.items.forEach((card) => card.blocks.forEach(walk));
  };
  document.modules.forEach((module) => module.blocks.forEach(walk)); return ids;
}

export function assetBlocks(document: Document): Array<Extract<Block, { type: 'image' | 'raw' }>> {
  const result: Array<Extract<Block, { type: 'image' | 'raw' }>> = [];
  const walk = (block: Block) => {
    if (block.type === 'image' || block.type === 'raw') result.push(block);
    else if (block.type === 'columns') block.cols.forEach((column) => column.blocks.forEach(walk));
    else if (block.type === 'cards') block.items.forEach((card) => card.blocks.forEach(walk));
  };
  document.modules.forEach((module) => module.blocks.forEach(walk)); return result;
}
export function documentAssetIds(document: Document) { return new Set(assetBlocks(document).flatMap((block) => block.asset ? [block.asset] : [])); }
