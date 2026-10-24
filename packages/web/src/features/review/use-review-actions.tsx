import { useNavigate } from 'react-router';
import type { ParentRef } from '../../../../core/src/ops';
import { api, ApiError, type Conflict, type Preview } from '../../api';
import { textToInline, errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { usePanelState } from '../../app/use-panel-state';
import type { useActionState } from '../../app/use-action-state';
import type { useWorkspaceData } from '../../app/use-workspace-data';
import type { useDocumentNavigation } from '../document/use-document-navigation';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  'mobileReading' | 'setBusy' | 'setError' | 'docs' | 'docMeta'
> &
  Pick<
    ReturnType<typeof usePanelState>,
    'selectedSubmissions' | 'preview' | 'setPreview' | 'setPreviewKind' | 'setPreviewOpen' | 'manualValues'
  > &
  Pick<ReturnType<typeof useActionState>, 't'> &
  Pick<ReturnType<typeof useWorkspaceData>, 'message' | 'refreshWorkspace'> &
  Pick<ReturnType<typeof useDocumentNavigation>, 'loadDocument'>;
export function useReviewActions(model: Input) {
  const {
    mobileReading,
    setBusy,
    setError,
    docMeta,
    selectedSubmissions,
    preview,
    setPreview,
    setPreviewKind,
    setPreviewOpen,
    manualValues,
    t,
    message,
    refreshWorkspace,
    loadDocument,
  } = model;
  const navigate = useNavigate();
  const createPreview = async () => {
    if (!docMeta || selectedSubmissions.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ preview: Preview }>(`/docs/${encodeURIComponent(docMeta.id)}/previews`, {
        method: 'POST',
        body: { submissionIds: selectedSubmissions },
      });
      setPreviewKind('merge');
      setPreview(result.preview);
      navigate(`/d/${encodeURIComponent(docMeta.id)}/review/${encodeURIComponent(result.preview.id)}`);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const resolveConflict = async (
    conflict: Conflict,
    choice:
      | 'keep_current'
      | 'take_incoming'
      | 'manual'
      | 'ai'
      | 'accept'
      | 'drop'
      | 'append_end'
      | 'place'
      | 'restore_and_apply',
    taskId?: string,
    placement?: { parent: ParentRef; after: string | null },
  ) => {
    if (!preview) return;
    setBusy(true);
    setError('');
    const typedValue = manualValues[conflict.id] ?? '';
    const isInlineValue = (candidate: unknown) =>
      Array.isArray(candidate) &&
      candidate.every((item) => item && typeof item === 'object' && ('t' in item || 'br' in item));
    const currentIsInline = isInlineValue(conflict.current) || isInlineValue(conflict.incoming);
    const value = currentIsInline ? textToInline(typedValue) : typedValue;
    try {
      const result = await api<{ preview: Preview }>(`/previews/${encodeURIComponent(preview.id)}/resolutions`, {
        method: 'POST',
        body: {
          revision: preview.revision,
          conflictId: conflict.id,
          choice,
          ...(choice === 'manual' ? { value } : {}),
          ...(choice === 'ai' ? { taskId } : {}),
          ...(choice === 'place' ? placement : {}),
        },
      });
      setPreview(result.preview);
    } catch (reason) {
      setError(
        reason instanceof ApiError && ['PREVIEW_STALE', 'PREVIEW_REVISION_STALE'].includes(reason.code)
          ? t('common.app.thisSuggestionOrPreviewIsStaleBuild')
          : errorText(reason, t('common.app.unexpected'), model.locale),
      );
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!preview || !docMeta || mobileReading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/previews/${encodeURIComponent(preview.id)}/publish`, {
        method: 'POST',
        body: { revision: preview.revision },
      });
      setPreviewOpen(false);
      setPreview(null);
      await loadDocument(docMeta.id);
      await refreshWorkspace();
      message(t('common.app.newVersionPublished'));
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const restoreVersion = async (version: number) => {
    if (!docMeta || mobileReading) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ preview: Preview }>(`/docs/${encodeURIComponent(docMeta.id)}/restore`, {
        method: 'POST',
        body: { version },
      });
      setPreviewKind('restore');
      setPreview(result.preview);
      setPreviewOpen(true);
      navigate(`/d/${encodeURIComponent(docMeta.id)}/review/${encodeURIComponent(result.preview.id)}`);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  return { createPreview, resolveConflict, publish, restoreVersion };
}
