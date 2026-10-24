import { useState } from 'react';
import { api, type Thread } from './api';
import CommentRow from './features/comments/CommentRow';
import MentionPicker from './features/comments/MentionPicker';
import { useLocaleTranslation } from './shared/i18n';
import './discussion.css';
export { default as CommentText } from './features/comments/CommentText';
export { default as MentionPicker } from './features/comments/MentionPicker';

type Props = {
  docId: string;
  userId: string;
  role: string;
  locale: 'en' | 'zh-CN';
  aiEnabled: boolean;
  threads: Thread[];
  modules?: Array<{ id: string; title: string }>;
  onRefresh: () => Promise<void>;
  onSubmission?: (id: string) => void;
  onLocate?: (thread: Thread) => void;
  locationDisabled?: boolean;
  focusedThreadId?: string;
};
export default function DiscussionThreads({
  docId,
  userId,
  role,
  locale,
  aiEnabled,
  threads,
  modules = [],
  onRefresh,
  onSubmission,
  onLocate,
  locationDisabled = false,
  focusedThreadId,
}: Props) {
  const t = useLocaleTranslation(locale);
  const canComment = role !== 'viewer';
  const [filter, setFilter] = useState('open');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await action();
      await onRefresh();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const visible = threads.filter(
    (thread) =>
      thread.root.id === focusedThreadId ||
      filter === 'all' ||
      (filter === 'relocate'
        ? thread.anchorState === 'lost' && !thread.root.deletedAt
        : (thread.root.status ?? 'open') === filter),
  );
  return (
    <div className="comment-list">
      <label className="discussion-filter">
        {t('comments.status')}
        <select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
          <option value="open">{t('comments.open')}</option>
          <option value="resolved">{t('comments.resolved')}</option>
          <option value="all">{t('comments.all')}</option>
          <option value="relocate">{t('comments.needsLocation')}</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="error-banner">
          {t('errors.REQUEST_FAILED')}
        </p>
      )}
      {!visible.length && <p className="discussion-empty">{t('comments.empty')}</p>}
      {visible.map((thread) => (
        <article className="comment-card" key={thread.root.id}>
          {thread.anchorState && thread.anchorState !== 'ok' && (
            <div className="anchor-status" role="status">
              {t(
                thread.anchorState === 'lost'
                  ? 'comments.locationLost'
                  : thread.anchorState === 'block_deleted'
                    ? 'comments.blockDeleted'
                    : 'comments.quoteChanged',
              )}
            </div>
          )}
          {thread.root.anchor?.quote && !thread.root.deletedAt && (
            <blockquote className="comment-quote" aria-label={t('comments.quotedText')}>
              {thread.root.anchor.quote}
            </blockquote>
          )}
          {thread.root.anchor?.moduleId && thread.anchorState !== 'lost' && (
            <button
              type="button"
              className="text-link"
              disabled={locationDisabled}
              title={locationDisabled ? t('comments.readingLocationHint') : undefined}
              onClick={() =>
                onLocate
                  ? onLocate(thread)
                  : document
                      .getElementById(`module-${thread.root.anchor!.moduleId}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              {t(thread.root.anchor.blockId ? 'comments.goToQuote' : 'comments.goToSection')}
            </button>
          )}
          {role === 'owner' && thread.anchorState && thread.anchorState !== 'ok' && !thread.root.deletedAt && (
            <label className="discussion-filter">
              {t('comments.moveToSection')}
              <select
                value=""
                disabled={busy}
                onChange={(event) => {
                  const moduleId = event.currentTarget.value;
                  if (moduleId)
                    void perform(() =>
                      api(`/comments/${encodeURIComponent(thread.root.id)}/relocate`, {
                        method: 'POST',
                        body: { anchor: { moduleId } },
                      }),
                    );
                }}
              >
                <option value="">{t('comments.chooseSection')}</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <CommentRow
            comment={thread.root}
            active={thread.root.id === focusedThreadId}
            root
            locale={locale}
            canComment={canComment}
            userId={userId}
            busy={busy}
            perform={perform}
            onSubmission={onSubmission}
          />
          {thread.replies.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              root={false}
              locale={locale}
              canComment={canComment}
              userId={userId}
              busy={busy}
              perform={perform}
              onSubmission={onSubmission}
            />
          ))}
          <div className="discussion-actions">
            {thread.root.status === 'resolved' && <span>{t('comments.resolved')}</span>}
            {canComment && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setReplyId(thread.root.id);
                  setReply('');
                }}
              >
                {t('comments.reply')}
              </button>
            )}
            {canComment &&
              (role === 'owner' ||
                [thread.root, ...thread.replies].some(
                  (comment) => comment.authorId === userId && !comment.deletedAt,
                )) && (
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      api(
                        `/comments/${encodeURIComponent(thread.root.id)}/` +
                          (thread.root.status === 'resolved' ? 'reopen' : 'resolve'),
                        { method: 'POST', body: {} },
                      ),
                    )
                  }
                >
                  {t(thread.root.status === 'resolved' ? 'comments.reopen' : 'comments.resolve')}
                </button>
              )}
          </div>
          {replyId === thread.root.id && (
            <form
              className="discussion-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await perform(() =>
                    api(`/docs/${encodeURIComponent(docId)}/comments`, {
                      method: 'POST',
                      body: { body: reply.trim(), parentId: replyId },
                    }),
                  )
                ) {
                  setReplyId(null);
                  setReply('');
                }
              }}
            >
              {thread.root.external && <p role="note">{t('comments.externalReplyHint')}</p>}
              <textarea
                autoFocus
                aria-label={t('comments.replyComment')}
                value={reply}
                onChange={(event) => setReply(event.currentTarget.value)}
                required
                maxLength={5000}
              />
              <MentionPicker
                docId={docId}
                locale={locale}
                aiEnabled={aiEnabled}
                onSelect={(mention) => setReply((value) => (value + mention).slice(0, 5000))}
              />
              <button className="button button-primary" disabled={busy || !reply.trim()}>
                {t('comments.sendReply')}
              </button>
              <button type="button" className="text-link" onClick={() => setReplyId(null)}>
                {t('comments.cancel')}
              </button>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}
