import { translate } from './shared/i18n';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
type Kind = 'feishu_webhook' | 'feishu_app';
type Item = {
  kind: Kind;
  configured: boolean;
  enabled: boolean;
  summary: string;
  lastDelivery: { status: string; error: string | null } | null;
};
type Settings = { baseUrl: string; items: Item[] };
export default function SpaceIntegrations({ spaceId, locale }: { spaceId: string; locale: 'zh-CN' | 'en' }) {
  const base = `/spaces/${encodeURIComponent(spaceId)}/integrations`;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [kind, setKind] = useState<Kind>('feishu_webhook');
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testConfirm, setTestConfirm] = useState(false);
  const current = settings?.items.find((item) => item.kind === kind);
  const report = useCallback(
    (reason: unknown) =>
      setError(
        reason instanceof ApiError && reason.code === 'INTEGRATION_TARGET_INVALID'
          ? 'errors.INTEGRATION_TARGET_INVALID'
          : 'admin.theRequestFailedCheckConfigurationPermissionsAndNetworkAccess',
      ),
    [],
  );
  useEffect(() => {
    let active = true;
    setSettings(null);
    setError('');
    api<Settings>(base)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [base, report]);
  const refresh = async () => setSettings(await api<Settings>(base));
  const clear = () => {
    setUrl('');
    setSecret('');
    setAppId('');
    setAppSecret('');
    setEditing(false);
    setTestConfirm(false);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`${base}/${kind}`, {
        method: 'PUT',
        body: {
          enabled: true,
          config: { locale, ...(kind === 'feishu_webhook' ? { webhookUrl: url, secret } : { appId, appSecret }) },
        },
      });
      clear();
      await refresh();
      setNotice(translate(locale, 'admin.savedAndEnabledNewEventsWillBeDeliveredTo'));
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`${base}/${kind}`, { method: 'PUT', body: { enabled: !current?.enabled } });
      await refresh();
      setNotice(translate(locale, 'admin.statusUpdatedOldPendingEventsWereCancelled'));
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    setTestConfirm(false);
    try {
      const result = await api<{ ok: boolean; error?: string }>(`${base}/${kind}/test`, { method: 'POST', body: {} });
      if (!result.ok) throw new Error(result.error);
      setNotice(translate(locale, 'admin.feishuLarkAcceptedTheTestMessageCheckTheDestination'));
      await refresh();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };
  const status = (value: string) => translate(locale, `admin.deliveryStatus.${value}`);
  return (
    <section className="space-integrations">
      <h3>{translate(locale, 'admin.feishuLarkNotifications')}</h3>
      <p className="admin-note">
        {translate(locale, 'admin.deliverSubmissionsPublicationsMentionsAndAiApprovalRequestsTo')}
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {translate(locale, error)}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {settings ? (
        <>
          <label>
            {translate(locale, 'admin.channel')}
            <select
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind(event.currentTarget.value as Kind);
                clear();
                setNotice('');
                setError('');
              }}
            >
              <option value="feishu_webhook">{translate(locale, 'admin.groupWebhook')}</option>
              <option value="feishu_app">{translate(locale, 'admin.appDirectMessages')}</option>
            </select>
          </label>
          <p className="admin-note">
            {settings.baseUrl} ·{' '}
            {current?.enabled ? translate(locale, 'admin.enabled') : translate(locale, 'admin.disabled196e0')}
            {current?.summary ? ` · ${current.summary}` : ''}
          </p>
          {current?.lastDelivery && (
            <p className="admin-note">
              {translate(locale, 'admin.lastEvent')}
              {status(current.lastDelivery.status)}
              {current.lastDelivery.error ? ` · ${current.lastDelivery.error}` : ''}
            </p>
          )}
          {!current?.configured || editing ? (
            <form onSubmit={save}>
              <p className="admin-note">
                {translate(locale, 'admin.savingEnablesDeliveryUpdatingCancelsTheOldQueueSaved')}
              </p>
              {kind === 'feishu_webhook' ? (
                <>
                  <label>
                    Webhook URL
                    <input
                      type="url"
                      value={url}
                      onChange={(event) => setUrl(event.currentTarget.value)}
                      required
                      maxLength={512}
                      autoComplete="off"
                      placeholder={`${settings.baseUrl}/open-apis/bot/v2/hook/…`}
                    />
                  </label>
                  <label>
                    {translate(locale, 'admin.signingSecretOptional')}
                    <input
                      type="password"
                      value={secret}
                      onChange={(event) => setSecret(event.currentTarget.value)}
                      maxLength={256}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              ) : (
                <>
                  <p className="admin-note">{translate(locale, 'admin.theAppNeedsBotMessagingAndEmailToUser')}</p>
                  <label>
                    App ID
                    <input
                      value={appId}
                      onChange={(event) => setAppId(event.currentTarget.value)}
                      required
                      maxLength={128}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    App Secret
                    <input
                      type="password"
                      value={appSecret}
                      onChange={(event) => setAppSecret(event.currentTarget.value)}
                      required
                      maxLength={512}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              )}
              <div className="admin-row-actions">
                <button className="button button-primary" disabled={busy}>
                  {translate(locale, 'admin.saveAndEnable')}
                </button>
                {current?.configured && (
                  <button type="button" className="button button-soft" onClick={clear} disabled={busy}>
                    {translate(locale, 'admin.cancel')}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="admin-row-actions">
              <button className="button button-soft" disabled={busy} onClick={() => setEditing(true)}>
                {translate(locale, 'admin.replaceConfiguration')}
              </button>
              <button className="button button-soft" disabled={busy} onClick={() => void toggle()}>
                {current.enabled ? translate(locale, 'admin.disable9bcee') : translate(locale, 'admin.enable5c406')}
              </button>
              <button className="button button-soft" disabled={busy} onClick={() => setTestConfirm(true)}>
                {translate(locale, 'admin.testConnection')}
              </button>
            </div>
          )}
          {testConfirm && (
            <p className="admin-confirm">
              {kind === 'feishu_webhook'
                ? translate(locale, 'admin.sendATestMessageToTheConfiguredGroup')
                : translate(locale, 'admin.sendATestMessageToTheFeishuUserMatching')}
              <button className="button button-soft" disabled={busy} onClick={() => void test()}>
                {translate(locale, 'admin.sendTestMessage')}
              </button>
              <button className="text-link" disabled={busy} onClick={() => setTestConfirm(false)}>
                {translate(locale, 'admin.cancel')}
              </button>
            </p>
          )}
        </>
      ) : (
        <p role="status">{translate(locale, 'admin.loading')}</p>
      )}
    </section>
  );
}
