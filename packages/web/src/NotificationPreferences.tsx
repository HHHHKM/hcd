import { translate } from './shared/i18n';
import { useEffect, useState } from 'react';
import { api } from './api';
import { notificationLabel } from './NotificationBell';

type Preferences = { emailConfigured: boolean; email: Record<string, boolean> };
export default function NotificationPreferences({ locale, onClose }: { locale: 'zh-CN' | 'en'; onClose: () => void }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    api<Preferences>('/me/notification-preferences')
      .then((result) => {
        if (active) setPreferences(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    if (!preferences) return;
    setError(false);
    setBusy(true);
    setSaved(false);
    try {
      const result = await api<Preferences>('/me/notification-preferences', {
        method: 'PUT',
        body: { email: preferences.email },
      });
      setPreferences(result);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay">
      <section
        className="review-modal create-modal notification-preferences"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-preferences-title"
      >
        <div className="modal-top">
          <div>
            <h2 id="notification-preferences-title">{translate(locale, 'notifications.notificationPreferences')}</h2>
            <p>{translate(locale, 'notifications.chooseWhichDocumentUpdatesYouReceiveByEmail')}</p>
          </div>
          <button className="modal-close" aria-label={translate(locale, 'notifications.close')} onClick={onClose}>
            ×
          </button>
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {translate(locale, 'notifications.couldNotLoadOrSaveReopenThisPanelTo')}
          </p>
        )}
        {!preferences ? (
          <p role="status">{translate(locale, 'notifications.loadingac33d')}</p>
        ) : (
          <>
            {!preferences.emailConfigured && (
              <p className="notification-setup-note">
                {translate(locale, 'notifications.emailDeliveryIsNotConfiguredYouCanSavePreferences')}
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={busy}>
                <legend>{translate(locale, 'notifications.emailNotifications')}</legend>
                {Object.entries(preferences.email).map(([event, enabled]) => (
                  <label className="notification-preference-row" key={event}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(change) => {
                        setSaved(false);
                        setPreferences({
                          ...preferences,
                          email: { ...preferences.email, [event]: change.currentTarget.checked },
                        });
                      }}
                    />
                    <span>{notificationLabel(event, locale)}</span>
                  </label>
                ))}
              </fieldset>
              {saved && <p role="status">{translate(locale, 'notifications.preferencesSaved')}</p>}
              <div className="modal-footer">
                <button type="button" className="button button-soft" onClick={onClose}>
                  {translate(locale, 'notifications.close')}
                </button>
                <button className="button button-primary" disabled={busy}>
                  {busy
                    ? translate(locale, 'notifications.saving')
                    : translate(locale, 'notifications.savePreferences')}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
