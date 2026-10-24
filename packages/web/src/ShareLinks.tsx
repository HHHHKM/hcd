import { translate, translateErrorCode, formatDate } from './shared/i18n';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import './sharing.css';

type Locale = 'zh-CN' | 'en';
type Link = {
  id: string;
  role: 'viewer' | 'commenter';
  versionPin: number | null;
  showComments: boolean;
  commenterAvailable: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
};
function errorText(error: unknown, locale: Locale) {
  if (error instanceof ApiError && error.code === 'SMTP_NOT_CONFIGURED')
    return translate(locale, 'share.commenterLinksRequireEmailDeliveryConfiguration');
  const fallback = translate(locale, 'share.theRequestFailedRetry');
  return error instanceof ApiError ? translateErrorCode(locale, error.code, fallback) : fallback;
}
export default function ShareLinks({
  docId,
  locale,
  currentVersion,
  onClose,
}: {
  docId: string;
  locale: Locale;
  currentVersion: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<'viewer' | 'commenter'>('viewer');
  const [commenterAvailable, setCommenterAvailable] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [days, setDays] = useState('');
  const [showComments, setShowComments] = useState(true);
  const refresh = useCallback(async () => {
    const result = await api<{ links: Link[]; commenterAvailable: boolean }>(
      `/docs/${encodeURIComponent(docId)}/share-links`,
    );
    setItems(result.links);
    setCommenterAvailable(result.commenterAvailable);
  }, [docId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<{ links: Link[]; commenterAvailable: boolean }>(`/docs/${encodeURIComponent(docId)}/share-links`)
      .then((result) => {
        if (active) {
          setItems(result.links);
          setCommenterAvailable(result.commenterAvailable);
        }
      })
      .catch((reason) => {
        if (active) setError(errorText(reason, locale));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [docId, locale]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setLink(null);
    try {
      const result = await api<{ link: { url: string; expiresAt: string | null } }>(
        `/docs/${encodeURIComponent(docId)}/share-links`,
        {
          method: 'POST',
          body: { role, versionPin: pin ? Number(pin) : null, expiresInDays: days ? Number(days) : null, showComments },
        },
      );
      setLink(result.link);
      setCopied(false);
      await refresh();
    } catch (reason) {
      setError(errorText(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`/docs/${encodeURIComponent(docId)}/share-links/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
      setConfirmRevoke(null);
    } catch (reason) {
      setError(errorText(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay">
      <section className="review-modal share-links-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="modal-top">
          <div>
            <h2 id="share-title">{translate(locale, 'share.shareLinks')}</h2>
            <p>{translate(locale, 'share.guestsCanAccessPublishedVersionsOfThisDocument')}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={translate(locale, 'share.close')}>
            ×
          </button>
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <form className="share-create-form" onSubmit={create}>
          <label>
            {translate(locale, 'share.access')}
            <select value={role} onChange={(event) => setRole(event.currentTarget.value as 'viewer' | 'commenter')}>
              <option value="viewer">{translate(locale, 'share.viewer')}</option>
              <option value="commenter" disabled={!commenterAvailable}>
                {translate(locale, 'share.commentAfterEmailVerification')}
              </option>
            </select>
          </label>
          <label>
            {translate(locale, 'share.versionPin')}
            <select value={pin} onChange={(event) => setPin(event.currentTarget.value)}>
              <option value="">
                {translate(locale, 'share.alwaysShowLatestCurrentlyV', { value1: currentVersion })}
              </option>
              {Array.from({ length: currentVersion }, (_, index) => currentVersion - index).map((version) => (
                <option value={version} key={version}>
                  v{version}
                </option>
              ))}
            </select>
          </label>
          <label>
            {translate(locale, 'share.expiresAfter')}
            <select value={days} onChange={(event) => setDays(event.currentTarget.value)}>
              <option value="">{translate(locale, 'share.never')}</option>
              <option value="1">1 {translate(locale, 'share.day')}</option>
              <option value="7">7 {translate(locale, 'share.days')}</option>
              <option value="30">30 {translate(locale, 'share.days')}</option>
              <option value="90">90 {translate(locale, 'share.days')}</option>
            </select>
          </label>
          <label className="share-checkbox">
            <input
              type="checkbox"
              checked={showComments}
              onChange={(event) => setShowComments(event.currentTarget.checked)}
            />
            {translate(locale, 'share.allowViewingDiscussions')}
          </label>
          <p className="share-note">
            {commenterAvailable
              ? translate(locale, 'share.commentersMustVerifyTheirEmailBeforeReadingAndCommenting')
              : translate(locale, 'share.emailDeliveryIsNotConfiguredOnlyViewerLinksAre')}
          </p>
          <button className="button button-primary" disabled={busy}>
            {translate(locale, 'share.createShareLink')}
          </button>
        </form>
        {link && (
          <section className="new-share-link">
            <label>
              {translate(locale, 'share.newLinkShownOnce')}
              <input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div>
              <span>
                {link.expiresAt
                  ? `${translate(locale, 'share.expires')}${formatDate(link.expiresAt, locale)}`
                  : translate(locale, 'share.neverExpires')}
              </span>
              <button
                className="button button-soft"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? translate(locale, 'share.copied') : translate(locale, 'share.copy')}
              </button>
            </div>
          </section>
        )}
        <h3 className="share-list-heading">{translate(locale, 'share.existingLinks')}</h3>
        {loading ? (
          <p role="status">{translate(locale, 'share.loading')}</p>
        ) : items.length ? (
          <ul className="share-link-list">
            {items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.role === 'viewer' ? translate(locale, 'share.viewer') : translate(locale, 'share.commenter')}
                    {item.versionPin ? ` · v${item.versionPin}` : translate(locale, 'share.latest')}
                  </strong>
                  <small>
                    {item.revokedAt
                      ? translate(locale, 'share.revoked')
                      : item.active
                        ? translate(locale, 'share.active')
                        : translate(locale, 'share.expired')}{' '}
                    · {item.expiresAt ? formatDate(item.expiresAt, locale) : translate(locale, 'share.neverExpires')}
                  </small>
                </div>
                {item.active &&
                  (confirmRevoke === item.id ? (
                    <div className="share-revoke-confirm">
                      <span>{translate(locale, 'share.thisLinkWillStopWorkingImmediately')}</span>
                      <button
                        className="button button-soft danger-action"
                        disabled={busy}
                        onClick={() => void revoke(item.id)}
                      >
                        {translate(locale, 'share.confirmRevocation')}
                      </button>
                      <button className="button button-soft" disabled={busy} onClick={() => setConfirmRevoke(null)}>
                        {translate(locale, 'share.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="button button-soft danger-action"
                      disabled={busy}
                      onClick={() => setConfirmRevoke(item.id)}
                    >
                      {translate(locale, 'share.revoke')}
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="share-note">{translate(locale, 'share.noShareLinksYet')}</p>
        )}
      </section>
    </div>
  );
}
