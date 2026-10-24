import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { translate, formatDate } from '../../shared/i18n';
import {
  buildCliAuthDecision,
  sendCliAuthDecision,
  scopeText,
  type Locale,
  type Status,
  type CliAuthData,
  type CliAuthResource,
} from './cli-auth-api';
type ErrorKind = 'invalid' | 'session' | 'access' | 'network';

function errorKind(reason: unknown): ErrorKind {
  if (!(reason instanceof ApiError) || reason.status >= 500) return 'network';
  if (reason.status === 401 || reason.code === 'CLI_AUTH_SESSION_MISMATCH') return 'session';
  if (reason.status === 403) return 'access';
  return 'invalid';
}

function CliAuthError({ reason, locale, onRetry }: { reason: unknown; locale: Locale; onRetry: () => void }) {
  const kind = errorKind(reason);
  const messages: Record<ErrorKind, string> = {
    invalid: 'auth.cliAuthCatalog.messages.invalid',
    session: 'auth.cliAuthCatalog.messages.session',
    access: 'auth.cliAuthCatalog.messages.access',
    network: 'auth.cliAuthCatalog.messages.network',
  };
  return (
    <div className="cli-auth-error">
      <p className="error-banner" role="alert">
        {translate(locale, messages[kind] ?? '')}
      </p>
      <button type="button" className="button button-soft" onClick={onRetry}>
        {translate(locale, 'auth.reloadRequest')}
      </button>
    </div>
  );
}

function CliAuthLogin({ locale, onSignedIn }: { locale: Locale; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password }, signal: controller.signal });
      controller.signal.throwIfAborted();
      setPassword('');
      onSignedIn();
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <form onSubmit={signIn} aria-busy={busy}>
      <p>{translate(locale, 'auth.signInToReviewThisTerminalRequestSigningIn')}</p>
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
      {failed && (
        <p className="error-banner" role="alert">
          {translate(locale, 'auth.signInFailedCheckYourEmailPasswordAndConnection')}
        </p>
      )}
      <button className="button button-primary auth-submit" disabled={busy}>
        {busy ? translate(locale, 'auth.signingIn') : translate(locale, 'auth.signInAndReview')}
      </button>
    </form>
  );
}

