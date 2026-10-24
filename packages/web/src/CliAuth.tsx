import { translate, preferredLocale } from './shared/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import { CliAuthRequestView } from './features/auth/CliAuthPanels';
import {
  normalizeCliAuthCode,
  readCliAuthRequest,
  type Locale,
  type CliAuthResource,
} from './features/auth/cli-auth-api';
export * from './features/auth/cli-auth-api';
export { CliAuthConsent, CliAuthRequestView } from './features/auth/CliAuthPanels';
import './cli-auth.css';
export default function CliAuth({ initialCode, initialLocale }: { initialCode?: string; initialLocale?: Locale } = {}) {
  const [locale, setLocale] = useState<Locale>(
    () =>
      initialLocale ??
      (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'),
  );
  const [code, setCode] = useState(
    () =>
      initialCode ??
      (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('code') ?? '')),
  );
  const [entry, setEntry] = useState(code);
  const [entryError, setEntryError] = useState(false);
  const [retry, setRetry] = useState(0);
  const languageChosen = useRef(initialLocale !== undefined);
  const [resource, setResource] = useState<CliAuthResource | null>(null);
  const normalized = normalizeCliAuthCode(code);
  const requestKey = JSON.stringify([normalized, code, retry]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'auth.authorizeTerminalSignInHcd');
  }, [locale]);
  useEffect(() => {
    if (!normalized) return;
    const controller = new AbortController();
    setResource({ key: requestKey, status: 'loading' });
    readCliAuthRequest(normalized, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setResource({ key: requestKey, status: 'ready', value });
          if (!languageChosen.current) setLocale(preferredLocale(value.user.locale));
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setResource(
            reason instanceof ApiError && reason.status === 401
              ? { key: requestKey, status: 'login' }
              : { key: requestKey, status: 'error', reason },
          );
      });
    return () => controller.abort();
  }, [normalized, requestKey]);
  function enterCode(event: FormEvent) {
    event.preventDefault();
    const value = normalizeCliAuthCode(entry);
    if (!value) {
      setEntryError(true);
      return;
    }
    setEntryError(false);
    setCode(value);
    setRetry((value) => value + 1);
    if (typeof window !== 'undefined')
      window.history.replaceState(null, '', `/cli-auth?code=${encodeURIComponent(value)}`);
  }
  return (
    <div className="app">
      <main className="auth-page">
        <section className="auth-card cli-auth" aria-labelledby="cli-auth-title">
          <div className="auth-eyebrow">HCD · HTML COLLAB DOCS</div>
          <h1 id="cli-auth-title">{translate(locale, 'auth.authorizeTerminalSignIn')}</h1>
          <button
            className="language-button auth-language"
            type="button"
            onClick={() => {
              languageChosen.current = true;
              setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN');
              void api('/me', { method: 'PATCH', body: { locale: locale === 'zh-CN' ? 'en' : 'zh-CN' } }).catch(
                () => undefined,
              );
            }}
          >
            {translate(locale, 'auth.label')}
          </button>
          {!normalized ? (
            <form onSubmit={enterCode}>
              <p>{translate(locale, 'auth.enterTheCodeDisplayedInYourTerminalToReview')}</p>
              <label>
                {translate(locale, 'auth.verificationCode')}
                <input
                  className="cli-auth-code-input"
                  value={entry}
                  onChange={(event) => {
                    setEntry(event.target.value);
                    setEntryError(false);
                  }}
                  required
                  maxLength={9}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABCD-EFGH"
                  aria-invalid={entryError || Boolean(code)}
                />
              </label>
              {(entryError || Boolean(code)) && (
                <p className="error-banner" role="alert">
                  {translate(locale, 'auth.enterTheEightCharacterCodeSuchAsAbcdEfgh')}
                </p>
              )}
              <button className="button button-primary auth-submit">{translate(locale, 'auth.reviewRequest')}</button>
            </form>
          ) : (
            <CliAuthRequestView
              requestKey={requestKey}
              resource={resource}
              locale={locale}
              onRetry={() => setRetry((value) => value + 1)}
            />
          )}
          <p className="cli-auth-back">
            <a href="/">{translate(locale, 'auth.backToHcd')}</a>
          </p>
        </section>
      </main>
    </div>
  );
}
