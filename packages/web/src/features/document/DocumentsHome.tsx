import { Icon, roleLabel } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function DocumentsHome() {
  const {
    locale,
    spaces,
    searchText,
    setNewDocOpen,
    setNewSpaceId,
    setImportOpen,
    setImportSpaceId,
    t,
    loadDocument,
    filteredDocs,
    user,
  } = useWorkspace();
  if (!user) return null;

  return (
    <section className="docs-home">
      <div className="home-heading">
        <div>
          <div className="doc-kicker">
            <span className="kicker-mark">✳</span>
            {t('common.app.workspace')}
          </div>
          <h1>{t('common.app.home')}</h1>
          <p>{t('common.app.collaborativeDocumentsYouCanAccess')}</p>
        </div>
        <div className="home-actions">
          <button
            className="button button-soft"
            onClick={() => {
              setImportSpaceId(spaces[0]?.id ?? '');
              setImportOpen(true);
            }}
            disabled={!spaces.length}
          >
            <Icon name="arrow" size={16} />
            {t('common.app.importButton')}
          </button>
          <button
            className="button button-primary"
            onClick={() => {
              setNewSpaceId(spaces[0]?.id ?? '');
              setNewDocOpen(true);
            }}
            disabled={!spaces.length}
          >
            <Icon name="plus" size={16} />
            {t('common.app.newDoc')}
          </button>
        </div>
      </div>
      {filteredDocs.length ? (
        <div className="doc-card-grid">
          {filteredDocs.map((doc) => (
            <button className="doc-card" key={doc.id} onClick={() => loadDocument(doc.id)}>
              <span className="doc-card-icon">↗</span>
              <span className="doc-card-title">{doc.title}</span>
              <span className="doc-card-meta">
                v{doc.currentVersion} · {roleLabel(doc.role, locale)}
              </span>
              <Icon name="arrow" size={15} />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-symbol">H</span>
          <h2>{searchText ? t('common.app.searchEmpty') : t('common.app.emptyDocs')}</h2>
          <p>{t('common.app.createFirst')}</p>
          {spaces.length > 0 && (
            <button
              className="button button-primary"
              onClick={() => {
                setNewSpaceId(spaces[0]!.id);
                setNewDocOpen(true);
              }}
            >
              {t('common.app.newDoc')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
