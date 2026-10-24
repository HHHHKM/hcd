import { translate, formatDate } from './shared/i18n';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import './notifications.css';

type Locale = 'zh-CN' | 'en';
type Notification = {
  id: string;
  doc_id: string;
  kind: string;
  read_at: string | null;
  created_at: string;
  docTitle?: string;
  payload: { version?: number; reason?: string; docTitle?: string; actor?: { name?: string } };
};
const labels: Record<string, string> = {
  pending_summary: 'notifications.notificationBellCatalog.labels.pending_summary',
  mention: 'notifications.notificationBellCatalog.labels.mention',
  reply: 'notifications.notificationBellCatalog.labels.reply',
  submission_pending: 'notifications.notificationBellCatalog.labels.submission_pending',
  submission_published: 'notifications.notificationBellCatalog.labels.submission_published',
  submission_rejected: 'notifications.notificationBellCatalog.labels.submission_rejected',
  anchor_lost: 'notifications.notificationBellCatalog.labels.anchor_lost',
  ai_task_requested: 'notifications.notificationBellCatalog.labels.ai_task_requested',
  ai_task_done: 'notifications.notificationBellCatalog.labels.ai_task_done',
  ai_task_failed: 'notifications.notificationBellCatalog.labels.ai_task_failed',
  ai_task_rejected: 'notifications.notificationBellCatalog.labels.ai_task_rejected',
  auto_published: 'notifications.notificationBellCatalog.labels.auto_published',
};
export function notificationLabel(kind: string, locale: Locale) {
  return translate(locale, labels[kind] ?? 'notifications.aDocumentWasUpdated');
}

export default function NotificationBell({
  locale,
  onOpenDocument,
}: {
  locale: Locale;
  onOpenDocument: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [list, unread] = await Promise.all([
      api<{ notifications: Notification[] }>(`/notifications${onlyUnread ? '?unread=1' : ''}`),
      api<{ count: number }>('/notifications/unread-count'),
    ]);
    setItems(list.notifications);
    setCount(unread.count);
    setError(false);
  }, [onlyUnread]);
  useEffect(() => {
    let active = true;
    const poll = () => {
      if (document.hidden) return;
      api<{ count: number }>('/notifications/unread-count')
        .then((result) => {
          if (active) setCount(result.count);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 30000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api<{ notifications: Notification[] }>(`/notifications${onlyUnread ? '?unread=1' : ''}`)
      .then((result) => {
        if (active) {
          setItems(result.notifications);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, onlyUnread]);
  const markRead = async (id?: string) => {
    setBusy(true);
    try {
      await api('/notifications/read', { method: 'POST', body: id ? { ids: [id] } : { all: true } });
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="icon-button notification-bell"
        aria-label={`${translate(locale, 'notifications.notifications')}${count ? ` (${count})` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {count > 0 && <span className="notification-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="overlay">
          <section
            className="review-modal notifications-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-title"
          >
            <div className="modal-top">
              <div>
                <h2 id="notifications-title">{translate(locale, 'notifications.notifications')}</h2>
                <p>{translate(locale, 'notifications.unread', { value1: count })}</p>
              </div>
              <button
                className="modal-close"
                aria-label={translate(locale, 'notifications.close')}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="notification-controls">
              <label>
                <input
                  type="checkbox"
                  checked={onlyUnread}
                  onChange={(event) => setOnlyUnread(event.currentTarget.checked)}
                />
                {translate(locale, 'notifications.unreadOnly')}
              </label>
              <button className="button button-soft" disabled={busy || count === 0} onClick={() => void markRead()}>
                {translate(locale, 'notifications.markAllAsRead')}
              </button>
              <button
                className="button button-soft"
                disabled={busy}
                onClick={() => void refresh().catch(() => setError(true))}
              >
                {translate(locale, 'notifications.refresh')}
              </button>
            </div>
            {error && (
              <p className="error-banner" role="alert">
                {translate(locale, 'notifications.notificationsCouldNotBeUpdatedPleaseRetry')}
              </p>
            )}
            {loading ? (
              <p className="notification-empty" role="status">
                {translate(locale, 'notifications.loading')}
              </p>
            ) : !items.length ? (
              <p className="notification-empty">{translate(locale, 'notifications.noNotifications')}</p>
            ) : (
              <ul className="notification-list">
                {items.map((item) => (
                  <li key={item.id} className={item.read_at ? '' : 'unread'}>
                    <button
                      className="notification-item"
                      onClick={async () => {
                        setOpen(false);
                        await onOpenDocument(item.doc_id);
                        if (!item.read_at) await markRead(item.id);
                      }}
                    >
                      <strong>{notificationLabel(item.kind, locale)}</strong>
                      <span>
                        {item.docTitle ?? item.payload.docTitle ?? translate(locale, 'notifications.document')}
                        {item.payload.version ? ` · v${item.payload.version}` : ''}
                      </span>
                      {item.payload.actor?.name && <small>{item.payload.actor.name}</small>}
                      {item.payload.reason && <p>{item.payload.reason}</p>}
                      <time dateTime={item.created_at}>{formatDate(item.created_at, locale)}</time>
                    </button>
                    {!item.read_at && (
                      <button className="text-link" disabled={busy} onClick={() => void markRead(item.id)}>
                        {translate(locale, 'notifications.markAsRead')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
