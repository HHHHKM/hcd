import { Icon } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function NewDocumentDialog() {
  const {
    busy,
    error,
    spaces,
    setNewDocOpen,
    newTitle,
    setNewTitle,
    newSpaceId,
    setNewSpaceId,
    t,
    createDocument,
    user,
  } = useWorkspace();
  if (!user) return null;

  return (
    <div className="overlay">
      <form className="review-modal create-modal" onSubmit={createDocument}>
        <div className="modal-top">
          <div>
            <h2>{t('common.app.newDoc')}</h2>
            <p>{t('common.app.createANewBlankStructuredDocument')}</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={() => setNewDocOpen(false)}
            aria-label={t('common.app.close')}
          >
            <Icon name="close" />
          </button>
        </div>
        <label>
          {t('common.app.title')}
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            required
            maxLength={200}
            autoFocus
          />
        </label>
        <label>
          {t('common.app.spaces')}
          <select value={newSpaceId} onChange={(event) => setNewSpaceId(event.target.value)} required>
            {spaces.map((space) => (
              <option value={space.id} key={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="button button-soft" onClick={() => setNewDocOpen(false)}>
            {t('common.app.cancel')}
          </button>
          <button className="button button-primary" disabled={busy || !newTitle.trim() || !newSpaceId}>
            {busy ? t('common.app.loading') : t('common.app.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
