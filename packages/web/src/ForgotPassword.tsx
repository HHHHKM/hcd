import { translate } from './shared/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
export default function ForgotPassword() {
  const [locale, setLocale] = useState<'zh-CN' | 'en'>(() => (navigator.language.startsWith('zh') ? 'zh-CN' : 'en'));
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ passwordResetEnabled: boolean }>('/auth/config')
      .then((result) => {
        if (active) setEnabled(result.passwordResetEnabled);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await api('/auth/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app" lang={locale}>
      <main className="auth-page">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-eyebrow">HCD · HTML COLLAB DOCS</div>
          <h1>{translate(locale, 'auth.resetYourPassword')}</h1>
          {sent ? (
            <p role="status">{translate(locale, 'auth.ifThisEmailBelongsToAnActiveAccountYou')}</p>
          ) : enabled === false ? (
            <p>{translate(locale, 'auth.emailDeliveryIsNotConfiguredAskYourAdministratorFor')}</p>
          ) : enabled ? (
            <>
              <p className="auth-description">{translate(locale, 'auth.enterYourAccountEmailTheResetLinkExpiresIn')}</p>
              <label>
                {translate(locale, 'auth.email')}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  required
                  maxLength={254}
                  autoComplete="email"
                  disabled={busy}
                />
              </label>
              <button className="button button-primary auth-submit" disabled={busy}>
                {busy ? translate(locale, 'auth.submitting') : translate(locale, 'auth.sendResetEmail')}
              </button>
            </>
          ) : (
            <p role="status">{translate(locale, 'auth.loading')}</p>
          )}
          {failed && (
            <p role="alert" className="error-banner">
              {translate(locale, 'auth.theRequestFailedTryAgainLater')}
            </p>
          )}
          <p className="demo-hint">
            <a href="/">{translate(locale, 'auth.backToSignIn')}</a>
          </p>
          <button
            type="button"
            className="language-button auth-language"
            onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
          >
            {translate(locale, 'auth.label')}
          </button>
        </form>
      </main>
    </div>
  );
}
