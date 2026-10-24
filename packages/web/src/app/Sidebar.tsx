import { Icon, roleLabel } from './workspace-helpers';
import { useWorkspace } from './WorkspaceContext';
import { useLocation, useNavigate } from 'react-router';
export default function Sidebar() {
  const { locale, user, spaces, docs, docMeta, screen, setNewDocOpen, setNewSpaceId, t, goHome, loadDocument, logout } =
    useWorkspace();
  const navigate = useNavigate();
  const selectedSpaceId = /^\/spaces\/([^/]+)/.exec(useLocation().pathname)?.[1];
  if (!user) return null;

  return (
    <aside className="left-sidebar">
      <div className="side-workspace">
        <div className="workspace-avatar">{spaces[0]?.name?.slice(0, 1) ?? 'H'}</div>
        <div>
          <strong>{spaces[0]?.name ?? t('common.app.workspace')}</strong>
          <span>
            {t('common.app.signedInAs')} · {user.name}
          </span>
        </div>
        <button aria-label={t('common.app.logout')} onClick={logout}>
          <Icon name="more" />
        </button>
      </div>
      <nav className="primary-nav" aria-label={t('common.app.workspace')}>
        <button
          className={`nav-item ${screen === 'documents' ? 'active' : ''}`}
          aria-label={t('common.app.home')}
          onClick={() => void goHome()}
        >
          <Icon name="grid" size={17} />
          <span>{t('common.app.home')}</span>
          <span className="nav-count">{docs.length}</span>
        </button>
        <button className="nav-item" aria-label={t('common.app.recent')} onClick={() => void goHome()}>
          <Icon name="clock" size={17} />
          <span>{t('common.app.recent')}</span>
        </button>
      </nav>
      <div className="side-section">
        <div className="section-label">{t('common.app.spaces')}</div>
        {spaces.map((space) => (
          <button
            key={space.id}
            className={`space-item ${selectedSpaceId === space.id ? 'selected' : ''}`}
            onClick={() => navigate(`/spaces/${encodeURIComponent(space.id)}`)}
          >
            <span className="space-square">{space.name.slice(0, 1)}</span>
            {space.name}
            <span className="space-role">{roleLabel(space.role ?? '', locale)}</span>
          </button>
        ))}
      </div>
      <div className="side-section docs-list">
        <div className="section-label">
          {t('common.app.documents')}
          <button
            onClick={() => {
              setNewSpaceId(spaces[0]?.id ?? '');
              setNewDocOpen(true);
            }}
            aria-label={t('common.app.newDoc')}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        {docs.slice(0, 6).map((doc) => (
          <button
            key={doc.id}
            className={`doc-list-item ${docMeta?.id === doc.id ? 'current' : ''}`}
            onClick={() => loadDocument(doc.id)}
          >
            <span className="doc-emoji">↗</span>
            <span>
              <b>{doc.title}</b>
              <small>v{doc.currentVersion}</small>
            </span>
            {docMeta?.id === doc.id && <span className="doc-list-dot" />}
          </button>
        ))}
      </div>
      <button
        className="template-button"
        onClick={() => {
          setNewSpaceId(spaces[0]?.id ?? '');
          setNewDocOpen(true);
        }}
      >
        <span className="template-icon">
          <Icon name="plus" size={16} />
        </span>
        <span>
          <b>{t('common.app.newDoc')}</b>
          <small>{t('common.app.startWithABlankDocument')}</small>
        </span>
        <Icon name="arrow" size={15} />
      </button>
      <div className="sidebar-footer">
        <span>
          {t('common.app.role')}: {roleLabel(docMeta?.role ?? 'viewer', locale)}
        </span>
        <button onClick={logout} aria-label={t('common.app.logout')}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </aside>
  );
}
