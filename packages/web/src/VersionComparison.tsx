import { translate } from './shared/i18n';
import { useEffect, useState } from 'react';
import { api, type Version, type VersionComparisonResponse, type VersionSnapshot } from './api';
import {
  type Locale,
  type Resource,
  versionKind,
  VersionMetadata,
  ReadError,
  ComparisonResult,
  HistoricalSnapshot,
} from './features/history/version-resources';
export {
  ComparisonResult,
  HistoricalSnapshot,
  readVersionComparison,
  readVersionSnapshot,
} from './features/history/version-resources';
import { readVersionComparison, readVersionSnapshot } from './features/history/version-resources';
import './version-comparison.css';
type HistoryProps = {
  docId: string;
  currentVersion: number;
  locale: Locale;
  canRestore: boolean;
  busy: boolean;
  onBack: () => void;
  onRestore: (version: number) => void;
  initialFrom?: number;
  initialTo?: number;
  onPairChange?: (pair: { from: number; to: number }) => void;
  onReadVersion?: (version: number) => void;
};
export function VersionComparisonContent({ versions, ...props }: HistoryProps & { versions: Version[] }) {
  const { docId, locale, canRestore, busy, onRestore } = props;
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  const latest = ordered[0]?.version ?? props.currentVersion;
  const initialFrom = props.initialFrom ?? ordered[1]?.version ?? latest;
  const initialTo = props.initialTo ?? latest;
  const [pair, setPairState] = useState({ from: initialFrom, to: initialTo });
  useEffect(() => {
    setPairState((previous) =>
      previous.from === initialFrom && previous.to === initialTo ? previous : { from: initialFrom, to: initialTo },
    );
  }, [initialFrom, initialTo]);
  const setPair = (
    value: { from: number; to: number } | ((previous: { from: number; to: number }) => { from: number; to: number }),
  ) => {
    const next = typeof value === 'function' ? value(pair) : value;
    setPairState(next);
    props.onPairChange?.(next);
  };
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<'changes' | 'before' | 'after'>('changes');
  const [snapshotRetry, setSnapshotRetry] = useState(0);
  const [resource, setResource] = useState<Resource<VersionComparisonResponse> | null>(null);
  const [snapshot, setSnapshot] = useState<Resource<VersionSnapshot> | null>(null);
  const requestKey = JSON.stringify([docId, pair.from, pair.to, retry]);
  const fromVersion = ordered.find((version) => version.version === pair.from);
  const toVersion = ordered.find((version) => version.version === pair.to);
  const validPair = Boolean(fromVersion && toVersion);
  const snapshotVersion = view === 'before' ? fromVersion?.version : view === 'after' ? toVersion?.version : undefined;
  const snapshotKey = JSON.stringify([docId, snapshotVersion, snapshotRetry]);
  useEffect(() => {
    if (!validPair) return;
    const controller = new AbortController();
    setResource({ key: requestKey, status: 'loading' });
    readVersionComparison(docId, pair.from, pair.to, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResource({ key: requestKey, status: 'ready', value });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setResource({ key: requestKey, status: 'error', reason });
      });
    return () => controller.abort();
  }, [docId, pair.from, pair.to, requestKey, validPair]);
  useEffect(() => {
    if (snapshotVersion === undefined) return;
    const controller = new AbortController();
    setSnapshot({ key: snapshotKey, status: 'loading' });
    readVersionSnapshot(docId, snapshotVersion, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot({ key: snapshotKey, status: 'ready', value });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setSnapshot({ key: snapshotKey, status: 'error', reason });
      });
    return () => controller.abort();
  }, [docId, snapshotVersion, snapshotKey]);
  if (!ordered.length) return <p role="status">{translate(locale, 'history.noPublishedVersionsAreAvailable')}</p>;
  return (
    <>
      <section className="version-comparison" aria-labelledby="version-compare-title">
        <h2 id="version-compare-title">{translate(locale, 'history.compareVersions')}</h2>
        <p className="version-comparison-intro">
          {translate(locale, 'history.compareTheActualContentOfTwoPublishedVersionsPersonal')}
        </p>
        <div className="version-selectors">
          <label>
            {translate(locale, 'history.beforeVersion')}
            <select
              value={pair.from}
              onChange={(event) => setPair((previous) => ({ ...previous, from: Number(event.target.value) }))}
            >
              {ordered.map((version) => (
                <option value={version.version} key={version.version}>
                  v{version.version} · {versionKind(version, locale)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-soft version-swap"
            disabled={pair.from === pair.to}
            onClick={() => setPair(({ from, to }) => ({ from: to, to: from }))}
          >
            {translate(locale, 'history.swapVersions')}
          </button>
          <label>
            {translate(locale, 'history.afterVersion')}
            <select
              value={pair.to}
              onChange={(event) => setPair((previous) => ({ ...previous, to: Number(event.target.value) }))}
            >
              {ordered.map((version) => (
                <option value={version.version} key={version.version}>
                  v{version.version} · {versionKind(version, locale)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="version-pair-metadata">
          {fromVersion && (
            <div>
              <small>{translate(locale, 'history.before')}</small>
              <VersionMetadata version={fromVersion} locale={locale} />
            </div>
          )}
          {toVersion && (
            <div>
              <small>{translate(locale, 'history.after')}</small>
              <VersionMetadata version={toVersion} locale={locale} />
            </div>
          )}
        </div>
        {pair.from > pair.to && (
          <p className="version-direction-note">
            {translate(locale, 'history.comparingANewerVersionToAnOlderVersionReverses')}
          </p>
        )}
        <div className="change-tabs" role="group" aria-label={translate(locale, 'history.versionView')}>
          <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>
            {translate(locale, 'history.changes')}
          </button>
          <button type="button" aria-pressed={view === 'before'} onClick={() => setView('before')}>
            {translate(locale, 'history.fullDocumentBefore')} · v{pair.from}
          </button>
          <button type="button" aria-pressed={view === 'after'} onClick={() => setView('after')}>
            {translate(locale, 'history.fullDocumentAfter')} · v{pair.to}
          </button>
        </div>
        {fromVersion && toVersion && (
          <div
            className="version-comparison-result"
            aria-live="polite"
            aria-busy={
              view === 'changes'
                ? resource?.key !== requestKey || resource.status === 'loading'
                : snapshot?.key !== snapshotKey || snapshot.status === 'loading'
            }
          >
            {view === 'changes' ? (
              <ComparisonResult
                requestKey={requestKey}
                resource={resource}
                locale={locale}
                onRetry={() => setRetry((value) => value + 1)}
              />
            ) : (
              <HistoricalSnapshot
                requestKey={snapshotKey}
                resource={snapshot}
                locale={locale}
                onRetry={() => setSnapshotRetry((value) => value + 1)}
              />
            )}
          </div>
        )}
      </section>
      <section aria-labelledby="published-versions-title" className="published-versions">
        <h2 id="published-versions-title">{translate(locale, 'history.publishedVersionHistory')}</h2>
        <div className="history-list">
          {ordered.map((version, index) => (
            <article className="history-row" key={version.version}>
              <span className={`history-marker ${version.version === latest ? 'current' : ''}`} aria-hidden="true">
                {version.version === latest ? '✓' : '·'}
              </span>
              <div>
                <VersionMetadata version={version} locale={locale} />
                {version.version === latest && (
                  <small className="version-current-label">{translate(locale, 'history.currentVersion')}</small>
                )}
              </div>
              <div className="version-history-actions">
                <button
                  type="button"
                  className="button button-soft"
                  onClick={() => {
                    if (props.onReadVersion) props.onReadVersion(version.version);
                    else {
                      setPair({ from: version.version, to: latest });
                      setView('before');
                    }
                  }}
                >
                  {translate(locale, 'history.viewThisVersion')}
                </button>
                <button
                  type="button"
                  className="button button-soft"
                  disabled={ordered.length < 2}
                  onClick={() => {
                    setPair({ from: index === 0 ? ordered[1]!.version : version.version, to: latest });
                    setView('changes');
                  }}
                >
                  {index === 0
                    ? translate(locale, 'history.viewThisVersionSChanges')
                    : translate(locale, 'history.compareWithCurrent')}
                </button>
                {version.version !== latest && canRestore && (
                  <button
                    type="button"
                    className="button button-soft"
                    disabled={busy}
                    onClick={() => onRestore(version.version)}
                  >
                    {translate(locale, 'history.previewRestoringThisVersion')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
export default function VersionComparison(props: HistoryProps) {
  const { docId, locale, onBack } = props;
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<Resource<Version[]> | null>(null);
  const historyKey = JSON.stringify([docId, props.currentVersion, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setHistory({ key: historyKey, status: 'loading' });
    api<{ versions: Version[] }>(`/docs/${encodeURIComponent(docId)}/versions`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setHistory({ key: historyKey, status: 'ready', value: result.versions });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setHistory({ key: historyKey, status: 'error', reason });
      });
    return () => controller.abort();
  }, [docId, historyKey]);
  return (
    <section className="history-page version-history-page">
      <div className="history-heading">
        <button type="button" className="text-link" onClick={onBack}>
          {translate(locale, 'history.backToDocument')}
        </button>
        <div className="version-history-heading">
          <h1>{translate(locale, 'history.versionHistory')}</h1>
          <button type="button" className="button button-soft" onClick={() => setRefresh((value) => value + 1)}>
            {translate(locale, 'history.refreshHistory')}
          </button>
        </div>
      </div>
      {history?.key !== historyKey || history.status === 'loading' ? (
        <p role="status">{translate(locale, 'history.loadingVersionHistory')}</p>
      ) : history.status === 'error' ? (
        <ReadError reason={history.reason} locale={locale} onRetry={() => setRefresh((value) => value + 1)} />
      ) : (
        <VersionComparisonContent key={historyKey} {...props} versions={history.value} />
      )}
    </section>
  );
}
