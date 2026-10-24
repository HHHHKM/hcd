import { preferredLocale } from '../../shared/i18n';
import { useNavigate } from 'react-router';
import { useCallback, useEffect } from 'react';
import type { Document } from '../../../../core/src/model';
import { canonicalJson, limits } from '../../../../core/src/model';
import { createModule } from '../../editor-model';
import { api, type DocMeta, type User } from '../../api';
import { editorIds, errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { useDocumentState } from './use-document-state';
import type { usePanelState } from '../../app/use-panel-state';
import type { useActionState } from '../../app/use-action-state';
import type { useWorkspaceData } from '../../app/use-workspace-data';
import type { useDocumentNavigation } from './use-document-navigation';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  | 'locale'
  | 'setLocale'
  | 'mobileReading'
  | 'user'
  | 'setUser'
  | 'email'
  | 'password'
  | 'busy'
  | 'setBusy'
  | 'setError'
  | 'docs'
  | 'docMeta'
  | 'setDocMeta'
  | 'official'
  | 'setOfficial'
  | 'officialVersion'
> &
  Pick<
    ReturnType<typeof useDocumentState>,
    | 'setCommentAnchor'
    | 'setFocusedThread'
    | 'draftContent'
    | 'setDraftContent'
    | 'changeDraft'
    | 'travelDraft'
    | 'composing'
    | 'submissionAttempt'
    | 'draftBaseVersion'
    | 'setDraftBaseVersion'
    | 'dirty'
    | 'setDirty'
    | 'setSaving'
    | 'editingSession'
    | 'setEditing'
    | 'setScreen'
    | 'setActiveModule'
  > &
  Pick<ReturnType<typeof usePanelState>, 'setNewDocOpen' | 'newTitle' | 'setNewTitle' | 'newSpaceId' | 'submissions'> &
  Pick<
    ReturnType<typeof useActionState>,
    'submissionMessage' | 'setSubmissionMessage' | 'saveTimer' | 'saveRevision' | 'saveQueue' | 't'
  > &
  Pick<ReturnType<typeof useWorkspaceData>, 'message' | 'saveDraft' | 'refreshWorkspace'> &
  Pick<ReturnType<typeof useDocumentNavigation>, 'loadDocument'>;
export function useDraftActions(model: Input) {
  const {
    locale,
    setLocale,
    mobileReading,
    user,
    setUser,
    email,
    password,
    busy,
    setBusy,
    setError,
    docMeta,
    setDocMeta,
    official,
    setOfficial,
    officialVersion,
    setCommentAnchor,
    setFocusedThread,
    draftContent,
    setDraftContent,
    changeDraft,
    travelDraft,
    composing,
    submissionAttempt,
    draftBaseVersion,
    setDraftBaseVersion,
    dirty,
    setDirty,
    setSaving,
    editingSession,
    setEditing,
    setScreen,
    setActiveModule,
    setNewDocOpen,
    newTitle,
    setNewTitle,
    newSpaceId,
    submissionMessage,
    setSubmissionMessage,
    saveTimer,
    saveRevision,
    saveQueue,
    t,
    message,
    saveDraft,
    refreshWorkspace,
    loadDocument,
  } = model;
  useEffect(() => {
    if (!user || !editingSession || !dirty || !docMeta || !draftContent || composing || busy) return;
    window.clearTimeout(saveTimer.current);
    setSaving(true);
    const revision = saveRevision.current;
    saveTimer.current = window.setTimeout(() => {
      saveDraft(docMeta.id, draftBaseVersion, draftContent)
        .then(() => {
          if (revision === saveRevision.current) {
            setDirty(false);
            setSaving(false);
          }
        })
        .catch((reason: unknown) => {
          if (revision === saveRevision.current) setSaving(false);
          setError(`${t('common.app.saveError')}: ${errorText(reason, t('common.app.unexpected'), model.locale)}`);
        });
    }, 900);
    return () => window.clearTimeout(saveTimer.current);
  }, [
    user,
    editingSession,
    dirty,
    docMeta,
    draftContent,
    draftBaseVersion,
    saveDraft,
    composing,
    busy,
    model.locale,
    saveRevision,
    saveTimer,
    setDirty,
    setError,
    setSaving,
    t,
  ]);
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user: User }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setUser(result.user);
      setLocale(preferredLocale(result.user.locale));
      await refreshWorkspace();
    } catch (reason) {
      setError(`${t('common.app.loginError')}: ${errorText(reason, t('common.app.unexpected'), model.locale)}`);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      window.clearTimeout(saveTimer.current);
      if (dirty && docMeta && draftContent) await saveDraft(docMeta.id, draftBaseVersion, draftContent);
      await saveQueue.current;
      await api('/auth/logout', { method: 'POST', body: {} });
      setUser(null);
      setDocMeta(null);
      setOfficial(null);
      setScreen('documents');
      navigate('/login');
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const createDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newTitle.trim() || !newSpaceId) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ doc: DocMeta; content: Document }>('/docs', {
        method: 'POST',
        body: { title: newTitle.trim(), spaceId: newSpaceId },
      });
      setNewDocOpen(false);
      setNewTitle('');
      await refreshWorkspace();
      await loadDocument(result.doc.id);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const commitDraft = useCallback(
    (update: (document: Document) => Document) => {
      changeDraft(update);
      saveRevision.current += 1;
      setDirty(true);
    },
    [changeDraft, saveRevision, setDirty],
  );
  const addModule = () => {
    if (!draftContent || draftContent.modules.length >= limits.modules) return;
    const module = createModule(editorIds, locale);
    commitDraft((content) => ({
      ...content,
      modules: [...content.modules, module],
    }));
    setActiveModule(module.id);
    requestAnimationFrame(() =>
      document.getElementById(`module-${module.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  };
  const travel = (direction: -1 | 1) => {
    travelDraft(direction);
    saveRevision.current += 1;
    setDirty(true);
  };
  const discardDraft = async () => {
    if (!docMeta || !official) return;
    setBusy(true);
    window.clearTimeout(saveTimer.current);
    saveRevision.current += 1;
    try {
      await saveQueue.current;
      await api(`/docs/${encodeURIComponent(docMeta.id)}/draft`, {
        method: 'DELETE',
      });
      setDraftContent(official);
      setDraftBaseVersion(officialVersion);
      setDirty(false);
      setSaving(false);
      setEditing(false);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const navigate = useNavigate();
  const startEditing = (updateUrl = true) => {
    if (!official || mobileReading) return;
    setCommentAnchor(null);
    setFocusedThread(null);
    if (!draftContent) {
      setDraftContent(official);
      setDraftBaseVersion(officialVersion);
    }
    setEditing(true);
    if (updateUrl && docMeta) navigate(`/d/${encodeURIComponent(docMeta.id)}?edit=1`);
  };
  const submitChanges = async () => {
    if (!docMeta || !draftContent || !official || composing || mobileReading) return;
    if (canonicalJson(draftContent) === canonicalJson(official)) {
      message(t('common.app.thereAreNoChangesToSubmit'));
      return;
    }
    const fingerprint = canonicalJson({
      docId: docMeta.id,
      baseVersion: draftBaseVersion,
      content: draftContent,
      message: submissionMessage.trim(),
    });
    if (submissionAttempt.current?.fingerprint !== fingerprint)
      submissionAttempt.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    window.clearTimeout(saveTimer.current);
    saveRevision.current += 1;
    try {
      await saveDraft(docMeta.id, draftBaseVersion, draftContent);
      await api(`/docs/${encodeURIComponent(docMeta.id)}/submissions`, {
        method: 'POST',
        idempotencyKey: submissionAttempt.current!.key,
        body: {
          baseVersion: draftBaseVersion,
          content: draftContent,
          message: submissionMessage.trim(),
        },
      });
      submissionAttempt.current = null;
      setEditing(false);
      setDirty(false);
      setSaving(false);
      setSubmissionMessage('');
      await loadDocument(docMeta.id, true);
      await refreshWorkspace();
      message(t('common.app.submitted'));
    } catch (reason) {
      setError(`${t('common.app.submitError')}: ${errorText(reason, t('common.app.unexpected'), model.locale)}`);
    } finally {
      setBusy(false);
    }
  };
  return {
    login,
    logout,
    createDocument,
    commitDraft,
    addModule,
    travel,
    discardDraft,
    startEditing,
    submitChanges,
  };
}
