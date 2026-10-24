import PasswordSettings from '../../PasswordSettings';
import LogoutAllSessions from '../../LogoutAllSessions';
import { Icon } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
import TokenSettings from './TokenSettings';
import { useNavigate } from 'react-router';
export default function SettingsDialog() {
  const navigate = useNavigate();
  const {
    locale,
    mobileReading,
    user,
    setUser,
    setPassword,
    busy,
    error,
    docMeta,
    setDocMeta,
    setOfficial,
    draftContent,
    draftBaseVersion,
    dirty,
    setDirty,
    setEditing,
    setScreen,
    setNotificationPreferencesOpen,
    setSettingsOpen,
    setAdministrationOpen,
    setMembersOpen,
    setShareOpen,
    setNewToken,
    settingsTitle,
    setSettingsTitle,
    saveTimer,
    saveQueue,
    t,
    saveDraft,
    toggleAi,
    saveTitle,
  } = useWorkspace();
  if (!user) return null;

  return (
    <div className="overlay">
      <section
        className="review-modal create-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-top">
          <div>
            <div className="modal-eyebrow">HCD</div>
            <h2 id="settings-title">{t('common.app.settings')}</h2>
            <p>
              {user.name} · {user.email}
            </p>
          </div>
          <button
            className="modal-close"
            onClick={() => {
              setSettingsOpen(false);
              setNewToken('');
            }}
            aria-label={t('common.app.close')}
          >
            <Icon name="close" />
          </button>
        </div>
        <button
          className="button button-soft"
          onClick={() => {
            setSettingsOpen(false);
            setNotificationPreferencesOpen(true);
          }}
        >
          {t('common.app.notificationPreferences')}
        </button>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <PasswordSettings locale={locale} onUpdated={setUser} />
        <LogoutAllSessions
          locale={locale}
          onBeforeLogout={async () => {
            window.clearTimeout(saveTimer.current);
            if (dirty && docMeta && draftContent) await saveDraft(docMeta.id, draftBaseVersion, draftContent);
            await saveQueue.current;
          }}
          onLoggedOut={() => {
            setUser(null);
            setDocMeta(null);
            setOfficial(null);
            setSettingsOpen(false);
            setNewToken('');
            setDirty(false);
            setEditing(false);
            setScreen('documents');
            setPassword('');
            navigate('/login');
          }}
        />
        {docMeta && (
          <section className="settings-section">
            <h3>{docMeta.title}</h3>
            {docMeta.role === 'owner' && (
              <button
                className="button button-soft"
                onClick={() => {
                  setSettingsOpen(false);
                  setShareOpen(true);
                }}
              >
                {t('common.app.share')}
              </button>
            )}
            {docMeta.role === 'owner' && !mobileReading && (
              <form className="settings-title-form" onSubmit={saveTitle}>
                <label>
                  {t('common.app.title')}
                  <input
                    value={settingsTitle}
                    onChange={(event) => setSettingsTitle(event.target.value)}
                    maxLength={200}
                    required
                  />
                </label>
                <button className="button button-soft" disabled={busy || !settingsTitle.trim()}>
                  {t('common.app.addToDraft')}
                </button>
              </form>
            )}
            <div className="settings-switch-row">
              <span>
                <b>{t('common.app.aiSetting')}</b>
                <small>{docMeta.aiEnabled ? t('common.app.aiOn') : t('common.app.aiOff')}</small>
              </span>
              <button
                type="button"
                className={`toggle-switch ${docMeta.aiEnabled ? 'on' : ''}`}
                aria-label={t('common.app.aiSetting')}
                role="switch"
                aria-checked={docMeta.aiEnabled}
                disabled={busy || docMeta.role !== 'owner'}
                onClick={toggleAi}
              >
                <i />
              </button>
            </div>
          </section>
        )}
        <section className="settings-section">
          <button
            className="button button-soft"
            onClick={() => {
              setSettingsOpen(false);
              setAdministrationOpen(true);
            }}
          >
            {t('common.app.manageWorkspace')}
          </button>
          {docMeta && (
            <button
              className="button button-soft"
              onClick={() => {
                setSettingsOpen(false);
                setMembersOpen(true);
              }}
            >
              {t('common.app.documentMembers')}
            </button>
          )}
        </section>
        <TokenSettings />
      </section>
    </div>
  );
}
