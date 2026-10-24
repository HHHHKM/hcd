import { translate } from './shared/i18n';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type AssetContext = { docId: string; assetBase?: string };
export const DocumentAssetContext = createContext<AssetContext | null>(null);
export function assetPath(docId: string, assetId: string) {
  return `/api/v1/docs/${encodeURIComponent(docId)}/assets/${encodeURIComponent(assetId)}`;
}
export function DocumentImage({
  asset,
  alt,
  width,
  caption,
  locale,
  blockId,
  renderText,
}: {
  asset: string | null;
  alt: string;
  width: string;
  caption: string;
  locale: 'zh-CN' | 'en';
  blockId?: string;
  renderText?: (field: 'alt' | 'caption', value: string) => ReactNode;
}) {
  const context = useContext(DocumentAssetContext);
  const [failed, setFailed] = useState<string | null>(null);
  const url =
    context && asset
      ? context.assetBase
        ? `${context.assetBase}/${encodeURIComponent(asset)}`
        : assetPath(context.docId, asset)
      : null;
  return (
    <figure className={`document-image image-width-${width}`} data-hcd-block-id={blockId}>
      {url && failed !== url ? (
        <img src={url} alt={alt} loading="lazy" onError={() => setFailed(url)} />
      ) : (
        <div className="image-placeholder">
          <span aria-hidden="true">▧</span>
          <span>{alt ? (renderText ? renderText('alt', alt) : alt) : translate(locale, 'reader.noImage')}</span>
          {url && (
            <button type="button" onClick={() => setFailed(null)}>
              {translate(locale, 'reader.retry')}
            </button>
          )}
        </div>
      )}
      {caption && <figcaption>{renderText ? renderText('caption', caption) : caption}</figcaption>}
    </figure>
  );
}
export function ImageUpload({
  locale,
  asset,
  alt,
  onChange,
}: {
  locale: 'zh-CN' | 'en';
  asset: string | null;
  alt: string;
  onChange: (asset: string | null, alt: string) => void;
}) {
  const context = useContext(DocumentAssetContext);
  const docId = context?.docId ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef({ onChange, alt });
  current.current = { onChange, alt };

  return (
    <div className="image-upload">
      <DocumentImage asset={asset} alt={alt} caption="" width="normal" locale={locale} />
      <label className="be-field">
        {translate(locale, 'reader.uploadImagePngJpegGifWebpSvgUpTo')}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          disabled={busy || !docId}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file || !docId) return;
            setError('');
            if (file.size > 10 * 1024 * 1024) {
              setError(translate(locale, 'reader.theImageExceeds10Mb'));
              return;
            }
            setBusy(true);
            try {
              const data = new FormData();
              data.append('file', file);
              const response = await fetch(`/api/v1/docs/${encodeURIComponent(docId)}/assets`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-HCD-Request': '1' },
                body: data,
              });
              const result = (await response.json()) as { asset?: { id: string }; error?: { code: string } };
              if (!response.ok || !result.asset) throw new Error(result.error?.code ?? 'UPLOAD_FAILED');
              current.current.onChange(result.asset.id, current.current.alt || file.name.replace(/\.[^.]+$/, ''));
            } catch (reason) {
              setError(
                reason instanceof Error && reason.message === 'ASSET_UNSUPPORTED'
                  ? translate(locale, 'reader.thisIsNotASupportedImageOrTheSvg')
                  : translate(locale, 'reader.uploadFailedPleaseRetry'),
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && <p role="status">{translate(locale, 'reader.uploading')}</p>}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {asset && (
        <button type="button" disabled={busy} onClick={() => onChange(null, alt)}>
          {translate(locale, 'reader.removeImage')}
        </button>
      )}
    </div>
  );
}

export function DocumentRaw({
  asset,
  note,
  height,
  locale,
  blockId,
}: {
  asset: string;
  note: string;
  height: number;
  locale: 'zh-CN' | 'en';
  blockId?: string;
}) {
  const context = useContext(DocumentAssetContext);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const base = context?.assetBase ?? (context ? `/api/v1/docs/${encodeURIComponent(context.docId)}/assets` : null);
  const endpoint = base ? `${base}/${encodeURIComponent(asset)}/url` : null;
  useEffect(() => {
    let active = true;
    setUrl('');
    setError('');
    if (!endpoint) return;
    fetch(endpoint, { credentials: 'same-origin' })
      .then(async (response) => {
        const result = (await response.json()) as { url?: string; error?: { code?: string } };
        if (!response.ok || !result.url) throw new Error(result.error?.code ?? 'UNAVAILABLE');
        const destination = new URL(result.url);
        if (!['https:', 'http:'].includes(destination.protocol) || destination.hostname === window.location.hostname)
          throw new Error('RENDER_NOT_CONFIGURED');
        if (active) setUrl(destination.href);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'UNAVAILABLE');
      });
    return () => {
      active = false;
    };
  }, [endpoint, retry]);

  return (
    <figure className="document-raw" data-hcd-block-id={blockId}>
      {url ? (
        <iframe
          title={note || translate(locale, 'reader.readOnlyContent')}
          src={url}
          sandbox=""
          referrerPolicy="no-referrer"
          style={{ height: Math.max(80, Math.min(4000, height)) }}
        />
      ) : (
        <div className="raw-placeholder">
          <span>{note || translate(locale, 'reader.readOnlyContent')}</span>
          <p>
            {error === 'RENDER_NOT_CONFIGURED'
              ? translate(locale, 'reader.configureTheIsolatedRenderOriginToViewThisContent')
              : error
                ? translate(locale, 'reader.contentCouldNotBeLoaded')
                : translate(locale, 'reader.loading')}
          </p>
        </div>
      )}
      {endpoint && (
        <button type="button" className="text-link" onClick={() => setRetry((value) => value + 1)}>
          {translate(locale, 'reader.reloadReadOnlyContent')}
        </button>
      )}
    </figure>
  );
}
