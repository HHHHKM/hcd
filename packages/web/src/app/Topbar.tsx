import NotificationBell from '../NotificationBell';
import { Icon, roleLabel } from './workspace-helpers';
import { useWorkspace } from './WorkspaceContext';
export default function Topbar() {
  const {
    locale,
    dark,
    setDark,
    user,
    spaces,
    docMeta,
    searchText,
    setSearchText,
    setAdministrationOpen,
    t,
    goHome,
    loadDocument,
    changeLocale,
    openSettings,
    logout,
  } = useWorkspace();
  if (!user) return null;

  return (
    <header className="topbar">
      <button className="brand" aria-label="HCD" onClick={() => void goHome()}>
        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>
        <span>
          hcd<span className="brand-period">.</span>
        </span>
      </button>
      <div className="topbar-context">
        <span>{spaces[0]?.name ?? t('common.app.workspace')}</span>
        <Icon name="chevron" size={13} />
        <strong>{docMeta?.title ?? t('common.app.home')}</strong>
      </div>
      <div className="topbar-search-wrap">
        <div className="search-input">
          <Icon name="search" size={16} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('common.app.search')}
            aria-label={t('common.app.search')}
          />
          {searchText && (
            <button onClick={() => setSearchText('')} aria-label={t('common.app.close')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="topbar-actions">
        <NotificationBell key={user.id} locale={locale} onOpenDocument={loadDocument} />
        <button className="icon-button" aria-label={t('common.app.theme')} onClick={() => setDark(!dark)}>
          <Icon name="sun" />
        </button>
        <button className="language-button" onClick={changeLocale}>
          {t('common.app.eN')}
          <span>⌄</span>
        </button>
        <button
          className="button button-soft compact-action workspace-manage"
          aria-label={t('common.app.manageWorkspace')}
          title={t('common.app.manageWorkspace')}
          onClick={() => setAdministrationOpen(true)}
        >
          <Icon name="grid" size={16} />
          <span>{t('common.app.manageWorkspace')}</span>
        </button>
        <button
          className="icon-button"
          aria-label={t('common.app.settings')}
          title={t('common.app.settings')}
          onClick={() => void openSettings()}
        >
          <Icon name="more" />
        </button>
        <button
          className="avatar avatar-coral profile"
          aria-label={`${t('common.app.logout')}: ${user.name}`}
          title={`${user.name} · ${roleLabel(docMeta?.role ?? 'viewer', locale)}`}
          onClick={logout}
        >
          {user.name.slice(0, 1)}
        </button>
      </div>
    </header>
  );
}
