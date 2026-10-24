import { translate, formatDate } from './shared/i18n';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Report = {
  documentId: string;
  filename: string;
  createdAt: string;
  report: { removed: number; warnings: string[]; modules: number; blocks: number };
};
export default function ImportArchive({
  docId,
  locale,
  onClose,
}: {
  docId: string;
  locale: 'zh-CN' | 'en';
  onClose: () => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  const [retry, setRetry] = useState(0);
  const t = {
    title: translate(locale, 'import.importHistory'),
    description: translate(locale, 'import.reviewTheOriginalConversionReportOrDownloadThePreserved'),
    loading: translate(locale, 'import.loadingImportHistory'),
    missing: translate(locale, 'import.thisDocumentWasNotCreatedFromAnImport'),
    failed: translate(locale, 'import.couldNotLoadTheImportHistoryTryAgain'),
    retry: translate(locale, 'import.retry'),
    download: translate(locale, 'import.downloadOriginalFile'),
    close: translate(locale, 'import.close'),
    removed: translate(locale, 'import.elementsRemoved'),
    content: translate(locale, 'import.sectionsBlocks'),
    original: translate(locale, 'import.originalFile'),
  };
  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    api<Report>(`/docs/${encodeURIComponent(docId)}/import-report`)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof ApiError && reason.status === 404 ? 'missing' : 'failed');
      });
    return () => {
      active = false;
    };
  }, [docId, retry]);
  return (
    <div className="overlay">
      <section
        className="review-modal create-modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-title"
      >
        <div className="modal-top">
          <div>
            <h2 id="archive-title">{t.title}</h2>
            <p>{t.description}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </div>
        {error ? (
          <p role="status">{t[error]}</p>
        ) : report ? (
          <div className="import-report">
            <h3>{report.filename}</h3>
            <p>{formatDate(report.createdAt, locale)}</p>
            <dl>
              <div>
                <dt>{t.removed}</dt>
                <dd>{report.report.removed}</dd>
              </div>
              <div>
                <dt>{t.content}</dt>
                <dd>
                  {report.report.modules} / {report.report.blocks}
                </dd>
              </div>
            </dl>
            {report.report.warnings.length > 0 && (
              <ul className="import-warnings">
                {report.report.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p role="status">{t.loading}</p>
        )}
        <div className="modal-footer">
          <button className="button button-soft" onClick={onClose}>
            {t.close}
          </button>
          {error === 'failed' && (
            <button className="button button-primary" onClick={() => setRetry((value) => value + 1)}>
              {t.retry}
            </button>
          )}
          {report && (
            <a className="button button-primary" href={`/api/v1/docs/${encodeURIComponent(docId)}/source`} download>
              {t.download}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
