import { translate, formatDate } from './shared/i18n';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Module } from '../../core/src/model';
export type AiTask = {
  id: string;
  status: string;
  kind: string;
  instruction: string;
  moduleIds: string[];
  requestedBy: string;
  attempts: number;
  claimedBy?: string;
  claimExpiresAt?: string;
  baseVersion?: number;
  lastError?: string;
  result?: { submissionId?: string; reason?: string; value?: unknown; rationale?: string };
  previewRevision?: number;
  previewId?: string;
  conflictId?: string;
  updatedAt: string;
};
const labels: Record<string, string> = {
  requested: 'ai.aiTasksCatalog.labels.requested',
  approved: 'ai.aiTasksCatalog.labels.approved',
  claimed: 'ai.aiTasksCatalog.labels.claimed',
  done: 'ai.aiTasksCatalog.labels.done',
  failed: 'ai.aiTasksCatalog.labels.failed',
  rejected: 'ai.aiTasksCatalog.labels.rejected',
  cancelled: 'ai.aiTasksCatalog.labels.cancelled',
};
export default function AiTasks({
  docId,
  userId,
  role,
  modules,
  locale,
  aiEnabled,
  onClose,
  onReview,
  onSubmission,
}: {
  docId: string;
  userId: string;
  role: string;
  modules: Module[];
  locale: 'zh-CN' | 'en';
  aiEnabled: boolean;
  onClose: () => void;
  onReview: () => void;
  onSubmission: (id: string) => void;
}) {
  const canApprove = ['owner', 'editor'].includes(role);
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [filter, setFilter] = useState('all');
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<{ tasks: AiTask[] }>(`/docs/${docId}/ai-tasks`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setTasks(result.tasks);
          setLoaded(true);
        }
      } catch {
        if (!controller.signal.aborted) setError(translate(locale, 'ai.couldNotLoadTasksRefreshToTryAgain'));
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void load();
        }, 15000);
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [docId, refresh, locale]);
  const act = async (task: AiTask, action: string) => {
    setBusy(task.id);
    setError('');
    try {
      await api(`/ai-tasks/${task.id}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? { reason: reason.trim() } : {},
      });
      setConfirm(null);
      setReason('');
      setRefresh((value) => value + 1);
    } catch (problem) {
      setError(
        problem instanceof ApiError && problem.code === 'TASK_STATE_CONFLICT'
          ? translate(locale, 'errors.TASK_STATE_CONFLICT')
          : translate(locale, 'ai.actionFailedCheckYourAccessAndRetry'),
      );
      setRefresh((value) => value + 1);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="overlay">
      <section className="review-modal ai-task-modal" role="dialog" aria-modal="true" aria-labelledby="ai-task-title">
        <div className="modal-top">
          <div>
            <div className="modal-eyebrow">HCD / AI</div>
            <h2 id="ai-task-title">{translate(locale, 'ai.aiTasks')}</h2>
            <p>{translate(locale, 'ai.mentionAiInAModuleCommentToRequestHelp')}</p>
          </div>
          <button className="modal-close" aria-label={translate(locale, 'ai.close')} onClick={onClose}>
            ×
          </button>
        </div>
        {!aiEnabled && (
          <p className="settings-muted">{translate(locale, 'ai.aiIsDisabledForThisDocumentTasksCannotBe')}</p>
        )}
        <div className="ai-task-toolbar">
          <label>
            {translate(locale, 'ai.status')}
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">{translate(locale, 'ai.all')}</option>
              {Object.entries(labels).map(([value, names]) => (
                <option value={value} key={value}>
                  {translate(locale, names)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-soft"
            onClick={() => {
              setError('');
              setRefresh((value) => value + 1);
            }}
          >
            {translate(locale, 'ai.refresh')}
          </button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="ai-task-list">
          {!loaded ? (
            <p role="status">{translate(locale, 'ai.loading')}</p>
          ) : tasks.filter((task) => filter === 'all' || task.status === filter).length === 0 ? (
            <p className="settings-muted">{translate(locale, 'ai.noMatchingTasks')}</p>
          ) : (
            tasks
              .filter((task) => filter === 'all' || task.status === filter)
              .map((task) => {
                const moduleNames = task.moduleIds
                  .map(
                    (id) => modules.find((module) => module.id === id)?.title || translate(locale, 'ai.deletedModule'),
                  )
                  .join('、');
                return (
                  <article className="ai-task-card" key={task.id}>
                    <div className="ai-task-heading">
                      <strong>{translate(locale, labels[task.status] ?? task.status)}</strong>
                      <small>
                        {task.kind === 'resolve'
                          ? translate(locale, 'ai.conflictSuggestion')
                          : translate(locale, 'ai.contentEdit')}
                      </small>
                    </div>
                    <p>{task.instruction}</p>
                    <small>
                      {moduleNames || translate(locale, 'ai.documentConflict')}
                      {' · '}
                      {translate(locale, 'ai.attempts')} {task.attempts}/3
                      {task.baseVersion ? ` · v${task.baseVersion}` : ''}
                    </small>
                    {task.status === 'claimed' && task.claimExpiresAt && (
                      <p className="settings-muted">
                        {translate(locale, 'ai.claimExpires')}
                        {formatDate(task.claimExpiresAt, locale)}
                      </p>
                    )}
                    {(task.lastError || task.result?.reason) && (
                      <p className="settings-muted">
                        {task.lastError === 'CLAIM_EXPIRED'
                          ? translate(locale, 'ai.thePreviousClaimExpired')
                          : task.lastError || task.result?.reason}
                      </p>
                    )}
                    {task.result?.submissionId && (
                      <p>
                        {translate(locale, 'ai.aSubmissionIsReadyForHumanReview')}{' '}
                        <button className="button button-soft" onClick={() => onSubmission(task.result!.submissionId!)}>
                          {translate(locale, 'ai.viewSubmission')}
                        </button>{' '}
                        {role === 'owner' && (
                          <button
                            className="button button-soft"
                            onClick={() => {
                              onClose();
                              onReview();
                            }}
                          >
                            {translate(locale, 'ai.openReviewQueue')}
                          </button>
                        )}
                      </p>
                    )}
                    {confirm?.id === task.id ? (
                      <div className="ai-task-confirm">
                        {confirm.action === 'approve' ? (
                          <p>
                            {translate(locale, 'ai.approvalAllowsAnAuthorizedAiToReadAndPropose', {
                              value1: moduleNames,
                            })}
                          </p>
                        ) : (
                          <label>
                            {translate(locale, 'ai.reasonForRejection')}
                            <textarea
                              maxLength={500}
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                              required
                            />
                          </label>
                        )}
                        <div className="conflict-actions">
                          <button
                            disabled={Boolean(busy) || (confirm.action === 'reject' && !reason.trim())}
                            onClick={() => act(task, confirm.action)}
                          >
                            {translate(locale, 'ai.confirm')}
                          </button>
                          <button
                            disabled={Boolean(busy)}
                            onClick={() => {
                              setConfirm(null);
                              setReason('');
                            }}
                          >
                            {translate(locale, 'ai.back')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="conflict-actions">
                        {task.status === 'requested' && canApprove && (
                          <>
                            <button
                              disabled={Boolean(busy) || !aiEnabled}
                              onClick={() => setConfirm({ id: task.id, action: 'approve' })}
                            >
                              {translate(locale, 'ai.approve')}
                            </button>
                            <button
                              disabled={Boolean(busy)}
                              onClick={() => setConfirm({ id: task.id, action: 'reject' })}
                            >
                              {translate(locale, 'ai.reject')}
                            </button>
                          </>
                        )}
                        {['requested', 'approved'].includes(task.status) &&
                          (canApprove || task.requestedBy === userId) && (
                            <button disabled={Boolean(busy)} onClick={() => act(task, 'cancel')}>
                              {translate(locale, 'ai.cancelTask')}
                            </button>
                          )}
                      </div>
                    )}
                  </article>
                );
              })
          )}
        </div>
        <div className="modal-footer">
          <small>{translate(locale, 'ai.showingUpTo200RecentTasksRefreshesEvery15')}</small>
          <button className="button button-soft" onClick={onClose}>
            {translate(locale, 'ai.close')}
          </button>
        </div>
      </section>
    </div>
  );
}
