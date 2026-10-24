import { useCallback, useEffect, useState } from 'react';
import { api, type User } from '../../api';
import { translate } from '../../shared/i18n';
import { roles, roleName, errorMessage, ConfirmAction, type Locale, type Role, type Member } from './admin-shared';
export function MembersPanel({
  kind,
  id,
  locale,
  editable,
  onUpdated,
}: {
  kind: 'docs' | 'spaces';
  id: string;
  locale: Locale;
  editable: boolean;
  onUpdated: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const base = `/${kind}/${encodeURIComponent(id)}/members`;
  const refresh = useCallback(async () => {
    const response = await api<{ members: Member[] }>(base);
    setMembers(response.members);
  }, [base]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<{ members: Member[] }>(base)
      .then((response) => {
        if (active) setMembers(response.members);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason, locale));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, locale]);
  useEffect(() => {
    let active = true;
    setResults([]);
    setSelected('');
    if (!editable || !query.trim()) return;
    const timer = window.setTimeout(() => {
      api<{ items: User[] }>(`/users?q=${encodeURIComponent(query.trim())}`)
        .then((response) => {
          if (active) setResults(response.items);
        })
        .catch((reason) => {
          if (active) setError(errorMessage(reason, locale));
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, editable, locale]);
  const changeMember = async (userId: string, nextRole: Role | null) => {
    setBusy(true);
    setError('');
    try {
      await api(
        `${base}/${encodeURIComponent(userId)}`,
        nextRole ? { method: 'PUT', body: { role: nextRole } } : { method: 'DELETE' },
      );
      await refresh();
      onUpdated();
    } catch (reason) {
      setError(errorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="member-panel">
      {kind === 'docs' && (
        <p className="admin-note">{translate(locale, 'admin.documentAccessUsesTheHigherOfTheDocumentAnd')}</p>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{translate(locale, 'admin.loadingMembers')}</p>
      ) : (
        <ul className="admin-list">
          {members.map((member) => (
            <li key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <small>{member.email}</small>
                {member.spaceRole && (
                  <small>
                    {translate(locale, 'admin.spaceRole')}
                    {roleName(member.spaceRole, locale)}
                  </small>
                )}
                <small>
                  {translate(locale, 'admin.effectiveRole')}
                  {roleName(member.role, locale)}
                </small>
              </div>
              <div className="admin-row-actions">
                <select
                  aria-label={`${member.name} ${translate(locale, 'admin.role')}`}
                  disabled={!editable || busy}
                  value={kind === 'docs' ? (member.documentRole ?? '') : member.role}
                  onChange={(event) => changeMember(member.id, (event.currentTarget.value as Role) || null)}
                >
                  {kind === 'docs' && (
                    <option value="" disabled={Boolean(member.documentRole)}>
                      {translate(locale, 'admin.inheritSpaceOnly')}
                    </option>
                  )}
                  {roles.map((option) => (
                    <option key={option} value={option}>
                      {roleName(option, locale)}
                    </option>
                  ))}
                </select>
                {editable && (kind === 'spaces' || member.documentRole) && (
                  <ConfirmAction
                    tone="danger"
                    label={translate(locale, 'admin.removeRole')}
                    question={translate(locale, 'admin.removeTheRoleFor', { value1: member.name })}
                    locale={locale}
                    disabled={busy}
                    onConfirm={() => void changeMember(member.id, null)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="admin-add-member"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected) void changeMember(selected, role);
          }}
        >
          <label>
            {translate(locale, 'admin.findAnAccountByNameOrEmail')}
            <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} autoComplete="off" />
          </label>
          {query.trim() && (
            <label>
              {translate(locale, 'admin.chooseAccount')}
              <select value={selected} onChange={(event) => setSelected(event.currentTarget.value)} required>
                <option value="">{translate(locale, 'admin.choose')}</option>
                {results.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {translate(locale, 'admin.role6700d')}
            <select value={role} onChange={(event) => setRole(event.currentTarget.value as Role)}>
              {roles.map((option) => (
                <option key={option} value={option}>
                  {roleName(option, locale)}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-primary" disabled={busy || !selected}>
            {translate(locale, 'admin.addUpdateMember')}
          </button>
        </form>
      )}
    </section>
  );
}

export function DocumentMembers({
  id,
  locale,
  editable,
  onClose,
  onUpdated,
}: {
  id: string;
  locale: Locale;
  editable: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  return (
    <div className="overlay">
      <section
        className="review-modal administration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-title"
      >
        <div className="modal-top">
          <h2 id="members-title">{translate(locale, 'admin.documentMembers')}</h2>
          <button className="modal-close" onClick={onClose} aria-label={translate(locale, 'admin.close')}>
            ×
          </button>
        </div>
        <MembersPanel kind="docs" id={id} locale={locale} editable={editable} onUpdated={onUpdated} />
      </section>
    </div>
  );
}
