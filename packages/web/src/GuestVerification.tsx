import { translate } from './shared/i18n';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from './api';

export default function GuestVerification({
  token,
  locale,
  onVerified,
}: {
  token: string;
  locale: 'zh-CN' | 'en';
  onVerified: () => void;
}) {
  const base = `/s/${encodeURIComponent(token)}/verify`;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = (reason: unknown) => {
    const value = reason instanceof ApiError ? reason.code : '';
    setError(
      value === 'GUEST_LOCKED'
        ? translate(locale, 'errors.GUEST_LOCKED')
        : value === 'RATE_LIMITED'
          ? translate(locale, 'share.tooManyRequestsPleaseWaitBeforeRetrying')
          : value === 'GUEST_CODE_INVALID'
            ? translate(locale, 'errors.GUEST_CODE_INVALID')
            : value === 'SMTP_NOT_CONFIGURED'
              ? translate(locale, 'errors.SMTP_NOT_CONFIGURED')
              : value === 'INVITE_INVALID'
                ? translate(locale, 'errors.INVITE_INVALID')
                : translate(locale, 'share.theRequestFailedPleaseTryAgain'),
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (challenge) {
        await api(`${base}/finish`, { method: 'POST', body: { challengeId: challenge, code } });
        onVerified();
      } else {
        const result = await api<{ challengeId: string }>(`${base}/start`, {
          method: 'POST',
          body: { name, email, locale },
        });
        setChallenge(result.challengeId);
      }
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="guest-verification">
      <form onSubmit={submit}>
        <p className="auth-eyebrow">HCD · {translate(locale, 'share.sharedDocument')}</p>
        <h1>{translate(locale, 'share.verifyYourEmailToJoin')}</h1>
        <p>
          {challenge
            ? translate(locale, 'share.aCodeWasSentToItExpiresIn10', { value1: email })
            : translate(locale, 'share.enterYourNameAndEmailOnceVerifiedYouCan')}
        </p>
        {challenge ? (
          <label>
            {translate(locale, 'share.sixDigitCode')}
            <input
              value={code}
              onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={busy}
            />
          </label>
        ) : (
          <>
            <label>
              {translate(locale, 'share.displayName')}
              <input
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                autoComplete="name"
                maxLength={100}
                required
                disabled={busy}
              />
            </label>
            <label>
              {translate(locale, 'share.email')}
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                autoComplete="email"
                maxLength={254}
                required
                disabled={busy}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={busy}>
          {busy
            ? translate(locale, 'share.working')
            : challenge
              ? translate(locale, 'share.verifyAndOpen')
              : translate(locale, 'share.sendVerificationCode')}
        </button>
        {challenge && (
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setChallenge('');
              setCode('');
              setError('');
            }}
          >
            {translate(locale, 'share.resendOrUseAnotherEmail')}
          </button>
        )}
      </form>
    </main>
  );
}
