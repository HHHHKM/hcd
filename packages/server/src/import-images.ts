import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import type { createAssetStore } from './assets';
import { archiveLimits } from './archive';
import { AssetError } from './assets';
import { isImportTreeBounded, type ImportNode } from '../../core/src/import-patterns';

export type StagedAsset = Awaited<ReturnType<ReturnType<typeof createAssetStore>['stage']>>;
/** Collect inline image bytes without fetching external resources or trusting existing asset IDs. */
export async function stageImportImages(html: string, store: ReturnType<typeof createAssetStore>) {
  const tree = parseFragment(html);
  if (!isImportTreeBounded(tree)) throw new AssetError(422, 'IMPORT_TOO_COMPLEX');
  const pending: ImportNode[] = [tree as unknown as ImportNode]; const images: ImportNode[] = []; const rawNodes: ImportNode[] = []; const styles: string[] = [];
  const rawTags = new Set(['svg', 'canvas', 'iframe', 'video', 'audio', 'object', 'embed', 'form']);
  while (pending.length) {
    const node = pending.pop()!;
    if (node.attrs) node.attrs = node.attrs.filter((attr) => attr.name !== 'data-hcd-raw-asset');
    if (node.tagName === 'style') styles.push(serialize(node as DefaultTreeAdapterMap['element']));
    if (node.tagName === 'img') images.push(node);
    if (rawTags.has(node.tagName ?? '')) { rawNodes.push(node); continue; }
    pending.push(...node.childNodes ?? []);
  }
  const assets: StagedAsset[] = []; const bySource = new Map<string, StagedAsset | null>();
  const report = { imported: 0, external: 0, missing: 0 };
  for (const image of images) {
    const source = image.attrs?.find((attr) => attr.name === 'src');
    if (!source) { report.missing++; continue; }
    const original = source.value; source.value = '';
    if (/^(https?:)?\/\//i.test(original)) { report.external++; continue; }
    if (!/^data:/i.test(original)) { report.missing++; continue; }
    let staged = bySource.get(original);
    if (staged === undefined) {
      staged = null;
      const comma = original.indexOf(','); const metadata = original.slice(5, comma).toLowerCase();
      if (comma > 0 && /^image\/(?:png|jpeg|gif|webp|svg\+xml);base64$/.test(metadata)) {
        const encoded = original.slice(comma + 1).replace(/[\t\r\n ]/g, '');
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length && bytes.toString('base64') === encoded) {
          try {
            const candidate = await store.stage(bytes, metadata.slice(0, -7));
            staged = assets.find((asset) => asset.hash === candidate.hash) ?? candidate;
            if (!assets.includes(staged)) assets.push(staged);
          } catch (error) { if (!(error instanceof AssetError)) throw error; }
        }
      }
      bySource.set(original, staged);
    }
    if (staged) { source.value = `asset:${staged.id}`; report.imported++; } else report.missing++;
  }
  let stagedBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
  if (rawNodes.length + assets.length > archiveLimits.files) throw new AssetError(422, 'IMPORT_TOO_COMPLEX');
  for (const node of rawNodes) {
    const reason = node.tagName!;
    const source = `<!doctype html><html><head><style>${styles.join('\n')}</style></head><body>${serializeOuter(node as DefaultTreeAdapterMap['element'])}</body></html>`;
    stagedBytes += Buffer.byteLength(source);
    if (stagedBytes > archiveLimits.expandedBytes) throw new AssetError(413, 'IMPORT_TOO_LARGE_OR_UNSUPPORTED');
    const candidate = await store.stage(Buffer.from(source), 'text/html');
    const staged = assets.find((asset) => asset.hash === candidate.hash) ?? candidate;
    if (!assets.includes(staged)) assets.push(staged);
    node.nodeName = 'div'; node.tagName = 'div'; node.childNodes = [];
    (node as DefaultTreeAdapterMap['element']).namespaceURI = 'http://www.w3.org/1999/xhtml' as DefaultTreeAdapterMap['element']['namespaceURI'];
    node.attrs = [{ name: 'data-hcd-raw-asset', value: staged.id }, { name: 'data-reason', value: reason }];
  }
  return { html: serialize(tree), assets, images: report, rawBlocks: rawNodes.length };
}
