import { translate } from './shared/i18n';
import { useState } from 'react';
import type { Document } from '../../core/src/model';
import type { ReviewPresentation } from '../../core/src/review-types';
import ChangeList, { DocumentSnapshot } from './ChangeList';
import { DocumentAssetContext } from './DocumentAssets';
export default function ReviewChanges({
  presentation,
  candidate,
  locale,
  onReadSubmission,
}: {
  presentation?: ReviewPresentation | null;
  candidate?: Document;
  locale: 'zh-CN' | 'en';
  onReadSubmission: (id: string) => void;
}) {
  const [view, setView] = useState<'candidate' | 'proposed' | 'document'>('candidate');
  return (
    <section className="review-presentation" aria-label={translate(locale, 'review.reviewComparison')}>
      <div className="change-tabs" role="group" aria-label={translate(locale, 'review.chooseComparison')}>
        {(['candidate', 'proposed', 'document'] as const).map((key) => (
          <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>
            {key === 'candidate'
              ? translate(locale, 'review.actualCandidateChanges')
              : key === 'proposed'
                ? translate(locale, 'review.originalSubmissions')
                : translate(locale, 'review.fullCandidateDocument')}
          </button>
        ))}
      </div>
      {view !== 'document' && !presentation && (
        <p role="status">{translate(locale, 'review.thisOlderReviewHasNoSavedChangeComparisonRead')}</p>
      )}
      {view === 'candidate' && presentation && (
        <>
          <p className="review-change-intro">
            {translate(locale, 'review.comparedWithPublishedVersionThisIsTheSavedCandidate', {
              value1: presentation.baseVersion,
            })}
          </p>
          <ChangeList changeSet={presentation.candidate} locale={locale} />
        </>
      )}
      {view === 'proposed' && presentation && (
        <>
          <p className="review-change-intro">
            {translate(locale, 'review.eachProposalIsShownAgainstItsOriginalBaselineOperation')}
          </p>
          {presentation.proposed.map((proposal) => (
            <details className="proposal-review" key={proposal.submissionId}>
              <summary>
                <strong>{proposal.message || translate(locale, 'review.submissionWithoutAMessage')}</strong>
                <small>
                  {proposal.authorName} · {translate(locale, 'review.basedOnVersion')} {proposal.baseVersion} ·{' '}
                  {proposal.changeSet.unavailable
                    ? translate(locale, 'review.comparisonUnavailable')
                    : `${proposal.changeSet.changes.length} ${translate(locale, 'review.proposedChanges')}`}
                </small>
              </summary>
              {proposal.candidateEffect !== 'evaluated' && (
                <p className="change-notice">
                  {proposal.candidateEffect === 'excluded_unresolved'
                    ? translate(locale, 'review.thisSubmissionHasUnresolvedConflictsAllItsChangesAre')
                    : proposal.candidateEffect === 'excluded_document_drop'
                      ? translate(locale, 'review.allChangesInThisSubmissionWereDiscarded')
                      : translate(locale, 'review.thisSubmissionIsExcluded')}
                </p>
              )}
              <button className="text-link" type="button" onClick={() => onReadSubmission(proposal.submissionId)}>
                {translate(locale, 'review.readFullSubmission')}
              </button>
              <ChangeList
                changeSet={proposal.changeSet}
                locale={locale}
                outcomes={proposal.operations}
                excluded={proposal.candidateEffect !== 'evaluated'}
              />
            </details>
          ))}
        </>
      )}
      {view === 'document' && candidate && (
        <DocumentAssetContext.Provider value={{ docId: candidate.id }}>
          <DocumentSnapshot document={candidate} locale={locale} />
        </DocumentAssetContext.Provider>
      )}
    </section>
  );
}
