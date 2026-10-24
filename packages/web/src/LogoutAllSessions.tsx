import { translate } from './shared/i18n';
import { useState } from 'react';
import { api, ApiError } from './api';

type Locale = 'zh-CN' | 'en';

export type LogoutAllSessionsProps = {
  locale: Locale;
  onBeforeLogout?: () => Promise<void>;
  onLoggedOut: () => void;
};

function failureMessage(reason: unknown, locale: Locale): string {
  if (reason instanceof ApiError && reason.code === 'UNAUTHENTICATED') {
    return translate(locale, 'errors.UNAUTHENTICATED');
  }
  return translate(locale, 'settings.couldNotSignOutOfAllDevicesTryAgain');
}

export default function LogoutAllSessions({ locale, onBeforeLogout, onLoggedOut }: LogoutAllSessionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const logoutAll = async () => {
    setBusy(true);
    setError('');
    try {
      await onBeforeLogout?.();
      await api('/auth/logout-all', { method: 'POST', body: {} });
      onLoggedOut();
    } catch (reason) {
      setError(failureMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section logout-all-sessions" aria-labelledby="logout-all-title">
      <h3 id="logout-all-title">{translate(locale, 'settings.signOutAllDevices')}</h3>
      <p className="settings-muted">{translate(locale, 'settings.endSessionsOnEveryDeviceIncludingThisOneAccess')}</p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {!confirming ? (
        <button type="button" className="button button-soft" onClick={() => setConfirming(true)} disabled={busy}>
          {translate(locale, 'settings.signOutAllDevices')}
        </button>
      ) : (
        <div
          className="logout-all-confirm"
          role="group"
          aria-label={translate(locale, 'settings.confirmSignOutAllDevices')}
        >
          <p>{translate(locale, 'settings.signOutEverywhereYouWillNeedToSignIn')}</p>
          <button type="button" className="button button-danger" onClick={() => void logoutAll()} disabled={busy}>
            {busy ? translate(locale, 'settings.signingOut') : translate(locale, 'settings.confirmSignOut')}
          </button>
          <button type="button" className="button button-soft" onClick={() => setConfirming(false)} disabled={busy}>
            {translate(locale, 'settings.cancel')}
          </button>
        </div>
      )}
    </section>
  );
}