export function CliAuthConsent({ data, locale, onRetry }: { data: CliAuthData; locale: Locale; onRetry: () => void }) {
  const [scopes, setScopes] = useState(() => [...data.request.scopes]);
  const [selected, setSelected] = useState<string[]>([]);
  const [allDocuments, setAllDocuments] = useState(false);
  const [days, setDays] = useState(30);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<Status | null>(null);
  const expiry = Date.parse(data.request.expiresAt);
  const [expired, setExpired] = useState(() => Date.now() >= expiry);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, Math.min(expiry - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [expiry]);
  const status = outcome ?? (data.request.status === 'pending' && expired ? 'expired' : data.request.status);
  const availableScopes = [...new Set([...data.request.scopes, ...(data.request.optionalScopes ?? [])])];
  const validChoice =
    confirmed &&
    scopes.length > 0 &&
    (allDocuments || selected.length > 0) &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 90;
  async function decide(decision: 'approve' | 'deny') {
    if (active.current || failure || status !== 'pending' || Date.now() >= expiry) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const body = buildCliAuthDecision(data, { decision, confirmed, scopes, allDocuments, selected, days });
      const result = await sendCliAuthDecision(data.request.code, body, controller.signal);
      if (!controller.signal.aborted) setOutcome(result.status);
    } catch (reason) {
      if (!controller.signal.aborted) setFailure(reason);
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  if (status !== 'pending')
    return (
      <div className="cli-auth-result" role="status">
        <h2>
          {status === 'approved'
            ? translate(locale, 'auth.terminalAccessApproved')
            : status === 'denied'
              ? translate(locale, 'auth.authorizationDenied')
              : translate(locale, 'auth.codeExpired')}
        </h2>
        <p>
          {status === 'approved'
            ? translate(locale, 'auth.returnToTheTerminalWhereYouStartedSignIn')
            : status === 'denied'
              ? translate(locale, 'auth.thisRequestWillNotReceiveACredentialStartAnother')
              : translate(locale, 'auth.startSignInAgainFromTheTerminalAndCheck')}
        </p>
      </div>
    );
  return (
    <div aria-busy={busy}>
      <p>
        {translate(locale, 'auth.signedInAs')}
        <strong>{data.user.email}</strong>
      </p>
      <section className="cli-auth-identity" aria-labelledby="cli-auth-identity-title">
        <h2 id="cli-auth-identity-title">{translate(locale, 'auth.checkTheComputerYouAreUsing')}</h2>
        <dl>
          <dt>{translate(locale, 'auth.application')}</dt>
          <dd>
            <bdi>{data.request.clientName}</bdi>
          </dd>
          <dt>{translate(locale, 'auth.requestingComputer')}</dt>
          <dd>
            <bdi>{data.request.hostname}</bdi>
          </dd>
        </dl>
        <p className="cli-auth-code-label">{translate(locale, 'auth.compareThisCodeWithTheOneShownInYour')}</p>
        <p className="cli-auth-code" dir="ltr">{data.request.code}</p>
        <p>{translate(locale, 'auth.theRequesterSuppliesTheApplicationAndComputerNamesHcd')}</p>
        <p>
          {translate(locale, 'auth.requestExpires')}
          <time dateTime={data.request.expiresAt}>{formatDate(expiry, locale)}</time>
        </p>
      </section>
      <fieldset disabled={busy || Boolean(failure)} className="cli-auth-options">
        <legend>{translate(locale, 'auth.permissionsToAllow')}</legend>
        {availableScopes.map((scope) => (
          <label className="cli-auth-check" key={scope}>
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) =>
                setScopes((items) =>
                  event.target.checked ? [...items, scope] : items.filter((item) => item !== scope),
                )
              }
            />
            <span>{translate(locale, scopeText[scope] ?? scope)}</span>
          </label>
        ))}
      </fieldset>
      <p className="cli-auth-help">
        {translate(locale, 'auth.yourDocumentRoleCredentialPermissionsAndAiSettingsStill')}
      </p>
      <fieldset disabled={busy || Boolean(failure)} className="cli-auth-options">
        <legend>{translate(locale, 'auth.documentAccess')}</legend>
        <label className="cli-auth-check">
          <input
            type="radio"
            name="cli-auth-documents"
            checked={!allDocuments}
            onChange={() => setAllDocuments(false)}
          />
          <span>{translate(locale, 'auth.onlySelectedDocuments')}</span>
        </label>
        <label className="cli-auth-check">
          <input type="radio" name="cli-auth-documents" checked={allDocuments} onChange={() => setAllDocuments(true)} />
          <span>{translate(locale, 'auth.allDocumentsICanAccessNowAndInThe')}</span>
        </label>
        {!allDocuments && (
          <div className="cli-auth-document-list">
            {data.documents.length ? (
              data.documents.map((doc) => (
                <label className="cli-auth-check" key={doc.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(doc.id)}
                    disabled={!selected.includes(doc.id) && selected.length >= 100}
                    onChange={(event) =>
                      setSelected((items) =>
                        event.target.checked ? [...items, doc.id] : items.filter((item) => item !== doc.id),
                      )
                    }
                  />
                  <span>{doc.title}</span>
                </label>
              ))
            ) : (
              <p>{translate(locale, 'auth.thereAreNoDocumentsToSelect')}</p>
            )}
          </div>
        )}
      </fieldset>
      <label className="cli-auth-lifetime">
        {translate(locale, 'auth.credentialLifetimeInDays190')}
        <input
          type="number"
          min={1}
          max={90}
          step={1}
          required
          value={Number.isNaN(days) ? '' : days}
          disabled={busy || Boolean(failure)}
          onChange={(event) => setDays(event.target.value === '' ? NaN : Number(event.target.value))}
        />
      </label>
      <label className="cli-auth-check cli-auth-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || Boolean(failure)}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>{translate(locale, 'auth.iConfirmTheCodeMatchesMyTerminalAndThis')}</span>
      </label>
      <div className="cli-auth-actions">
        <button
          type="button"
          className="button button-soft"
          disabled={busy || Boolean(failure)}
          onClick={() => void decide('deny')}
        >
          {translate(locale, 'auth.deny')}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || Boolean(failure) || !validChoice}
          onClick={() => void decide('approve')}
        >
          {busy ? translate(locale, 'auth.processing') : translate(locale, 'auth.allowTerminalAccess')}
        </button>
      </div>
      {failure ? <CliAuthError reason={failure} locale={locale} onRetry={onRetry} /> : null}
    </div>
  );
}

export function CliAuthRequestView({
  requestKey,
  resource,
  locale,
  onRetry,
}: {
  requestKey: string;
  resource: CliAuthResource | null;
  locale: Locale;
  onRetry: () => void;
}) {
  if (resource?.key !== requestKey || resource.status === 'loading')
    return <p role="status">{translate(locale, 'auth.loadingTerminalAuthorizationRequest')}</p>;
  if (resource.status === 'error') return <CliAuthError reason={resource.reason} locale={locale} onRetry={onRetry} />;
  if (resource.status === 'login') return <CliAuthLogin locale={locale} onSignedIn={onRetry} />;
  return <CliAuthConsent key={requestKey} data={resource.value} locale={locale} onRetry={onRetry} />;
}
