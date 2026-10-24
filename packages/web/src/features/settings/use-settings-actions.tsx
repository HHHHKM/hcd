import { useNavigate } from 'react-router';
import { api, type DocMeta, type PersonalToken, type User } from '../../api';
import { Locale, errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { useDocumentState } from '../document/use-document-state';
import type { useActionState } from '../../app/use-action-state';
import type { useWorkspaceData } from '../../app/use-workspace-data';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  | 'locale'
  | 'setLocale'
  | 'mobileReading'
  | 'user'
  | 'setUser'
  | 'setBusy'
  | 'setError'
  | 'docs'
  | 'docMeta'
  | 'setDocMeta'
  | 'official'
  | 'officialVersion'
> &
  Pick<
    ReturnType<typeof useDocumentState>,
    'draftContent' | 'setDraftContent' | 'changeDraft' | 'setDraftBaseVersion' | 'setDirty' | 'setEditing' | 'setScreen'
  > &
  Pick<
    ReturnType<typeof useActionState>,
    | 'setSettingsOpen'
    | 'tokens'
    | 'setTokens'
    | 'tokenName'
    | 'setTokenName'
    | 'setNewToken'
    | 'tokenScopes'
    | 'settingsTitle'
    | 'setSettingsTitle'
    | 'saveRevision'
    | 't'
  > &
  Pick<ReturnType<typeof useWorkspaceData>, 'message' | 'refreshWorkspace'>;
export function useSettingsActions(model: Input) {
  const {
    locale,
    setLocale,
    mobileReading,
    user,
    setUser,
    setBusy,
    setError,
    docMeta,
    setDocMeta,
    official,
    officialVersion,
    draftContent,
    setDraftContent,
    changeDraft,
    setDraftBaseVersion,
    setDirty,
    setEditing,
    setScreen,
    setSettingsOpen,
    setTokens,
    tokenName,
    setTokenName,
    setNewToken,
    tokenScopes,
    settingsTitle,
    setSettingsTitle,
    saveRevision,
    t,
    message,
    refreshWorkspace,
  } = model;
  const changeLocale = async () => {
    const nextLocale: Locale = locale === 'zh-CN' ? 'en' : 'zh-CN';
    try {
      if (user) {
        const result = await api<{ user: User }>('/me', {
          method: 'PATCH',
          body: { locale: nextLocale },
        });
        setUser(result.user);
      }
      setLocale(nextLocale);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    }
  };
  const navigate = useNavigate();
  const openSettings = async (updateUrl = true) => {
    if (updateUrl) {
      navigate('/settings');
      return;
    }
    setSettingsOpen(true);
    setNewToken('');
    setError('');
    setSettingsTitle(docMeta?.title ?? '');
    try {
      const result = await api<{ tokens: PersonalToken[] }>('/me/tokens');
      setTokens(result.tokens);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    }
  };
  const toggleAi = async () => {
    if (!docMeta || docMeta.role !== 'owner') return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ doc: DocMeta }>(`/docs/${encodeURIComponent(docMeta.id)}`, {
        method: 'PATCH',
        body: { aiEnabled: !docMeta.aiEnabled },
      });
      setDocMeta(result.doc);
      await refreshWorkspace();
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const saveTitle = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!docMeta || !official || !settingsTitle.trim() || mobileReading) return;
    if (!draftContent) {
      setDraftContent(official);
      setDraftBaseVersion(officialVersion);
    }
    const title = settingsTitle.trim();
    changeDraft((content) => ({ ...content, title }));
    saveRevision.current += 1;
    setDirty(true);
    setEditing(true);
    setScreen('document');
    setSettingsOpen(false);
    navigate(`/d/${encodeURIComponent(docMeta.id)}?edit=1`);
    message(t('common.app.titleAddedToYourDraftForReview'));
  };
  const createToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tokenName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ token: string; meta: PersonalToken }>('/me/tokens', {
        method: 'POST',
        body: { name: tokenName.trim(), scopes: tokenScopes },
      });
      setNewToken(result.token);
      setTokenName('');
      const list = await api<{ tokens: PersonalToken[] }>('/me/tokens');
      setTokens(list.tokens);
      message(t('common.app.tokenCreated'));
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const revokeToken = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`/me/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const result = await api<{ tokens: PersonalToken[] }>('/me/tokens');
      setTokens(result.tokens);
      message(t('common.app.tokenRevoked'));
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  return {
    changeLocale,
    openSettings,
    toggleAi,
    saveTitle,
    createToken,
    revokeToken,
  };
}
