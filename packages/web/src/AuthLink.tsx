import { useLocaleTranslation, browserLocale } from './shared/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type User } from './api';

type Locale = 'zh-CN' | 'en';
type LinkKind = 'invite' | 'reset';
type Invite = { kind: LinkKind; email: string; name: string };
type ErrorKey = 'invalid' | 'requestFailed' | 'validation' | null;

export default function AuthLink({ token, kind }: { token: string; kind: LinkKind }) {
  const [locale, setLocale] = useState<Locale>(() => browserLocale());
  const [invite, setInvite] = useState<Invite | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey>(null);
  const [attempt, setAttempt] = useState(0);
  const t = useLocaleTranslation(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${kind === 'invite' ? t('auth.link.inviteTitle') : t('auth.link.resetTitle')} · HCD`;
  }, [locale, kind, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setInvite(null);
    setPassword('');
    let decoded: string;
    try {
      decoded = decodeURIComponent(token);
      if (!/^[A-Za-z0-9_-]{20,256}$/.test(decoded)) throw new Error('Invalid link');
    } catch {
      setError('invalid');
      setLoading(false);
      return () => {
        active = false;
      };
    }
    api<Invite>(`/auth/invites/${encodeURIComponent(decoded)}`)
      .then((result) => {
        if (!active) return;
        if (result.kind !== kind || typeof result.email !== 'string' || typeof result.name !== 'string') {
          setError('invalid');
          return;
        }
        setInvite(result);
        setName(result.name);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof ApiError &&
            (reason.status === 404 || reason.status === 410 || reason.code === 'INVITE_INVALID')
            ? 'invalid'
            : 'requestFailed',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, kind, attempt]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite || busy || error === 'invalid') return;
    if (password.length < 10 || (kind === 'invite' && !name.trim())) {
      setError('validation');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<{ user: User; kind: LinkKind }>(
        `/auth/invites/${encodeURIComponent(decodeURIComponent(token))}/accept`,
        { method: 'POST', body: { name: kind === 'reset' ? invite.name : name.trim(), password } },
      );
      setPassword('');
      window.location.replace('/');
    } catch (reason) {
      const invalid =
        reason instanceof ApiError &&
        (reason.status === 404 || reason.status === 410 || reason.code === 'INVITE_INVALID');
      setError(
        invalid
          ? 'invalid'
          : reason instanceof ApiError && reason.code === 'VALIDATION_FAILED'
            ? 'validation'
            : 'requestFailed',
      );
      if (invalid) setPassword('');
      setBusy(false);
    }
  }

  return (
    <div className="app" lang={locale}>
      <main className="auth-page">
        <form className="auth-card" onSubmit={accept} aria-busy={loading || busy}>
          <div className="brand auth-brand" aria-label="HCD">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              hcd<span className="brand-period">.</span>
            </span>
          </div>
          <div className="auth-eyebrow">HTML COLLAB DOCS</div>
          <h1>{kind === 'invite' ? t('auth.link.inviteTitle') : t('auth.link.resetTitle')}</h1>
          <p className="auth-description">
            {kind === 'invite' ? t('auth.link.inviteDescription') : t('auth.link.resetDescription')}
          </p>
          {loading ? (
            <p className="auth-description" role="status">
              {t('auth.link.loading')}
            </p>
          ) : (
            <>
              {invite && error !== 'invalid' && (
                <>
                  <label>
                    {t('auth.link.email')}
                    <input type="email" autoComplete="username" value={invite.email} readOnly />
                  </label>
                  <label>
                    {t('auth.link.name')}
                    <input
                      autoComplete="name"
                      value={kind === 'reset' ? invite.name : name}
                      onChange={(event) => setName(event.target.value)}
                      readOnly={kind === 'reset'}
                      disabled={busy}
                      required={kind === 'invite'}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    {t('auth.link.password')}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={10}
                      required
                      disabled={busy}
                      aria-describedby="password-hint"
                    />
                  </label>
                  <p className="auth-description" id="password-hint">
                    {t('auth.link.passwordHint')}
                  </p>
                </>
              )}
              {error && (
                <p className="error-banner" role="alert">
                  {t(`auth.link.${error}`)}
                </p>
              )}
              {invite && error !== 'invalid' && (
                <button className="button button-primary auth-submit" disabled={busy}>
                  {busy
                    ? t('auth.link.saving')
                    : kind === 'invite'
                      ? t('auth.link.inviteAction')
                      : t('auth.link.resetAction')}
                </button>
              )}
              {!invite && error === 'requestFailed' && (
                <button
                  type="button"
                  className="button button-soft auth-submit"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  {t('auth.link.retry')}
                </button>
              )}
              <p className="demo-hint">
                <a href="/">{t('auth.link.back')}</a>
              </p>
            </>
          )}
          <button
            type="button"
            className="language-button auth-language"
            onClick={() => setLocale((value) => (value === 'zh-CN' ? 'en' : 'zh-CN'))}
          >
            {t('auth.link.language')}
          </button>
        </form>
      </main>
    </div>
  );
}
