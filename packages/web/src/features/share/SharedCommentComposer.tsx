import { translate } from '../../shared/i18n';
import { author } from './shared-types';
import type { SharedDocumentModel } from './use-shared-document';
export default function SharedCommentComposer({ model }: { model: SharedDocumentModel }) {
  const {
    locale,
    result,
    threads,
    submit,
    parentId,
    setParentId,
    selectedAnchor,
    setSelectedAnchor,
    busy,
    setDiscussionError,
    setRevision,
    moduleId,
    setModuleId,
    clearLocation,
    discussionError,
    composer,
    body,
    setBody,
  } = model;
  if (!result) return null;
  return (
    <form className="guest-comment-form" onSubmit={submit}>
      {parentId ? (
        <div>
          {translate(locale, 'share.replyTo', {
            value1: author(threads.find((thread) => thread.root.id === parentId)?.root),
          })}
          <button type="button" className="text-link" disabled={busy} onClick={() => setParentId(null)}>
            {translate(locale, 'share.cancelReply')}
          </button>
        </div>
      ) : selectedAnchor?.quote ? (
        <div className="shared-comment-selection">
          <small>
            {translate(locale, 'share.quoteFromPublishedVersion')} v{selectedAnchor.version}
          </small>
          <blockquote className="shared-comment-quote">{selectedAnchor.quote}</blockquote>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setSelectedAnchor(null);
              setDiscussionError('');
            }}
          >
            {translate(locale, 'share.commentOnTheSectionInstead')}
          </button>
          <button type="button" className="text-link" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            {translate(locale, 'share.reloadAndSelectAgain')}
          </button>
        </div>
      ) : (
        <label>
          {translate(locale, 'share.location')}
          <select
            value={moduleId}
            disabled={busy}
            onChange={(event) => {
              setModuleId(event.currentTarget.value);
              clearLocation();
            }}
          >
            <option value="">{translate(locale, 'share.entireDocument')}</option>
            {result.content.modules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {discussionError === 'anchor' && !selectedAnchor?.quote && (
        <button type="button" className="text-link" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
          {translate(locale, 'share.reloadAndSelectAgain')}
        </button>
      )}
      <label>
        {translate(locale, 'share.yourComment')}
        <textarea
          ref={composer}
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          maxLength={5000}
          required
          rows={4}
          disabled={busy}
        />
      </label>
      {result.doc.aiEnabled && !parentId && (
        <div>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => setBody((value) => `${value}${value ? ' ' : ''}@[AI](ai) `.slice(0, 5000))}
          >
            @AI
          </button>
          <small>{translate(locale, 'share.aiRequestsRequireDocumentOwnerApproval')}</small>
        </div>
      )}
      <button className="button button-primary" disabled={busy || !body.trim()}>
        {busy ? translate(locale, 'share.sending') : translate(locale, 'share.postComment')}
      </button>
    </form>
  );
}
