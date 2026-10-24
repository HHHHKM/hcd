import type { Conflict } from '../../api';
import ConflictPlacement from '../../ConflictPlacement';
import AiConflictSuggestion from '../../AiConflictSuggestion';
import { conflictText, conflictKindLabel } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function ConflictCard({ conflict }: { conflict: Conflict }) {
  const {
    locale,
    mobileReading,
    busy,
    docMeta,
    official,
    preview,
    previewKind,
    manualValues,
    setManualValues,
    aiSuggestions,
    setSubmissionDetailsId,
    t,
    requestAiSuggestion,
    resolveConflict,
    user,
  } = useWorkspace();
  if (!user || !preview) return null;
  const resolved = Boolean(conflict.resolution);
  return (
    <div className={`conflict-card ${resolved ? 'resolved' : ''}`} key={conflict.id}>
      <div className="conflict-label">
        <span>{resolved ? '✓' : '!'}</span>
        {t('common.app.conflict')} · {conflictKindLabel(conflict.kind, locale)} ·{' '}
        {official?.modules.find((module) => module.id === conflict.moduleId)?.title ?? ''}
        {conflict.opIndex !== undefined && !/:(document|snapshot)$/.test(conflict.id)
          ? ` · ${t('common.app.labelLabel1')} ${conflict.opIndex + 1}${t('common.app.labelLabel2')}`
          : ''}
      </div>
      <div className="diff-compare">
        <div>
          <small>{t('common.app.keep')}</small>
          <span>{conflictText(conflict.current)}</span>
        </div>
        <div>
          <small>{t('common.app.take')}</small>
          <span>{conflictText(conflict.incoming)}</span>
        </div>
      </div>
      {!mobileReading && (
        <div className="conflict-actions">
          {conflict.kind === 'uncertain' && (
            <p>
              {t('common.app.thisChangeUsesAnUncertainIdentityMatch')}
              <button onClick={() => setSubmissionDetailsId(conflict.id.split(':')[0]!)}>
                {t('common.app.readSubmission')}
              </button>
              <button disabled={busy} onClick={() => resolveConflict(conflict, 'accept')}>
                {t('common.app.acceptThisMatch')}
              </button>
            </p>
          )}
          {conflict.allowed?.includes('drop') && (
            <button disabled={busy} onClick={() => resolveConflict(conflict, 'drop')}>
              {t(/:(document|snapshot)$/.test(conflict.id) ? 'review.dropSubmission' : 'review.dropOperation')}
            </button>
          )}
          {conflict.allowed?.includes('append_end') && (
            <button disabled={busy} onClick={() => resolveConflict(conflict, 'append_end')}>
              {t('common.app.appendToTheList')}
            </button>
          )}
          {conflict.allowed?.includes('restore_and_apply') && (
            <button disabled={busy} onClick={() => resolveConflict(conflict, 'restore_and_apply')}>
              {t('common.app.restoreOriginalBlockAndApply')}
            </button>
          )}
          {conflict.allowed?.includes('place') && preview.candidate && (
            <ConflictPlacement
              key={conflict.id}
              document={preview.candidate}
              locale={locale}
              busy={busy}
              onPlace={(parent, after) => resolveConflict(conflict, 'place', undefined, { parent, after })}
            />
          )}
          {conflict.allowed?.includes('keep_current') && (
            <button onClick={() => resolveConflict(conflict, 'keep_current')}>{t('common.app.allowKeep')}</button>
          )}
          {conflict.allowed?.includes('take_incoming') && (
            <button onClick={() => resolveConflict(conflict, 'take_incoming')}>{t('common.app.allowTake')}</button>
          )}
          {conflict.allowed?.includes('manual') && (
            <>
              <input
                className="manual-resolution"
                aria-label={t('common.app.manual')}
                value={manualValues[conflict.id] ?? ''}
                onChange={(event) =>
                  setManualValues((values) => ({
                    ...values,
                    [conflict.id]: event.target.value,
                  }))
                }
              />
              <button onClick={() => resolveConflict(conflict, 'manual')}>{t('common.app.manual')}</button>
            </>
          )}
        </div>
      )}
      {!mobileReading &&
        !resolved &&
        conflict.allowed?.some((choice) => ['keep_current', 'take_incoming', 'manual'].includes(choice)) &&
        previewKind !== 'restore' && (
          <AiConflictSuggestion
            task={aiSuggestions.find((task) => task.conflictId === conflict.id)}
            enabled={Boolean(docMeta?.aiEnabled)}
            busy={busy}
            locale={locale}
            onRequest={() => requestAiSuggestion(conflict)}
            onAdopt={(taskId) => resolveConflict(conflict, 'ai', taskId)}
          />
        )}
    </div>
  );
}
