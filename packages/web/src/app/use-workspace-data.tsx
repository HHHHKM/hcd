import { preferredLocale } from '../shared/i18n';
import { useNavigate } from 'react-router';
import { useCallback, useEffect, useRef } from 'react';
import type { Document } from '../../../core/src/model';
import { validateDocument } from '../../../core/src/model';
import { api, ApiError, type DocMeta, type Space, type User } from '../api';
import { errorText } from './workspace-helpers';
import type { useWorkspaceSession } from './use-workspace-session';
import type { useDocumentState } from '../features/document/use-document-state';
import type { usePanelState } from './use-panel-state';
import type { useActionState } from './use-action-state';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  | 'locale'
  | 'setLocale'
  | 'user'
  | 'setUser'
  | 'setBusy'
  | 'error'
  | 'setError'
  | 'spaces'
  | 'setSpaces'
  | 'docs'
  | 'setDocs'
  | 'docMeta'
  | 'setDocMeta'
> &
  Pick<
    ReturnType<typeof useDocumentState>,
    | 'draftContent'
    | 'setDraftContent'
    | 'draftBaseVersion'
    | 'dirty'
    | 'setDirty'
    | 'saving'
    | 'setSaving'
    | 'setEditing'
    | 'setScreen'
  > &
  Pick<ReturnType<typeof usePanelState>, 'passwordResetEnabled' | 'setPasswordResetEnabled'> &
  Pick<ReturnType<typeof useActionState>, 'setMembersOpen' | 'setToast' | 'saveTimer' | 'saveQueue' | 't'>;
export function useWorkspaceData(model: Input) {
  const {
    setLocale,
    setUser,
    setBusy,
    setError,
    setSpaces,
    setDocs,
    docMeta,
    setDocMeta,
    draftContent,
    setDraftContent,
    draftBaseVersion,
    dirty,
    setDirty,
    saving,
    setSaving,
    setEditing,
    setScreen,
    setPasswordResetEnabled,
    setMembersOpen,
    setToast,
    saveTimer,
    saveQueue,
    t,
  } = model;
  const translations = useRef({ locale: model.locale, t });
  translations.current = { locale: model.locale, t };
  const message = useCallback(
    (value: string) => {
      setToast(value);
      window.setTimeout(() => setToast(''), 3000);
    },
    [setToast],
  );
  const saveDraft = useCallback(
    (id: string, baseVersion: number, content: Document) => {
      const valid = validateDocument(content);
      if (!valid.ok)
        return Promise.reject(new Error(`Invalid content: ${valid.error.map((issue) => issue.path).join(', ')}`));
      const request = saveQueue.current
        .catch(() => undefined)
        .then(() =>
          api(`/docs/${encodeURIComponent(id)}/draft`, {
            method: 'PUT',
            body: { baseVersion, content },
          }),
        );
      saveQueue.current = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    },
    [saveQueue],
  );
  const navigate = useNavigate();
  const goHome = async (updateUrl = true) => {
    window.clearTimeout(saveTimer.current);
    setBusy(true);
    try {
      if (dirty && docMeta && draftContent) await saveDraft(docMeta.id, draftBaseVersion, draftContent);
      await saveQueue.current;
      setDirty(false);
      setSaving(false);
      setEditing(false);
      setScreen('documents');
      setDocMeta(null);
      if (updateUrl) navigate('/');
    } catch (reason) {
      setError(errorText(reason, t('common.app.saveError'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, saving]);
  const refreshWorkspace = useCallback(
    async (signal?: AbortSignal) => {
      const [spacesResult, docsResult] = await Promise.all([
        api<{ spaces: Space[] } | Space[]>('/spaces', { signal }),
        api<{ docs: DocMeta[] } | DocMeta[]>('/docs', { signal }),
      ]);
      if (signal?.aborted) return;
      setSpaces(Array.isArray(spacesResult) ? spacesResult : (spacesResult.spaces ?? []));
      setDocs(Array.isArray(docsResult) ? docsResult : (docsResult.docs ?? []));
    },
    [setDocs, setSpaces],
  );
  useEffect(() => {
    const controller = new AbortController();
    api<{ passwordResetEnabled: boolean }>('/auth/config', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setPasswordResetEnabled(result.passwordResetEnabled);
      })
      .catch(() => undefined);
    api<{ user?: User } | User>('/me', { signal: controller.signal })
      .then((result) => {
        const currentUser = ('user' in result ? result.user : result) as User | undefined;
        if (controller.signal.aborted || !currentUser) return;
        setUser(currentUser);
        setLocale(preferredLocale(currentUser.locale));
        return refreshWorkspace(controller.signal);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && (!(reason instanceof ApiError) || reason.status !== 401))
          setError(errorText(reason, translations.current.t('common.app.unexpected'), translations.current.locale));
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [refreshWorkspace, setError, setLocale, setPasswordResetEnabled, setUser]);
  const refreshAccess = async () => {
    await refreshWorkspace();
    if (!docMeta) return;
    const id = docMeta.id;
    try {
      const result = await api<{ doc: DocMeta }>(`/docs/${encodeURIComponent(id)}`);
      setDocMeta((current) => (current?.id === id ? result.doc : current));
      if (!['owner', 'editor'].includes(result.doc.role)) setEditing(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) {
        window.clearTimeout(saveTimer.current);
        setDirty(false);
        setSaving(false);
        setEditing(false);
        setMembersOpen(false);
        setDocMeta(null);
        setScreen('documents');
        setDraftContent(null);
      } else throw reason;
    }
  };
  const membershipUpdated = () => {
    void refreshAccess().catch((reason) => setError(errorText(reason, t('common.app.unexpected'), model.locale)));
  };
  return {
    message,
    saveDraft,
    goHome,
    refreshWorkspace,
    refreshAccess,
    membershipUpdated,
  };
}
