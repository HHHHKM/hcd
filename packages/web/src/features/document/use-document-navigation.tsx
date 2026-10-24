import { useNavigate } from 'react-router';
import { useLatestRequest } from '../../app/use-latest-request';
import { useCallback, useRef } from 'react';
import type { Document } from '../../../../core/src/model';
import { api, type DocMeta, type Draft, type Submission, type Thread } from '../../api';
import { normalizeThreads, errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { useDocumentState } from './use-document-state';
import type { usePanelState } from '../../app/use-panel-state';
import type { useActionState } from '../../app/use-action-state';
import type { useWorkspaceData } from '../../app/use-workspace-data';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  'user' | 'setBusy' | 'setError' | 'docs' | 'docMeta' | 'setDocMeta' | 'setOfficial' | 'setOfficialVersion'
> &
  Pick<
    ReturnType<typeof useDocumentState>,
    | 'setCommentAnchor'
    | 'setFocusedThread'
    | 'draftContent'
    | 'setDraftContent'
    | 'draftBaseVersion'
    | 'setDraftBaseVersion'
    | 'dirty'
    | 'setDirty'
    | 'setSaving'
    | 'setEditing'
    | 'setScreen'
    | 'setActiveModule'
  > &
  Pick<
    ReturnType<typeof usePanelState>,
    | 'submissions'
    | 'setSubmissions'
    | 'setSelectedSubmissions'
    | 'setPreview'
    | 'setPreviewOpen'
    | 'threads'
    | 'setThreads'
    | 'setCommentsOpen'
  > &
  Pick<ReturnType<typeof useActionState>, 'setNewComment' | 'setSubmissionMessage' | 'saveTimer' | 'saveQueue' | 't'> &
  Pick<ReturnType<typeof useWorkspaceData>, 'saveDraft'>;
export function useDocumentNavigation(model: Input) {
  const {
    setBusy,
    setError,
    docMeta,
    setDocMeta,
    setOfficial,
    setOfficialVersion,
    setCommentAnchor,
    setFocusedThread,
    draftContent,
    setDraftContent,
    draftBaseVersion,
    setDraftBaseVersion,
    dirty,
    setDirty,
    setSaving,
    setEditing,
    setScreen,
    setActiveModule,
    setSubmissions,
    setSelectedSubmissions,
    setPreview,
    setPreviewOpen,
    setThreads,
    setNewComment,
    setSubmissionMessage,
    saveTimer,
    saveQueue,
    t,
    saveDraft,
  } = model;
  const navigate = useNavigate();
  const { begin, cancel } = useLatestRequest();
  const loadingDocumentId = useRef<string | null>(null);
  const loadDocument = useCallback(
    async (id: string, skipSave = false, updateUrl = true) => {
      const request = begin();
      loadingDocumentId.current = id;
      if (updateUrl) navigate(`/d/${encodeURIComponent(id)}`);
      setBusy(true);
      setError('');
      setPreview(null);
      setPreviewOpen(false);
      setEditing(false);
      try {
        window.clearTimeout(saveTimer.current);
        if (!skipSave && dirty && docMeta && draftContent) await saveDraft(docMeta.id, draftBaseVersion, draftContent);
        await saveQueue.current;
        if (!request.current()) return;
        const result = await api<{ doc: DocMeta; content: Document; draft?: Draft }>(
          `/docs/${encodeURIComponent(id)}`,
          { signal: request.signal },
        );
        if (!request.current()) return;
        const [commentResult, pendingResult] = await Promise.all([
          api<{ threads: Thread[] }>(`/docs/${encodeURIComponent(id)}/comments?status=all`, { signal: request.signal }),
          result.doc.role === 'owner'
            ? api<{ submissions: Submission[] }>(`/docs/${encodeURIComponent(id)}/submissions`, {
                signal: request.signal,
              }).catch(() => ({ submissions: [] }))
            : Promise.resolve({ submissions: [] }),
        ]);
        if (!request.current()) return;
        setDocMeta(result.doc);
        setOfficial(result.content);
        setOfficialVersion(result.doc.currentVersion);
        setCommentAnchor(null);
        setFocusedThread(null);
        if (docMeta?.id !== id) setNewComment('');
        setActiveModule(result.content.modules[0]?.id ?? '');
        setDraftContent(result.draft?.content ?? result.content);
        setDraftBaseVersion(result.draft?.baseVersion ?? result.doc.currentVersion);
        setDirty(false);
        setSaving(false);
        setSubmissionMessage('');
        setThreads(normalizeThreads(commentResult));
        setSubmissions(pendingResult.submissions.filter((item) => item.status === 'pending'));
        setScreen('document');
      } catch (reason) {
        if (request.current()) setError(errorText(reason, t('common.app.unexpected'), model.locale));
      } finally {
        if (request.current()) {
          loadingDocumentId.current = null;
          setBusy(false);
        }
      }
    },
    [
      begin,
      navigate,
      dirty,
      docMeta,
      draftContent,
      draftBaseVersion,
      saveDraft,
      model.locale,
      saveQueue,
      saveTimer,
      setActiveModule,
      setBusy,
      setCommentAnchor,
      setDirty,
      setDocMeta,
      setDraftBaseVersion,
      setDraftContent,
      setEditing,
      setError,
      setFocusedThread,
      setNewComment,
      setOfficial,
      setOfficialVersion,
      setPreview,
      setPreviewOpen,
      setSaving,
      setScreen,
      setSubmissionMessage,
      setSubmissions,
      setThreads,
      t,
    ],
  );
  const openReview = useCallback(
    async (updateUrl = true) => {
      if (!docMeta) return;
      const id = docMeta.id;
      if (updateUrl) {
        navigate(`/d/${encodeURIComponent(id)}/review`);
        return;
      }
      const request = begin();
      setBusy(true);
      setError('');
      try {
        const result = await api<{ submissions: Submission[] }>(`/docs/${encodeURIComponent(id)}/submissions`, {
          signal: request.signal,
        });
        if (!request.current()) return;
        const pending = result.submissions.filter((item) => item.status === 'pending');
        setSubmissions(pending);
        setSelectedSubmissions(pending.map((item) => item.id));
        setPreview(null);
        setPreviewOpen(true);
      } catch (reason) {
        if (request.current()) setError(errorText(reason, t('common.app.unexpected'), model.locale));
      } finally {
        if (request.current()) setBusy(false);
      }
    },
    [
      docMeta,
      begin,
      navigate,
      model.locale,
      setBusy,
      setError,
      setPreview,
      setPreviewOpen,
      setSelectedSubmissions,
      setSubmissions,
      t,
    ],
  );
  const loadHistory = useCallback(async () => {
    if (!docMeta) return;
    setBusy(true);
    setError('');
    try {
      window.clearTimeout(saveTimer.current);
      if (dirty && draftContent) await saveDraft(docMeta.id, draftBaseVersion, draftContent);
      await saveQueue.current;
      setDirty(false);
      setSaving(false);
      setEditing(false);
      setScreen('history');
      navigate(`/d/${encodeURIComponent(docMeta.id)}/history`);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  }, [
    docMeta,
    dirty,
    draftContent,
    draftBaseVersion,
    saveDraft,
    model.locale,
    navigate,
    saveQueue,
    saveTimer,
    setBusy,
    setDirty,
    setEditing,
    setError,
    setSaving,
    setScreen,
    t,
  ]);
  return { loadDocument, openReview, loadingDocumentId, loadHistory, cancelDocumentRequest: cancel };
}
