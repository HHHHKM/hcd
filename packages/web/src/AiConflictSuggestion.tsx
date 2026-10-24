import { translate } from './shared/i18n';
import type { AiTask } from './AiTasks';
import { plainValue } from './api';
export default function AiConflictSuggestion({
  task,
  enabled,
  busy,
  locale,
  onRequest,
  onAdopt,
}: {
  task?: AiTask;
  enabled: boolean;
  busy: boolean;
  locale: 'zh-CN' | 'en';
  onRequest: () => void;
  onAdopt: (taskId: string) => void;
}) {
  return (
    <div className="ai-conflict-suggestion">
      {task?.status === 'done' && task.result && Object.hasOwn(task.result, 'value') ? (
        <>
          <strong>{translate(locale, 'ai.aiSuggestion')}</strong>
          <p>{plainValue(task.result.value)}</p>
          <p className="settings-muted">{task.result.rationale}</p>
          <button className="button button-soft" disabled={busy} onClick={() => onAdopt(task.id)}>
            {translate(locale, 'ai.useThisSuggestion')}
          </button>
        </>
      ) : task && ['approved', 'claimed'].includes(task.status) ? (
        <p role="status">
          {task.status === 'approved'
            ? translate(locale, 'ai.waitingForAnAuthorizedAiToClaimThisTask')
            : translate(locale, 'ai.aiIsPreparingASuggestion')}
        </p>
      ) : (
        <button className="button button-soft" disabled={busy || !enabled} onClick={onRequest}>
          {translate(locale, 'ai.askAiForASuggestion')}
        </button>
      )}
      <small>{translate(locale, 'ai.aiCanReadThisConflictAndItsContextAdoption')}</small>
    </div>
  );
}
