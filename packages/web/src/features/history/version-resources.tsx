import { translate, formatDate } from '../../shared/i18n';
import { api, ApiError, type Version, type VersionComparisonResponse, type VersionSnapshot } from '../../api';
import ChangeList, { DocumentSnapshot } from '../../ChangeList';
export type Locale = 'zh-CN' | 'en';
export type Resource<T> =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; reason: unknown }
  | { key: string; status: 'ready'; value: T };
export const kinds: Record<string, string> = {
  create: 'history.versionComparisonCatalog.kinds.create',
  import: 'history.versionComparisonCatalog.kinds.import',
  publish: 'history.versionComparisonCatalog.kinds.publish',
  restore: 'history.versionComparisonCatalog.kinds.restore',
};
export function versionKind(version: Version, locale: Locale) {
  return translate(locale, kinds[version.kind ?? 'publish'] ?? version.kind);
}
export function versionTime(version: Version, locale: Locale) {
  const date = new Date(version.createdAt ?? version.created_at ?? '');
  return Number.isNaN(date.getTime()) ? translate(locale, 'history.unknownTime') : formatDate(date, locale);
}
export function VersionMetadata({ version, locale }: { version: Version; locale: Locale }) {
  return (
    <>
      <strong>
        v{version.version} · {versionKind(version, locale)}
      </strong>
      <p>
        {translate(locale, 'history.createdBy')}
        {version.authorName?.trim() || translate(locale, 'history.unknownUser')}
      </p>
      <time dateTime={version.createdAt ?? version.created_at}>{versionTime(version, locale)}</time>
    </>
  );
}
export function ReadError({ reason, locale, onRetry }: { reason: unknown; locale: Locale; onRetry: () => void }) {
  const denied = reason instanceof ApiError && [401, 403, 404].includes(reason.status);
  return (
    <div className="version-read-error">
      <p role="alert">
        {denied
          ? translate(locale, 'history.theVersionIsUnavailableOrYouNoLongerHave')
          : translate(locale, 'history.couldNotLoadThisContentPleaseRetry')}
      </p>
      <button type="button" className="button button-soft" onClick={onRetry}>
        {translate(locale, 'history.retry')}
      </button>
    </div>
  );
}
export async function readVersionComparison(docId: string, from: number, to: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const value = await api<VersionComparisonResponse>(
    `/docs/${encodeURIComponent(docId)}/compare?from=${from}&to=${to}`,
    { signal },
  );
  signal.throwIfAborted();
  if (value.from !== from || value.to !== to) throw new Error('COMPARISON_VERSION_MISMATCH');
  return value;
}
export async function readVersionSnapshot(docId: string, version: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await api<{ version: VersionSnapshot }>(`/docs/${encodeURIComponent(docId)}/versions/${version}`, {
    signal,
  });
  signal.throwIfAborted();
  if (result.version.number !== version) throw new Error('SNAPSHOT_VERSION_MISMATCH');
  return result.version;
}
export function ComparisonResult({
  requestKey,
  resource,
  locale,
  onRetry,
}: {
  requestKey: string;
  resource: Resource<VersionComparisonResponse> | null;
  locale: Locale;
  onRetry: () => void;
}) {
  // Never paint a response from the previous selection, including the render before effect cleanup.
  if (resource?.key !== requestKey || resource.status === 'loading')
    return <p role="status">{translate(locale, 'history.comparingVersions')}</p>;
  if (resource.status === 'error') return <ReadError reason={resource.reason} locale={locale} onRetry={onRetry} />;
  return (
    <ChangeList
      key={requestKey}
      changeSet={resource.value.changeSet ?? { changes: [], unavailable: 'COMPARISON_UNAVAILABLE' }}
      locale={locale}
    />
  );
}
export function HistoricalSnapshot({
  requestKey,
  resource,
  locale,
  onRetry,
}: {
  requestKey: string;
  resource: Resource<VersionSnapshot> | null;
  locale: Locale;
  onRetry: () => void;
}) {
  if (resource?.key !== requestKey || resource.status === 'loading')
    return <p role="status">{translate(locale, 'history.loadingHistoricalDocument')}</p>;
  if (resource.status === 'error') return <ReadError reason={resource.reason} locale={locale} onRetry={onRetry} />;
  return (
    <section className="version-snapshot">
      <div className="version-snapshot-banner" role="note">
        <strong>
          {translate(locale, 'history.readOnlyHistoricalSnapshot')} · v{resource.value.number}
        </strong>
        <p>{translate(locale, 'history.thisIsTheCompleteDocumentAsPublishedInThis')}</p>
      </div>
      <DocumentSnapshot document={resource.value.content} locale={locale} />
    </section>
  );
}
