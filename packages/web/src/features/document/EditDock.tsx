import { useWorkspace } from '../../app/WorkspaceContext';
export default function EditDock() {
  const {
    busy,
    canUndo,
    canRedo,
    composing,
    draftBaseVersion,
    dirty,
    saving,
    submissionMessage,
    setSubmissionMessage,
    t,
    travel,
    discardDraft,
    submitChanges,
    user,
    docMeta,
    official,
  } = useWorkspace();
  if (!user || !docMeta || !official) return null;

  return (
    <div className="edit-dock">
      <div className="edit-dock-status">
        <span className="edit-live-dot" />
        {saving || dirty ? t('common.app.save') : t('common.app.clean')}
        <span>·</span>
        {t('common.app.draftBased')}
        {draftBaseVersion}
      </div>
      <div className="draft-history-controls">
        <button className="button button-soft" onClick={() => travel(-1)} disabled={busy || !canUndo || composing}>
          {t('common.app.undo')}
        </button>
        <button className="button button-soft" onClick={() => travel(1)} disabled={busy || !canRedo || composing}>
          {t('common.app.redo')}
        </button>
      </div>
      <button className="button button-soft" onClick={discardDraft} disabled={busy}>
        {t('common.app.discard')}
      </button>
      <label className="submission-message">
        {t('common.app.changeNote')}
        <input
          value={submissionMessage}
          maxLength={500}
          onChange={(event) => setSubmissionMessage(event.target.value)}
          placeholder={t('common.app.optional')}
        />
      </label>
      <button className="button button-primary" onClick={submitChanges} disabled={busy || composing}>
        {t('common.app.submit')}
      </button>
    </div>
  );
}
