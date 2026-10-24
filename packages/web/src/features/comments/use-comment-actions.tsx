import { useEffect } from 'react';
import { findCommentTarget } from '../../comment-location';
import type { Anchor } from '../../../../core/src/anchors';
import { api, ApiError, type Thread } from '../../api';
import { errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { useDocumentState } from '../document/use-document-state';
import type { usePanelState } from '../../app/use-panel-state';
import type { useActionState } from '../../app/use-action-state';
import type { useWorkspaceData } from '../../app/use-workspace-data';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  'setBusy' | 'setError' | 'docs' | 'docMeta' | 'official' | 'officialVersion'
> &
  Pick<
    ReturnType<typeof useDocumentState>,
    | 'commentAnchor'
    | 'setCommentAnchor'
    | 'focusedThread'
    | 'setFocusedThread'
    | 'readingRoot'
    | 'composer'
    | 'commentSending'
    | 'currentDocId'
    | 'editing'
    | 'activeModule'
    | 'setActiveModule'
  > &
  Pick<ReturnType<typeof usePanelState>, 'threads' | 'setThreads' | 'setCommentsOpen'> &
  Pick<ReturnType<typeof useActionState>, 'newComment' | 'setNewComment' | 't'> &
  Pick<ReturnType<typeof useWorkspaceData>, 'message'>;
export function useCommentActions(model: Input) {
  const {
    setBusy,
    setError,
    docMeta,
    official,
    officialVersion,
    commentAnchor,
    setCommentAnchor,
    focusedThread,
    setFocusedThread,
    readingRoot,
    composer,
    commentSending,
    currentDocId,
    editing,
    activeModule,
    setActiveModule,
    setThreads,
    setCommentsOpen,
    newComment,
    setNewComment,
    t,
    message,
  } = model;
  useEffect(() => {
    if (focusedThread && !editing) return;
    readingRoot.current
      ?.querySelectorAll('[data-hcd-location-active]')
      .forEach((node) => node.removeAttribute('data-hcd-location-active'));
  }, [focusedThread, editing, readingRoot]);
  const selectCommentAnchor = (anchor: Anchor) => {
    if (!docMeta || editing || docMeta.role === 'viewer') return;
    setCommentAnchor({ docId: docMeta.id, anchor });
    setFocusedThread(null);
    if (anchor.moduleId) setActiveModule(anchor.moduleId);
    setCommentsOpen(true);
    requestAnimationFrame(() => composer.current?.focus());
  };
  const commentOnModule = (moduleId: string) => {
    if (!official?.modules.some((module) => module.id === moduleId)) {
      message(t('common.app.publishTheNewSectionBeforeCommenting'));
      return;
    }
    setCommentAnchor(null);
    setFocusedThread(null);
    setActiveModule(moduleId);
    setCommentsOpen(true);
  };
  const locateComment = (thread: Thread) => {
    if (!docMeta || editing || !thread.root.anchor || !readingRoot.current) return;
    setFocusedThread({ docId: docMeta.id, threadId: thread.root.id });
    const target = findCommentTarget(readingRoot.current, thread.root.anchor, thread.anchorState === 'ok');
    readingRoot.current
      .querySelectorAll('[data-hcd-location-active]')
      .forEach((node) => node.removeAttribute('data-hcd-location-active'));
    if (!target) {
      message(t('common.app.thisLocationIsNotInTheDisplayed'));
      return;
    }
    for (let parent = target.parentElement; parent && parent !== readingRoot.current; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    }
    if (window.matchMedia?.('(max-width: 980px)').matches ?? window.innerWidth <= 980) setCommentsOpen(false);
    target.dataset.hcdLocationActive = 'true';
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (thread.root.anchor.moduleId) setActiveModule(thread.root.anchor.moduleId);
  };
  const addComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!docMeta || !newComment.trim() || commentSending.current) return;
    const id = docMeta.id;
    const anchor =
      commentAnchor?.docId === id
        ? commentAnchor.anchor
        : activeModule
          ? { moduleId: activeModule, version: officialVersion }
          : {};
    commentSending.current = true;
    setBusy(true);
    setError('');
    let sent = false;
    try {
      const posted = await api<{ comment?: { anchorState?: string } }>(`/docs/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        body: { body: newComment.trim(), anchor },
      });
      sent = true;
      if (currentDocId.current !== id) return;
      setNewComment('');
      setCommentAnchor(null);
      message(
        posted.comment?.anchorState && posted.comment.anchorState !== 'ok'
          ? t('common.app.commentPostedItsLocationChangedAfterPublication')
          : t('common.app.commentAdded'),
      );
      const result = await api<{ threads: Thread[] }>(`/docs/${encodeURIComponent(id)}/comments?status=all`);
      if (currentDocId.current === id) setThreads(result.threads);
    } catch (reason) {
      if (currentDocId.current === id)
        setError(
          sent
            ? t('common.app.yourCommentWasPostedButTheDiscussion')
            : reason instanceof ApiError &&
                [
                  'ANCHOR_STALE',
                  'INVALID_ANCHOR_VERSION',
                  'INVALID_ANCHOR_FIELD',
                  'ANCHOR_NOT_FOUND',
                  'ANCHOR_QUOTE_MISMATCH',
                ].includes(reason.code)
              ? t('common.app.theQuotedLocationChangedOrCouldNot')
              : `${t('common.app.commentError')}: ${errorText(reason, t('common.app.unexpected'), model.locale)}`,
        );
    } finally {
      commentSending.current = false;
      setBusy(false);
    }
  };
  return { selectCommentAnchor, commentOnModule, locateComment, addComment };
}
