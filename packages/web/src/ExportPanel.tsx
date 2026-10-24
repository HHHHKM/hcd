import { translate } from './shared/i18n';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
type Job = {
  id: string;
  status: string;
  format: string;
  version: number;
  includePending: boolean;
  excludedSubmissionIds: string[];
  error?: string;
  downloadUrl?: string;
};
export default function ExportPanel({
  docId,
  userId,
  version,
  canViewPending,
  locale,
  initialFormat = 'html',
  onClose,
}: {
  docId: string;
  userId: string;
  version: number;
  canViewPending: boolean;
  locale: 'zh-CN' | 'en';
  initialFormat?: 'html' | 'zip';
  onClose: () => void;
}) {
  const key = `hcd-export:${userId}:${docId}`;
  const [format, setFormat] = useState<string>(initialFormat);
  const [selectedVersion, setVersion] = useState(version);
  const [pending, setPending] = useState(false);
  const [jobId, setJobId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const message = (code: string) => {
    if (code === 'EXPORTER_NOT_CONFIGURED') return translate(locale, 'errors.EXPORTER_NOT_CONFIGURED');
    if (code === 'EXPORT_QUEUE_FULL') return translate(locale, 'errors.EXPORT_QUEUE_FULL');
    if (code === 'EXPORT_EXPIRED') return translate(locale, 'errors.EXPORT_EXPIRED');
    if (code === 'RENDER_NOT_CONFIGURED') return translate(locale, 'errors.RENDER_NOT_CONFIGURED');
    return translate(locale, 'export.couldNotExportOrRetrieveThisJobCheckYour');
  };
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api<{ export: Job }>(`/exports/${jobId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setJob(result.export);
        if (['queued', 'running'].includes(result.export.status))
          timer = setTimeout(() => {
            void poll();
          }, 2000);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.code : 'EXPORT_FAILED');
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ export: Job }>(`/docs/${docId}/exports`, {
        method: 'POST',
        body: { format, version: selectedVersion, includePending: pending },
      });
      setJob(result.export);
      setJobId(result.export.id);
      try {
        sessionStorage.setItem(key, result.export.id);
      } catch {
        /* Download still works without session storage. */
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.code : 'EXPORT_FAILED');
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ export: Job }>(`/exports/${jobId}`);
      if (!result.export.downloadUrl) throw new Error('missing download');
      window.location.assign(result.export.downloadUrl);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.code : 'EXPORT_FAILED');
    } finally {
      setBusy(false);
    }
  };
  const running = job && ['queued', 'running'].includes(job.status);
  return (
    <div className="overlay">
      <section className="review-modal create-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-top">
          <div>
            <h2 id="export-title">{translate(locale, 'export.exportDocument')}</h2>
            <p>{translate(locale, 'export.filesRemainAvailableFor24HoursJobsContinueAfter')}</p>
          </div>
          <button className="modal-close" aria-label={translate(locale, 'export.close')} onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <fieldset disabled={busy || Boolean(running)}>
            <legend>{translate(locale, 'export.exportOptions')}</legend>
            <label>
              {translate(locale, 'export.format')}
              <select value={format} onChange={(event) => setFormat(event.currentTarget.value)}>
                <option value="html">HTML</option>
                <option value="pdf">PDF</option>
                <option value="zip">HCD ZIP</option>
              </select>
            </label>
            <label>
              {translate(locale, 'export.version')}
              <input
                type="number"
                min={1}
                max={version}
                value={selectedVersion}
                onChange={(event) => {
                  setVersion(Number(event.currentTarget.value));
                  setPending(false);
                }}
              />
            </label>
            {canViewPending && (
              <label className="notification-preference-row">
                <input
                  type="checkbox"
                  checked={pending}
                  disabled={selectedVersion !== version}
                  onChange={(event) => setPending(event.currentTarget.checked)}
                />
                <span>{translate(locale, 'export.includePendingChangesExcludeConflictingSubmissions')}</span>
              </label>
            )}
          </fieldset>
          {error && (
            <p className="error-banner" role="alert">
              {message(error)}
            </p>
          )}
          {job && (
            <div aria-live="polite">
              <p>
                {job.status === 'queued'
                  ? translate(locale, 'export.queued')
                  : job.status === 'running'
                    ? translate(locale, 'export.generatingFile')
                    : job.status === 'done'
                      ? `${job.format.toUpperCase()} · v${job.version} · ${translate(locale, 'export.readyToDownload')}`
                      : message(job.error ?? 'EXPORT_FAILED')}
              </p>
              {job.excludedSubmissionIds.length > 0 && (
                <p>
                  {translate(locale, 'export.conflictingSubmissionsExcluded', {
                    value1: job.excludedSubmissionIds.length,
                  })}
                </p>
              )}
            </div>
          )}
          <div className="modal-footer">
            <button type="button" className="button button-soft" onClick={onClose}>
              {translate(locale, 'export.close')}
            </button>
            {job?.status === 'done' && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => {
                  void download();
                }}
              >
                {translate(locale, 'export.downloadFile')}
              </button>
            )}
            <button className="button button-primary" disabled={busy || Boolean(running)}>
              {translate(locale, 'export.createExport')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
