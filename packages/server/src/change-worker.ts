import { parentPort } from 'node:worker_threads';
import { compareDocumentChanges } from '../../core/src/changes';
import type { Document } from '../../core/src/model';
import { renderReviewPresentation, type ReviewPresentationInput } from './change-presentation';
import { diffValues } from './legacy-diff';

export type ChangeWorkerTask =
  | { kind: 'compare'; before: string; after: string; from: number; to: number }
  | { kind: 'review'; input: ReviewPresentationInput };

parentPort!.on('message', ({ id, task }: { id: number; task: ChangeWorkerTask }) => {
  try {
    if (task.kind === 'review') {
      parentPort!.postMessage({ id, result: JSON.stringify(renderReviewPresentation(task.input)) });
      return;
    }
    const before = JSON.parse(task.before) as Document;
    const after = JSON.parse(task.after) as Document;
    const result = JSON.stringify({ changes: diffValues(before, after), changeSet: compareDocumentChanges(before, after), from: task.from, to: task.to });
    parentPort!.postMessage({ id, result });
  } catch {
    parentPort!.postMessage({ id, error: 'CHANGE_PRESENTATION_UNAVAILABLE' });
  }
});
