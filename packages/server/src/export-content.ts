import { zipSync } from 'fflate';
import type { Document } from '../../core/src/model';
import { serializeDocument } from '../../core/src/spec-html';
import { renderDocumentHtml, themeCss } from '../../render/src/index';
import { createAssetStore, documentAssetIds } from './assets';
import { archiveLimits } from './archive';
export class ExportError extends Error { constructor(public code: string) { super(code); } }
export const maxExportBytes = 80 * 1024 * 1024;
export async function buildExport(content: Document, version: number, format: 'html' | 'zip', assetStore: ReturnType<typeof createAssetStore>, locale: 'zh-CN' | 'en', createdAt: string, includePending = false) {
  const id = content.id;
  const referenced = [...documentAssetIds(content)].map((assetId) => assetStore.get(id, assetId));
  if (referenced.some((asset) => !asset)) throw new ExportError('ASSET_NOT_FOUND');
  if (referenced.reduce((total, asset) => total + asset!.size, 0) + Buffer.byteLength(JSON.stringify(content)) > archiveLimits.expandedBytes) throw new ExportError('EXPORT_TOO_LARGE');
  if (format === 'zip') {
      const assets: Array<{ id: string; mime: string; size: number; sha256: string }> = [];
      const files: Record<string, Uint8Array> = {
        'document.json': Buffer.from(JSON.stringify(content, null, 2)),
        'theme.css': Buffer.from(themeCss),
      };
      const moduleFiles = content.modules.map((module, index) => {
        const safe = module.title.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'module';
        const path = `modules/${String(index + 1).padStart(2, '0')}-${safe}.html`;
        files[path] = Buffer.from(serializeDocument({ ...content, modules: [module] }));
        return { id: module.id, title: module.title, path };
      });
      for (const assetId of documentAssetIds(content)) {
        const asset = assetStore.get(id, assetId);
        if (!asset) continue;
        const data = await assetStore.read(asset);
        files[`assets/${assetId}`] = data;
        assets.push({ id: asset.id, mime: asset.mime, size: asset.size, sha256: asset.hash });
      }
      files['manifest.json'] = Buffer.from(JSON.stringify({ format: 'hcd-archive', archiveVersion: 1, documentId: id, title: content.title, version, createdAt: createdAt, includePending, documentFile: 'document.json', themeFile: 'theme.css', modules: moduleFiles, assets }, null, 2));
      if (Object.keys(files).length > archiveLimits.files || Object.values(files).some((value) => value.length > archiveLimits.fileBytes) || Object.values(files).reduce((total, value) => total + value.length, 0) > archiveLimits.expandedBytes) throw new ExportError('EXPORT_TOO_LARGE');
      const archive = zipSync(files, { level: 6 });
      if (archive.length > archiveLimits.bytes) throw new ExportError('EXPORT_TOO_LARGE');
      return { bytes: Buffer.from(archive), mime: 'application/zip' };
  }
    const urls = new Map<string, string>(); const rawSources = new Map<string, string>();
    for (const assetId of documentAssetIds(content)) {
      const asset = assetStore.get(id, assetId);
      if (asset) { const bytes = await assetStore.read(asset); if (asset.mime === 'text/html') rawSources.set(assetId, bytes.toString('utf8')); else urls.set(assetId, `data:${asset.mime};base64,${bytes.toString('base64')}`); }
    }
    const bytes = Buffer.from(renderDocumentHtml(content, { locale, version, exportedAt: createdAt, includePending, assetUrl: (assetId) => urls.get(assetId) ?? null, rawSource: (assetId) => rawSources.get(assetId) ?? null }));
    if (bytes.length > maxExportBytes) throw new ExportError('EXPORT_TOO_LARGE');
    return { bytes, mime: 'text/html; charset=utf-8' };
}
