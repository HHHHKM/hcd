import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type User, type Space } from '../../api';
import { translate, formatDate } from '../../shared/i18n';
import SpaceIntegrations from '../../SpaceIntegrations';
import { errorMessage, ConfirmAction, type Account, type Locale } from './admin-shared';
import { MembersPanel } from './MembersPanel';
export function Administration({
  user,
  spaces,
  locale,
  onClose,
  onUpdated,
  initialSpaceId,
  initialTab,
  onSpaceChange,
}: {
  user: User;
  spaces: Space[];
  locale: Locale;
  onClose: () => void;
  onUpdated: () => void;
  initialSpaceId?: string;
  initialTab?: 'accounts' | 'spaces';
  onSpaceChange?: (id: string) => void;
}) {
  const [tab, setTab] = useState<'accounts' | 'spaces'>(initialTab ?? (user.isAdmin ? 'accounts' : 'spaces'));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [spaceId, setSpaceId] = useState(initialSpaceId ?? spaces[0]?.id ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async () => {
    if (user.isAdmin) {
      const result = await api<{ users: Account[] }>('/admin/users');
      setAccounts(result.users);
    }
  }, [user.isAdmin]);
  useEffect(() => {
    void refresh().catch((reason) => setError(errorMessage(reason, locale)));
  }, [refresh, locale]);
  const perform = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const result = await api<{ inviteUrl: string; expiresAt: string }>('/admin/users', {
        method: 'POST',
        body: { name, email, isAdmin: admin },
      });
      setLink({ url: result.inviteUrl, expiresAt: result.expiresAt });
      setCopied(false);
      setEmail('');
      setName('');
      setAdmin(false);
      await refresh();
    });
  };
  const patchUser = (id: string, body: unknown) =>
    perform(async () => {
      await api(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      await refresh();
      onUpdated();
    });
  const selectedSpace = spaces.find((space) => space.id === spaceId);
  return (
    <div className="overlay">
      <section
        className="review-modal administration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-title"
      >
        <div className="modal-top">
          <div>
            <h2 id="admin-title">{translate(locale, 'admin.workspaceAdministration')}</h2>
            <p>{user.name}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={translate(locale, 'admin.close')}>
            ×
          </button>
        </div>
        <nav className="admin-tabs" aria-label={translate(locale, 'admin.administrationTabs')}>
          {user.isAdmin && (
            <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>
              {translate(locale, 'admin.accountsAndInvitations')}
            </button>
          )}
          <button className={tab === 'spaces' ? 'active' : ''} onClick={() => setTab('spaces')}>
            {translate(locale, 'admin.spacesAndMembers')}
          </button>
        </nav>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {tab === 'accounts' && user.isAdmin ? (
          <>
            {link && (
              <section className="admin-link">
                <p>{translate(locale, 'admin.giveThisOneUseLinkToTheAccountHolder')}</p>
                <label>
                  {translate(locale, 'admin.accessLink')}
                  <input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
                </label>
                <small>
                  {translate(locale, 'admin.expires')}
                  {formatDate(link.expiresAt, locale)}
                </small>
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
                  {copied ? translate(locale, 'admin.copied') : translate(locale, 'admin.copyLink')}
                </button>
              </section>
            )}
            <form onSubmit={invite} className="admin-invite">
              <h3>{translate(locale, 'admin.inviteAnAccount')}</h3>
              <div className="admin-form-grid">
                <label>
                  {translate(locale, 'admin.name')}
                  <input
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  {translate(locale, 'admin.email')}
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                  />
                </label>
              </div>
              <label className="admin-checkbox">
                <input type="checkbox" checked={admin} onChange={(event) => setAdmin(event.currentTarget.checked)} />
                {translate(locale, 'admin.grantSystemAdministratorAccess')}
              </label>
              <button className="button button-primary" disabled={busy || !name.trim() || !email.trim()}>
                {translate(locale, 'admin.createInvitationLink')}
              </button>
            </form>
            <ul className="admin-list">
              {accounts.map((account) => (
                <li key={account.id}>
                  <div>
                    <strong>{account.name}</strong>
                    <small>{account.email}</small>
                    <small>
                      {account.disabledAt ? translate(locale, 'admin.disabled') : translate(locale, 'admin.enabled')}
                    </small>
                  </div>
                  <div className="admin-row-actions">
                    <label className="admin-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(account.isAdmin)}
                        disabled={busy || account.id === user.id}
                        onChange={(event) => void patchUser(account.id, { isAdmin: event.currentTarget.checked })}
                      />
                      {translate(locale, 'admin.administrator')}
                    </label>
                    <button
                      className="button button-soft"
                      disabled={busy || Boolean(account.disabledAt)}
                      onClick={() =>
                        void perform(async () => {
                          const result = await api<{ resetUrl: string; expiresAt: string }>(
                            `/admin/users/${encodeURIComponent(account.id)}/reset-link`,
                            { method: 'POST', body: {} },
                          );
                          setLink({ url: result.resetUrl, expiresAt: result.expiresAt });
                          setCopied(false);
                        })
                      }
                    >
                      {translate(locale, 'admin.passwordResetLink')}
                    </button>
                    <ConfirmAction
                      tone={account.disabledAt ? 'neutral' : 'danger'}
                      label={
                        account.disabledAt ? translate(locale, 'admin.enable') : translate(locale, 'admin.disable')
                      }
                      question={translate(locale, 'admin.theAccountFor', {
                        value1: translate(locale, account.disabledAt ? 'admin.enable' : 'admin.disable'),
                        value2: account.name,
                        value3: translate(locale, account.disabledAt ? 'admin.enable' : 'admin.disable'),
                      })}
                      locale={locale}
                      disabled={busy || account.id === user.id}
                      onConfirm={() => void patchUser(account.id, { disabled: !account.disabledAt })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <form
              className="admin-invite"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  const result = await api<{ space: Space }>('/spaces', { method: 'POST', body: { name: spaceName } });
                  setSpaceName('');
                  setSpaceId(result.space.id);
                  onUpdated();
                });
              }}
            >
              <label>
                {translate(locale, 'admin.newSpaceName')}
                <input
                  value={spaceName}
                  onChange={(event) => setSpaceName(event.currentTarget.value)}
                  required
                  maxLength={200}
                />
              </label>
              <button className="button button-primary" disabled={busy || !spaceName.trim()}>
                {translate(locale, 'admin.createSpace')}
              </button>
            </form>
            <label>
              {translate(locale, 'admin.manageSpace')}
              <select
                value={spaceId}
                onChange={(event) => {
                  setSpaceId(event.currentTarget.value);
                  onSpaceChange?.(event.currentTarget.value);
                }}
              >
                <option value="">{translate(locale, 'admin.chooseSpace')}</option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            {spaceId && (
              <MembersPanel
                key={spaceId}
                kind="spaces"
                id={spaceId}
                locale={locale}
                editable={Boolean(user.isAdmin || selectedSpace?.role === 'owner')}
                onUpdated={onUpdated}
              />
            )}
            {spaceId && (user.isAdmin || selectedSpace?.role === 'owner') && (
              <SpaceIntegrations key={`integrations-${spaceId}`} spaceId={spaceId} locale={locale} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
