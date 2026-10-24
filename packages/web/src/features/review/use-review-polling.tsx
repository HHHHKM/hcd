import { useEffect } from 'react';
import type { AiTask } from '../../AiTasks';
import { api, type Conflict } from '../../api';
import { errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { usePanelState } from '../../app/use-panel-state';
import type { useActionState } from '../../app/use-action-state';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  'setBusy' | 'setError' | 'docs' | 'docMeta'
> &
  Pick<ReturnType<typeof usePanelState>, 'preview' | 'previewOpen'> &
  Pick<ReturnType<typeof useActionState>, 'setAiSuggestions' | 't'>;
export function useReviewPolling(model: Input) {
  const { setBusy, setError, docMeta, preview, previewOpen, setAiSuggestions, t } = model;
  const previewId = preview?.id;
  const previewRevision = preview?.revision;
  useEffect(() => {
    setAiSuggestions([]);
    if (!previewOpen || !previewId || !docMeta?.aiEnabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<{ tasks: AiTask[] }>(`/docs/${docMeta.id}/ai-tasks`, { signal: controller.signal });
        if (!controller.signal.aborted)
          setAiSuggestions(
            result.tasks.filter((task) => task.previewId === previewId && task.previewRevision === previewRevision),
          );
      } catch {
        /* Explicit refresh/request actions report errors; background polling remains unobtrusive. */
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void load();
        }, 10000);
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [previewOpen, previewId, previewRevision, docMeta?.id, docMeta?.aiEnabled, setAiSuggestions]);
  const requestAiSuggestion = async (conflict: Conflict) => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ task: AiTask }>(
        `/previews/${preview.id}/conflicts/${encodeURIComponent(conflict.id)}/ai-suggest`,
        { method: 'POST', body: { revision: preview.revision } },
      );
      setAiSuggestions((tasks) => [result.task, ...tasks.filter((task) => task.id !== result.task.id)]);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  return { requestAiSuggestion };
}
