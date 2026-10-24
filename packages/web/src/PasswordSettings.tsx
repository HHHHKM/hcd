import { translate } from './shared/i18n';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type User } from './api';

type Locale = 'zh-CN' | 'en';

export type PasswordSettingsProps = {
  locale: Locale;
  onUpdated?: (user: User) => void;
};

function errorMessage(reason: unknown, locale: Locale): string {
  if (!(reason instanceof ApiError)) return translate(locale, 'settings.theRequestFailedTryAgainLater');
  if (reason.code === 'RATE_LIMITED') return translate(locale, 'errors.RATE_LIMITED');
  if (reason.code === 'INVALID_CREDENTIALS' || reason.code === 'INVALID_PASSWORD') {
    return translate(locale, 'errors.INVALID_PASSWORD');
  }
  if (reason.code === 'VALIDATION_FAILED') return translate(locale, 'errors.VALIDATION_FAILED');
  return translate(locale, 'settings.couldNotChangeThePasswordCheckYourInputAnd');
}

export default function PasswordSettings({ locale, onUpdated }: PasswordSettingsProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 10 || newPassword.length > 1024) {
      setError(translate(locale, 'errors.VALIDATION_FAILED'));
      setSaved(false);
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const result = await api<{ user: User }>('/me', { method: 'PATCH', body: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setSaved(true);
      onUpdated?.(result.user);
    } catch (reason) {
      setError(errorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section password-settings" aria-labelledby="password-settings-title">
      <h3 id="password-settings-title">{translate(locale, 'settings.changePassword')}</h3>
      <form className="password-form" onSubmit={submit}>
        <label>
          {translate(locale, 'settings.currentPassword')}
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            required
            disabled={busy}
          />
        </label>
        <label>
          {translate(locale, 'settings.newPassword')}
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
            minLength={10}
            maxLength={1024}
            required
            disabled={busy}
          />
        </label>
        <p className="settings-muted">{translate(locale, 'settings.use101024Characters')}</p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="settings-success" role="status">
            {translate(locale, 'settings.passwordUpdated')}
          </p>
        )}
        <button className="button button-soft" type="submit" disabled={busy || !currentPassword || !newPassword}>
          {busy ? translate(locale, 'settings.saving') : translate(locale, 'settings.updatePassword')}
        </button>
      </form>
    </section>
  );
}
