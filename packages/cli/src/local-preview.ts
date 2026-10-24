import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderDocumentHtml } from '../../render/src/index';
import { validateDocument, type Document } from '../../core/src/model';
import { assetBlocks, prepareImage } from '../../server/src/assets';
import { sanitizeRawHtml } from '../../server/src/raw';

type Credential = { server: string; token: string };
const maxAsset = 10 * 1024 * 1024;
const maxTotal = 40 * 1024 * 1024;
const extension: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'text/html': 'html' };
async function ordinary(path: string, directory: boolean) {
  const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat && (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()))) throw new Error('Preview paths must be ordinary files and directories.');
}
async function atomicWrite(path: string, bytes: Buffer | string) {
  await ordinary(path, false);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
async function readBounded(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error(`Preview asset request failed (${response.status}).`);
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('Preview asset exceeds size limit.'); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limit) { await reader.cancel(); throw new Error('Preview asset exceeds size limit.'); } chunks.push(next.value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function serverOrigin(server: string) {
  const url = new URL(server);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Invalid preview server origin.');
  return url.origin;
}

/** Generates a standalone local preview. Never launches a browser or follows document links. */
export async function generateLocalPreview(options: { root: string; document: Document; baseVersion: number; credential?: Credential; locale?: 'zh-CN' | 'en' }): Promise<{ path: string; assetCount: number }> {
  const valid = validateDocument(options.document);
  if (!valid.ok || !Number.isInteger(options.baseVersion) || options.baseVersion < 1) throw new Error('Invalid local document or base version.');
  const document = valid.value; const blocks = assetBlocks(document).filter(block => block.asset);
  const assets = new Map<string, 'image' | 'raw'>();
  for (const block of blocks) { const kind = block.type === 'image' ? 'image' : 'raw'; if (assets.has(block.asset!) && assets.get(block.asset!) !== kind) throw new Error('An asset cannot be both an image and raw content.'); assets.set(block.asset!, kind); }
  if (assets.size > 100) throw new Error('Local preview supports at most 100 unique assets.');
  if (assets.size && !options.credential) throw new Error('Log in to download document assets for the local preview.');
  const root = resolve(options.root); const metadata = join(root, '.mdoc'); const assetDirectory = join(metadata, 'assets'); const output = join(metadata, 'preview.html');
  await ordinary(metadata, true); await ordinary(assetDirectory, true); await ordinary(output, false);
  await mkdir(assetDirectory, { recursive: true, mode: 0o700 });
  const imageUrls = new Map<string, string>(); const rawSources = new Map<string, string>(); let total = 0;
  const origin = options.credential ? serverOrigin(options.credential.server) : '';
  const signal = AbortSignal.timeout(60000);
  // Only content-hash files are written before the final atomic preview replacement.
  // Refetch even if cached, so revoked access does not silently reuse an old download.
  for (const [asset, kind] of assets) {
    const endpoint = `${origin}/api/v1/docs/${encodeURIComponent(document.id)}/assets/${encodeURIComponent(asset)}`;
    const headers = { authorization: `Bearer ${options.credential!.token}` };
    let bytes: Buffer; let mime: string;
    if (kind === 'image') {
      const response = await fetch(endpoint, { headers, redirect: 'error', signal });
      const prepared = prepareImage(await readBounded(response, Math.min(maxAsset, maxTotal - total)), response.headers.get('content-type')?.split(';')[0] ?? '');
      bytes = prepared.bytes; mime = prepared.mime;
      imageUrls.set(asset, `data:${mime};base64,${bytes.toString('base64')}`);
    } else {
      const pointer = await fetch(`${endpoint}/url`, { headers, redirect: 'error', signal });
      const value = JSON.parse((await readBounded(pointer, 16384)).toString('utf8')) as { url?: string };
      if (typeof value.url !== 'string') throw new Error('Preview raw URL is missing.');
      const destination = new URL(value.url);
      if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password || destination.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname)) throw new Error('Invalid raw preview URL.');
      // Signed render URL receives no API credential, even on the same host.
      const response = await fetch(destination, { redirect: 'error', signal });
      if (response.headers.get('content-type')?.split(';')[0] !== 'text/html') throw new Error('Unexpected raw preview content type.');
      const source = sanitizeRawHtml((await readBounded(response, Math.min(maxAsset, maxTotal - total))).toString('utf8'));
      bytes = Buffer.from(source); mime = 'text/html'; rawSources.set(asset, source);
    }
    total += bytes.length; if (total > maxTotal) throw new Error('Preview assets exceed total size limit.');
    const digest = createHash('sha256').update(bytes).digest('hex');
    await atomicWrite(join(assetDirectory, `${digest}.${extension[mime]}`), bytes);
  }
  // Repeated references expand into data URLs/srcdoc. Bound that expansion before rendering.
  let projected = Buffer.byteLength(JSON.stringify(document)) * 6 + 16384;
  for (const block of blocks) {
    projected += block.type === 'image' ? Buffer.byteLength(imageUrls.get(block.asset!) ?? '') : Buffer.byteLength(rawSources.get(block.asset!) ?? '') * 6;
    if (projected > 64 * 1024 * 1024) throw new Error('Rendered preview exceeds size limit.');
  }
  const html = renderDocumentHtml(document, { version: options.baseVersion, locale: options.locale, localPreview: true, assetUrl: id => imageUrls.get(id) ?? null, rawSource: id => rawSources.get(id) ?? null });
  await atomicWrite(output, html);
  return { path: output, assetCount: assets.size };
}
