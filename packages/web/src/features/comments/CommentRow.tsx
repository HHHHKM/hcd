import { useEffect, useRef, useState } from 'react';
import { api, type Comment } from '../../api';
import ActionMenu from '../../shared/ActionMenu';
import { useLocaleTranslation } from '../../shared/i18n';
import CommentText from './CommentText';

type Props = {
  comment: Comment;
  root: boolean;
  locale: 'en' | 'zh-CN';
  canComment: boolean;
  userId: string;
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<boolean>;
  onSubmission?: (id: string) => void;
  active?: boolean;
};
export default function CommentRow({
  comment,
  root,
  locale,
  canComment,
  userId,
  busy,
  perform,
  onSubmission,
  active = false,
}: Props) {
  const t = useLocaleTranslation(locale);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) row.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [active]);
  const cancelDelete = () => {
    setConfirmDelete(false);
    row.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
  };
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const author = typeof comment.author === 'object' ? comment.author.name : comment.author;
  const name = comment.authorName ?? author ?? '—';
  const owned = canComment && !comment.deletedAt && comment.authorId === userId;
  return (
    <div
      ref={row}
      className={root ? '' : 'discussion-reply'}
      id={`comment-${comment.id}`}
      data-hcd-thread-active={active ? 'true' : undefined}
    >
      <div className="comment-head">
        <span className="avatar avatar-blue">{name.slice(0, 1)}</span>
        <div>
          <b>
            {comment.external && t('comments.externalPrefix')}
            {name}
          </b>
          <small>
            {new Intl.DateTimeFormat(locale, {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(comment.createdAt))}
            {comment.editedAt && t('comments.editedSuffix')}
          </small>
        </div>
      </div>
      {editing ? (
        <form
          className="discussion-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await perform(() =>
                api(`/comments/${encodeURIComponent(comment.id)}`, {
                  method: 'PATCH',
                  body: { body: edited.trim() },
                }),
              )
            )
              setEditing(false);
          }}
        >
          <textarea
            autoFocus
            aria-label={t('comments.editComment')}
            value={edited}
            onChange={(event) => setEdited(event.currentTarget.value)}
            required
            maxLength={5000}
          />
          <button className="text-link" disabled={busy || !edited.trim()}>
            {t('comments.save')}
          </button>
          <button type="button" className="text-link" onClick={() => setEditing(false)}>
            {t('comments.cancel')}
          </button>
        </form>
      ) : (
        <p className="comment-text">
          {comment.deletedAt ? <em>{t('comments.deleted')}</em> : <CommentText text={comment.body} />}
        </p>
      )}
      {canComment && !comment.deletedAt && comment.submissionId && onSubmission && (
        <button className="text-link" onClick={() => onSubmission(comment.submissionId!)}>
          {t('comments.viewAiSubmission')}
        </button>
      )}
      {owned && (
        <div className="discussion-actions comment-secondary-actions">
          <ActionMenu
            label={t('comments.actions')}
            disabled={busy}
            actions={[
              {
                id: 'edit',
                label: t('comments.edit'),
                onSelect: () => {
                  setEdited(comment.body);
                  setEditing(true);
                },
              },
              {
                id: 'delete',
                label: t('comments.delete'),
                danger: true,
                onSelect: () => setConfirmDelete(true),
              },
            ]}
          />
        </div>
      )}
      {confirmDelete && (
        <div
          className="comment-delete-confirm"
          role="alertdialog"
          aria-labelledby={`delete-title-${comment.id}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelDelete();
            }
          }}
        >
          <span id={`delete-title-${comment.id}`}>{t('comments.deleteConfirmation')}</span>
          <button
            type="button"
            className="text-link danger-action"
            disabled={busy}
            onClick={async () => {
              if (
                await perform(() =>
                  api(`/comments/${encodeURIComponent(comment.id)}`, {
                    method: 'DELETE',
                  }),
                )
              )
                setConfirmDelete(false);
            }}
          >
            {t('comments.delete')}
          </button>
          <button autoFocus type="button" className="text-link" onClick={cancelDelete}>
            {t('comments.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
