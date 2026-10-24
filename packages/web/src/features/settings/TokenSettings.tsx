import { tokenScopesText, errorText } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function TokenSettings() {
  const {
    locale,
    busy,
    setError,
    tokens,
    tokenName,
    setTokenName,
    newToken,
    tokenScopes,
    setTokenScopes,
    t,
    message,
    createToken,
    revokeToken,
    user,
  } = useWorkspace();
  if (!user) return null;

  return (
    <section className="settings-section">
      <h3>{t('common.app.tokensAndClientAuthorizations')}</h3>
      {newToken && (
        <div className="new-token">
          <p>{t('common.app.tokenOnce')}</p>
          <div>
            <code>{newToken}</code>
            <button
              className="button button-soft"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newToken);
                  message(t('common.app.tokenCopied'));
                } catch (reason) {
                  setError(errorText(reason, t('common.app.unexpected'), locale));
                }
              }}
            >
              {t('common.app.copyToken')}
            </button>
          </div>
        </div>
      )}
      <form onSubmit={createToken}>
        <label>
          {t('common.app.tokenName')}
          <input
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            maxLength={100}
            placeholder={t('common.app.forExampleLocalCLI')}
            required
          />
        </label>
        <div className="token-scopes">
          {['read', 'comment', 'submit', 'ai_tasks', 'preview'].map((scope) => (
            <label key={scope}>
              <input
                type="checkbox"
                checked={tokenScopes.includes(scope)}
                disabled={scope === 'read'}
                onChange={() =>
                  setTokenScopes((old) =>
                    old.includes(scope) ? old.filter((item) => item !== scope) : [...old, scope],
                  )
                }
              />
              <span>{scope}</span>
            </label>
          ))}
        </div>
        <button className="button button-primary" disabled={busy || !tokenName.trim()}>
          {busy ? t('common.app.loading') : t('common.app.createToken')}
        </button>
      </form>
      <div className="token-list">
        {tokens.filter((token) => !token.revoked_at).length === 0 ? (
          <p className="settings-muted">{t('common.app.noTokens')}</p>
        ) : (
          tokens
            .filter((token) => !token.revoked_at)
            .map((token) => (
              <div key={token.id}>
                <span>
                  <strong>
                    {token.name} <small>{token.kind === 'oauth' ? 'OAuth' : 'PAT'}</small>
                  </strong>
                  <small>{tokenScopesText(token.scopes)}</small>
                  {token.expires_at && (
                    <small>
                      {t('common.app.expires')}
                      {new Date(token.expires_at).toLocaleString(locale)}
                    </small>
                  )}
                  {token.last_used_at && (
                    <small>
                      {t('common.app.lastUsed')}
                      <time dateTime={token.last_used_at}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(token.last_used_at))}
                      </time>
                      {token.last_used_ip && <> · IP: {token.last_used_ip}</>}
                    </small>
                  )}
                  {token.kind === 'oauth' && token.doc_ids && (
                    <small>
                      {JSON.parse(token.doc_ids).length} {t('common.app.documentsLabel4')}
                    </small>
                  )}
                </span>
                <button className="button button-soft" onClick={() => revokeToken(token.id)} disabled={busy}>
                  {t('common.app.revoke')}
                </button>
              </div>
            ))
        )}
      </div>
    </section>
  );
}
