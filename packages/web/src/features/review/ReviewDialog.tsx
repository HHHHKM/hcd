import { Suspense } from 'react';
import { Icon, authorName } from '../../app/workspace-helpers';
import { ReviewChanges } from '../../app/lazy-panels';
import { useWorkspace } from '../../app/WorkspaceContext';
import ConflictCard from './ConflictCard';
export default function ReviewDialog() {
  const {
    locale,
    mobileReading,
    busy,
    error,
    submissions,
    selectedSubmissions,
    setSelectedSubmissions,
    preview,
    setPreview,
    previewKind,
    setPreviewOpen,
    setSubmissionDetailsId,
    t,
    createPreview,
    publish,
    publishable,
    conflicts,
    unresolved,
    user,
  } = useWorkspace();
  if (!user) return null;

  return (
    <div className="overlay">
      <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <div className="modal-top">
          <div>
            <div className="modal-eyebrow">
              <span className="pending-pin">{preview ? `v${preview.baseVersion}` : submissions.length}</span>
              {preview ? `${t('common.app.preview')} · v${preview.baseVersion}` : t('common.app.reviewers')}
            </div>
            <h2 id="review-title">
              {preview
                ? previewKind === 'restore'
                  ? t('common.app.restorePreview')
                  : t('common.app.reviewHeadline')
                : t('common.app.reviewHeadline')}
            </h2>
            <p>{preview ? t('common.app.reviewSummary') : `${submissions.length} ${t('common.app.submissions')}`}</p>
          </div>
          <button className="modal-close" onClick={() => setPreviewOpen(false)} aria-label={t('common.app.close')}>
            <Icon name="close" />
          </button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!preview ? (
          <>
            <div className="review-progress">
              <span>01</span>
              <i />
              <span>02</span>
              <i />
              <span className="muted-step">03</span>
              <div>{t('common.app.selectSubmissions')}</div>
            </div>
            {submissions.length === 0 ? (
              <div className="empty-state compact">
                <p>{t('common.app.noSubmissions')}</p>
              </div>
            ) : (
              <div className="submission-list">
                {submissions.map((submission) => (
                  <div className="submission-row" key={submission.id}>
                    <label className="submission-select">
                      <input
                        type="checkbox"
                        checked={selectedSubmissions.includes(submission.id)}
                        onChange={() =>
                          setSelectedSubmissions((old) =>
                            old.includes(submission.id)
                              ? old.filter((id) => id !== submission.id)
                              : [...old, submission.id],
                          )
                        }
                      />
                      <span className="avatar avatar-blue">{authorName(submission).slice(0, 1)}</span>
                      <span className="submission-info">
                        <b>{submission.message || `${t('common.app.submit')} · ${submission.id.slice(0, 8)}`}</b>
                        <small>
                          v{submission.baseVersion} · {submission.via ?? 'web'}
                        </small>
                      </span>
                      <span className="submission-author">
                        {authorName(submission)}
                        <small>{new Date(submission.createdAt).toLocaleDateString(locale)}</small>
                      </span>
                    </label>
                    <button type="button" className="text-link" onClick={() => setSubmissionDetailsId(submission.id)}>
                      {t('common.app.viewChanges')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="preview-content">
            <Suspense fallback={<p role="status">{t('common.app.loading')}</p>}>
              <ReviewChanges
                key={`${preview.id}:${preview.revision}`}
                presentation={preview.presentation}
                candidate={preview.candidate}
                locale={locale}
                onReadSubmission={setSubmissionDetailsId}
              />
            </Suspense>
            {conflicts.length === 0 && (
              <div className="preview-summary">
                <span className="summary-check">
                  <Icon name="check" size={16} />
                </span>
                <span>
                  <b>{t('common.app.noConflict')}</b>
                  <small>
                    {preview.submissions?.length ?? selectedSubmissions.length} {t('common.app.submissions')}
                  </small>
                </span>
              </div>
            )}
            {conflicts.map((conflict) => {
              return <ConflictCard conflict={conflict} />;
            })}
            {unresolved.length > 0 && (
              <p className="unresolved-note">
                {unresolved.length} {t('common.app.conflict')} · {t('common.app.resolve')}
              </p>
            )}
          </div>
        )}
        <div className="modal-footer">
          <button
            className="button button-soft"
            onClick={() => {
              if (preview) {
                setPreview(null);
              } else setPreviewOpen(false);
            }}
          >
            {preview ? t('common.app.back') : t('common.app.close')}
          </button>
          {!preview ? (
            <button
              className="button button-primary"
              onClick={createPreview}
              disabled={busy || selectedSubmissions.length === 0}
            >
              {busy ? t('common.app.loading') : t('common.app.preview')}
            </button>
          ) : (
            <>
              {mobileReading ? (
                <p className="mobile-review-note" role="note">
                  {t('common.app.useAComputerToEditAndPublishLabel3')}
                </p>
              ) : (
                <button
                  className="button button-primary"
                  onClick={publish}
                  disabled={busy || !publishable || unresolved.length > 0}
                >
                  {busy ? t('common.app.loading') : t('common.app.publish')}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
