import { translate, preferredLocale } from './shared/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';

type Consent = {
  client: { client_name: string; client_id: string };
  redirectUri: string;
  scopes: string[];
  documents: Array<{ id: string; title: string }>;
  expiresAt: string;
  user: { id: string };
};
const scopeText: Record<string, string> = {
  read: 'auth.oAuthConsentCatalog.scopeText.read',
  comment: 'auth.oAuthConsentCatalog.scopeText.comment',
  submit: 'auth.oAuthConsentCatalog.scopeText.submit',
  ai_tasks: 'auth.oAuthConsentCatalog.scopeText.ai_tasks',
  preview: 'auth.oAuthConsentCatalog.scopeText.preview',
};
export default function OAuthConsent() {
  const [zh, setZh] = useState(() => navigator.language.toLowerCase().startsWith('zh'));
  const languageChosen = useRef(false);
  const [data, setData] = useState<Consent | null>(null);
  const [login, setLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'invalid' | 'network' | 'login' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = new URLSearchParams(window.location.search).get('request') ?? '';
  const locale = zh ? 'zh-CN' : 'en';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'auth.authorizeClientHcd');
  }, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setSelected([]);
    if (!/^or_[A-Za-z0-9_-]{43}$/.test(id)) {
      setError('invalid');
      setLoading(false);
      return () => controller.abort();
    }
    api<Consent>(`/oauth/requests/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setLogin(false);
        void api<{ user: { locale: string } }>('/me', { signal: controller.signal })
          .then(({ user }) => {
            if (!controller.signal.aborted && !languageChosen.current) setZh(preferredLocale(user.locale) === 'zh-CN');
          })
          .catch(() => undefined);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) setLogin(true);
        else setError(reason instanceof ApiError && reason.status < 500 ? 'invalid' : 'network');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, attempt]);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      setPassword('');
      setLogin(false);
      setAttempt((value) => value + 1);
    } catch {
      setError('login');
    } finally {
      setBusy(false);
    }
  }
  async function decide(allow: boolean) {
    if (busy || !data) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ redirect: string }>(`/oauth/requests/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: { allow, docIds: selected, expiresInDays: days },
      });
      const target = new URL(result.redirect);
      const expected = new URL(data.redirectUri);
      if (target.origin !== expected.origin || target.pathname !== expected.pathname)
        throw new Error('Invalid destination');
      window.location.assign(target.href);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status < 500 ? 'invalid' : 'network');
      setBusy(false);
    }
  }
  return (
    <div className="app">
      <main className="auth-page">
        <section className="auth-card oauth-consent" aria-busy={loading || busy}>
          <div className="auth-eyebrow">HCD · HTML COLLAB DOCS</div>
          <h1>{translate(locale, 'auth.authorizeAClient')}</h1>
          <button
            className="language-button auth-language"
            type="button"
            onClick={() => {
              languageChosen.current = true;
              setZh(!zh);
              void api('/me', { method: 'PATCH', body: { locale: zh ? 'en' : 'zh-CN' } }).catch(() => undefined);
            }}
          >
            {translate(locale, 'auth.label')}
          </button>
          {loading && <p role="status">{translate(locale, 'auth.loadingAuthorizationRequest')}</p>}
          {!loading && login && (
            <form onSubmit={signIn}>
              <p>{translate(locale, 'auth.signInToReviewThisRequest')}</p>
              <label>
                {translate(locale, 'auth.email')}
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                {translate(locale, 'auth.password')}
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </label>
              <button className="button button-primary auth-submit" disabled={busy}>
                {translate(locale, 'auth.signIn')}
              </button>
            </form>
          )}
          {data && error !== 'invalid' && (
            <>
              <p>
                <strong>{data.client.client_name}</strong> {translate(locale, 'auth.requestsAccessToYourDocuments')}
              </p>
              <p className="auth-description">{translate(locale, 'auth.theClientSuppliesThisNameHcdHasNotVerified')}</p>
              <dl className="oauth-destination">
                <dt>{translate(locale, 'auth.clientId')}</dt>
                <dd>{data.client.client_id}</dd>
                <dt>{translate(locale, 'auth.returnAddress')}</dt>
                <dd>
                  <strong>{new URL(data.redirectUri).host}</strong>
                  <br />
                  {data.redirectUri}
                </dd>
              </dl>
              {new URL(data.redirectUri).protocol === 'http:' && (
                <p className="auth-description">
                  {translate(locale, 'auth.thisAddressBelongsToALocalApplicationConfirmIt')}
                </p>
              )}
              <ul className="oauth-scopes">
                {data.scopes.map((scope) => (
                  <li key={scope}>{translate(locale, scopeText[scope] ?? scope)}</li>
                ))}
              </ul>
              <p className="auth-description">
                {translate(locale, 'auth.accessIsLimitedByYourCurrentDocumentRoleAnd')}
              </p>
              <fieldset disabled={busy}>
                <legend>{translate(locale, 'auth.selectDocumentsToAllow')}</legend>
                {data.documents.length === 0 ? (
                  <p>{translate(locale, 'auth.noEligibleDocumentsADocumentOwnerMustEnableAi')}</p>
                ) : (
                  data.documents.map((doc) => (
                    <label className="oauth-doc" key={doc.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(doc.id)}
                        onChange={(event) =>
                          setSelected((items) =>
                            event.target.checked ? [...items, doc.id] : items.filter((item) => item !== doc.id),
                          )
                        }
                        disabled={!selected.includes(doc.id) && selected.length >= 100}
                      />
                      <span>{doc.title}</span>
                    </label>
                  ))
                )}
              </fieldset>
              <label>
                {translate(locale, 'auth.authorizationLifetime')}
                <select value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={busy}>
                  {[1, 7, 30].map((day) => (
                    <option value={day} key={day}>
                      {day} {translate(locale, 'auth.days')}
                    </option>
                  ))}
                </select>
              </label>
              <p className="auth-description">{translate(locale, 'auth.accessTokensLastUpTo1HourRefreshesCannot')}</p>
              <div className="oauth-actions">
                <button type="button" className="button button-soft" disabled={busy} onClick={() => void decide(false)}>
                  {translate(locale, 'auth.deny')}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy || !selected.length}
                  onClick={() => void decide(true)}
                >
                  {translate(locale, 'auth.allowSelectedDocuments')}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error === 'invalid'
                ? translate(locale, 'auth.theRequestExpiredOrBelongsToAnotherBrowserStart')
                : error === 'login'
                  ? translate(locale, 'auth.signInFailedCheckYourEmailAndPassword')
                  : translate(locale, 'auth.requestFailedCheckYourConnectionAndRetry')}
            </p>
          )}
          {error === 'network' && (
            <button className="button button-soft" onClick={() => setAttempt((value) => value + 1)}>
              {translate(locale, 'auth.reload')}
            </button>
          )}
          <p>
            <a href="/">{translate(locale, 'auth.backToHcd')}</a>
          </p>
        </section>
      </main>
    </div>
  );
}
