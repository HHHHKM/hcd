import DiscussionThreads, { MentionPicker } from '../../DiscussionThreads';
import { api, type Thread } from '../../api';
import { Icon, roleLabel } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function DiscussionRail() {
  const {
    locale,
    user,
    busy,
    docMeta,
    official,
    setCommentAnchor,
    composer,
    editing,
    activeModule,
    threads,
    setThreads,
    commentsOpen,
    setCommentsOpen,
    newComment,
    setNewComment,
    setSubmissionDetailsId,
    t,
    loadDocument,
    loadHistory,
    locateComment,
    addComment,
    visibleModules,
    selectedCommentAnchor,
    focusedThread,
  } = useWorkspace();
  if (!user || !docMeta || !official) return null;

  return (
    <aside className={`right-rail ${commentsOpen ? 'open' : ''}`} aria-label={t('common.app.comments')}>
      <div className="right-tabs">
        <button className="active">
          {t('common.app.comments')} <span>{threads.length}</span>
        </button>
        <button onClick={loadHistory}>{t('common.app.activity')}</button>
        <button
          className="right-tab-more"
          aria-label={t('common.app.closePanel')}
          onClick={() => setCommentsOpen(false)}
        >
          <Icon name="close" size={17} />
        </button>
      </div>
      <div className="discussion-context">
        <span className="context-line" />
        <div>
          <small>{t('common.app.commentModule')}</small>
          <b>{visibleModules.find((module) => module.id === activeModule)?.title ?? t('common.app.background')}</b>
        </div>
      </div>
      <DiscussionThreads
        key={docMeta.id}
        docId={docMeta.id}
        userId={user.id}
        role={docMeta.role}
        locale={locale}
        aiEnabled={docMeta.aiEnabled}
        threads={threads}
        focusedThreadId={focusedThread?.docId === docMeta.id ? focusedThread.threadId : undefined}
        modules={official.modules}
        onLocate={locateComment}
        locationDisabled={editing}
        onSubmission={setSubmissionDetailsId}
        onRefresh={async () => {
          const result = await api<{ threads: Thread[] }>(
            `/docs/${encodeURIComponent(docMeta.id)}/comments?status=all`,
          );
          setThreads(result.threads);
        }}
      />
      {docMeta.role !== 'viewer' && (
        <form className="comment-composer" onSubmit={addComment}>
          {selectedCommentAnchor?.quote && (
            <div className="comment-selection-summary">
              <small>
                {t('common.app.quoteFromPublishedVersion')} v{selectedCommentAnchor.version}
              </small>
              <blockquote className="comment-quote">{selectedCommentAnchor.quote}</blockquote>
              <button type="button" className="text-link" disabled={busy} onClick={() => setCommentAnchor(null)}>
                {t('common.app.commentOnTheSectionInstead')}
              </button>
              <button
                type="button"
                className="text-link"
                disabled={busy || editing}
                onClick={() => void loadDocument(docMeta.id)}
              >
                {t('common.app.reloadAndSelectAgain')}
              </button>
            </div>
          )}
          <div className="composer-avatar avatar avatar-coral">{user.name.slice(0, 1)}</div>
          <textarea
            ref={composer}
            disabled={busy}
            aria-label={t('common.app.addComment')}
            placeholder={t('common.app.commentPlaceholder')}
            value={newComment}
            onChange={(event) => setNewComment(event.target.value)}
            maxLength={5000}
            required
          />
          <div className="composer-actions">
            <MentionPicker
              docId={docMeta.id}
              locale={locale}
              aiEnabled={docMeta.aiEnabled}
              onSelect={(mention) => setNewComment((value) => (value + mention).slice(0, 5000))}
            />
            <button
              className="send-button"
              type="submit"
              disabled={busy || !newComment.trim()}
              aria-label={t('common.app.send')}
            >
              <Icon name="arrow" size={15} />
            </button>
          </div>
        </form>
      )}
      <div className="right-spacer" />
      <div className="team-card">
        <div className="team-card-heading">
          <span>{t('common.app.available')}</span>
        </div>
        <div className="team-person">
          <span className="avatar avatar-coral">{user.name.slice(0, 1)}</span>
          <span>{user.name}</span>
          <small>{roleLabel(docMeta.role, locale)}</small>
        </div>
        <div className="team-person">
          <span className="avatar avatar-green">AI</span>
          <span>{docMeta.aiEnabled ? t('common.app.aiOn') : t('common.app.aiOff')}</span>
        </div>
      </div>
    </aside>
  );
}
