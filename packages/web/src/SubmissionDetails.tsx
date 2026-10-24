import { translate } from './shared/i18n';
import { useEffect, useState } from 'react';
import { api, type Submission } from './api';
import ChangeList, { DocumentSnapshot } from './ChangeList';
import { DocumentAssetContext } from './DocumentAssets';
export default function SubmissionDetails({
  id,
  locale,
  onClose,
}: {
  id: string;
  locale: 'zh-CN' | 'en';
  onClose: () => void;
}) {
  const [submission, setSubmission] = useState<(Submission & { docId: string }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'changes' | 'document'>('changes');
  useEffect(() => {
    const controller = new AbortController();
    setSubmission(null);
    setFailed(false);
    setView('changes');
    api<{ submission: Submission & { docId: string } }>(`/submissions/${id}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSubmission(result.submission);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [id]);
  const statuses: Record<string, string> = {
    pending: translate(locale, 'review.awaitingReview'),
    published: translate(locale, 'review.published'),
    rejected: translate(locale, 'review.rejected'),
    withdrawn: translate(locale, 'review.withdrawn'),
  };
  return (
    <div className="overlay">
      <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="submission-details-title">
        <div className="modal-top">
          <div>
            <div className="modal-eyebrow">{translate(locale, 'review.submittedContent')}</div>
            <h2 id="submission-details-title">{submission?.message || translate(locale, 'review.viewSubmission')}</h2>
            {submission && (
              <p>
                {statuses[submission.status] ?? submission.status} · {translate(locale, 'review.basedOnVersion')}{' '}
                {submission.baseVersion}
              </p>
            )}
          </div>
          <button className="modal-close" aria-label={translate(locale, 'review.close')} onClick={onClose}>
            ×
          </button>
        </div>
        {failed ? (
          <p role="alert">{translate(locale, 'review.couldNotReadThisSubmissionCheckYourAccessAnd')}</p>
        ) : !submission ? (
          <p role="status">{translate(locale, 'review.loading')}</p>
        ) : (
          <>
            <div className="change-tabs" role="group" aria-label={translate(locale, 'review.submissionView')}>
              <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>
                {translate(locale, 'review.changesd17da')}
              </button>
              <button type="button" aria-pressed={view === 'document'} onClick={() => setView('document')}>
                {translate(locale, 'review.fullSubmittedDocument')}
              </button>
            </div>
            <p className="review-change-intro">
              {translate(locale, 'review.changesProposedAgainstTheOriginalBaselineThePublishedResult')}
            </p>
            <DocumentAssetContext.Provider value={{ docId: submission.docId }}>
              {view === 'changes' ? (
                <ChangeList
                  changeSet={submission.changeSet ?? { changes: [], unavailable: 'COMPARISON_UNAVAILABLE' }}
                  locale={locale}
                />
              ) : (
                submission.content && <DocumentSnapshot document={submission.content} locale={locale} />
              )}
            </DocumentAssetContext.Provider>
          </>
        )}
        <div className="modal-footer">
          <button className="button button-soft" onClick={onClose}>
            {translate(locale, 'review.close')}
          </button>
        </div>
      </section>
    </div>
  );
}
