import { translate } from '../../shared/i18n';
import type { Comment } from '../../api';
import { author } from './shared-types';
import type { SharedDocumentModel } from './use-shared-document';
import SharedCommentComposer from './SharedCommentComposer';
export default function SharedDiscussions({ model }: { model: SharedDocumentModel }) {
  const {
    locale,
    result,
    threads,
    busy,
    setRevision,
    locationError,
    visibleThreadAnchor,
    locateComment,
    canComment,
    setParentId,
    setSelectedAnchor,
    clearLocation,
    setDiscussionError,
    composer,
    discussionError,
    notice,
  } = model;
  if (!result) return null;
  const external = (comment: Comment) => (comment.external ? translate(locale, 'share.external') : '');
  return (
    <section className="shared-discussions">
      <h2>{translate(locale, 'share.publicDiscussion')}</h2>
      <button className="text-link" onClick={() => setRevision((value) => value + 1)} disabled={busy}>
        {translate(locale, 'share.refreshDiscussions')}
      </button>
      {locationError && <p role="status">{translate(locale, 'share.thisLocationIsNotInTheDisplayedVersionRefresh')}</p>}
      {threads.length ? (
        threads.map((thread) => (
          <article key={thread.root.id}>
            {thread.anchorState && thread.anchorState !== 'ok' && (
              <p className="shared-anchor-status" role="status">
                {thread.anchorState === 'lost'
                  ? translate(locale, 'share.theOriginalLocationIsUnavailableInThisVersion')
                  : thread.anchorState === 'block_deleted'
                    ? translate(locale, 'share.theOriginalBlockWasDeletedThisCommentRemainsOn')
                    : translate(locale, 'share.theQuotedTextChangedThisCommentRemainsOnIts')}
              </p>
            )}
            {visibleThreadAnchor(thread) && (
              <blockquote className="shared-comment-quote" aria-label={translate(locale, 'share.quotedText')}>
                {thread.root.anchor!.quote}
              </blockquote>
            )}
            {thread.root.anchor?.moduleId && !thread.root.deletedAt && thread.anchorState !== 'lost' && (
              <button type="button" className="text-link" onClick={() => locateComment(thread)}>
                {thread.root.anchor.blockId
                  ? translate(locale, 'share.goToQuotedContent')
                  : translate(locale, 'share.goToSection')}
              </button>
            )}
            <strong>
              {external(thread.root)}
              {author(thread.root)}
            </strong>
            <p>{thread.root.deletedAt ? translate(locale, 'share.commentDeleted') : thread.root.body}</p>
            {thread.replies.map((reply) => (
              <p className="shared-reply" key={reply.id}>
                <strong>
                  {external(reply)}
                  {author(reply)}:
                </strong>{' '}
                {reply.deletedAt ? translate(locale, 'share.commentDeleted') : reply.body}
              </p>
            ))}
            {canComment && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setParentId(thread.root.id);
                  setSelectedAnchor(null);
                  clearLocation();
                  setDiscussionError('');
                  composer.current?.focus();
                }}
              >
                {translate(locale, 'share.reply')}
              </button>
            )}
          </article>
        ))
      ) : (
        <p>{translate(locale, 'share.noPublicDiscussions')}</p>
      )}
      {discussionError && (
        <p role="alert" className="error-banner">
          {discussionError === 'load'
            ? translate(locale, 'share.discussionsCouldNotBeLoadedRefreshToRetry')
            : discussionError === 'refresh'
              ? translate(locale, 'share.commentPostedButDiscussionsCouldNotRefreshRefreshTo')
              : discussionError === 'anchor'
                ? translate(locale, 'share.theQuotedLocationChangedOrCouldNotBeVerified')
                : translate(locale, 'share.theCommentCouldNotBeSentRetry')}
        </p>
      )}
      {canComment && <SharedCommentComposer model={model} />}
      {notice && <p role="status">{translate(locale, 'share.commentPostedTheAiRequestIsAwaitingApproval')}</p>}
    </section>
  );
}
