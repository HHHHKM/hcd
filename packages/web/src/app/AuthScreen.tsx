import { useWorkspace } from './WorkspaceContext';
export default function AuthScreen() {
  const { dark, email, setEmail, password, setPassword, busy, error, passwordResetEnabled, t, changeLocale, login } =
    useWorkspace();

  return (
    <div className={`app ${dark ? 'dark' : ''}`}>
      <main className="auth-page">
        <form className="auth-card" onSubmit={login}>
          <div className="brand auth-brand">
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            <span>
              hcd<span className="brand-period">.</span>
            </span>
          </div>
          <div className="auth-eyebrow">HTML COLLAB DOCS</div>
          <h1>{t('common.app.login')}</h1>
          <p className="auth-description">{t('common.app.readEditAndPublishStructuredDocumentsWith')}</p>
          <label>
            {t('common.app.email')}
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            {t('common.app.password')}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <button className="button button-primary auth-submit" disabled={busy}>
            {busy ? t('common.app.loading') : t('common.app.signIn')}
          </button>
          {passwordResetEnabled && (
            <p className="demo-hint">
              <a href="/auth/forgot">{t('common.app.forgotPassword')}</a>
            </p>
          )}
          <p className="demo-hint">{t('common.app.demoHint')}</p>
          <button type="button" className="language-button auth-language" onClick={changeLocale}>
            {t('common.app.label')}
          </button>
        </form>
      </main>
    </div>
  );
}
