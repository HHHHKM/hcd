import { toChanges, compareDocumentChanges, type ChangeSet } from '../../core/src/changes';
import { snapshotToOperations, SnapshotConversionError } from '../../core/src/snapshot-ops';
import { markUncertainOperations } from '../../core/src/reconcile';
import type { Document } from '../../core/src/model';
import type { Op } from '../../core/src/ops';
import type { MergeItem } from '../../core/src/merge';
import type { HcdDatabase } from './db';

import type { CandidateEffect, ProposedChanges, ReviewPresentation } from '../../core/src/review-types';

export function submissionChanges(base: Document, content: Document, operations: string | null, uncertainIds: string | null): ChangeSet {
  try {
    let ops: Op[] = operations ? JSON.parse(operations) as Op[] : snapshotToOperations(base, content).ops;
    if (!operations && uncertainIds) ops = markUncertainOperations(ops, new Set(JSON.parse(uncertainIds) as string[]));
    return { changes: toChanges(base, content, ops) };
  } catch (error) {
    if (error instanceof SnapshotConversionError) return { changes: [], unavailable: error.code };
    // Presentation failure must not erase a submission or misreport it as unchanged.
    return { changes: [], unavailable: error instanceof Error && /^DISPLAY_[A-Z_]+$/.test(error.message) ? error.message : 'CHANGE_PRESENTATION_UNAVAILABLE' };
  }
}
export type PresentationItem = Omit<MergeItem, 'ops'> & { ops?: MergeItem['ops'] };
export type PresentationConflict = { id: string; resolution?: { choice: string } };
export type ReviewPresentationInput = {
  baseVersion: number; current: string; candidate: string; conflicts: PresentationConflict[];
  submissions: Array<{ item: PresentationItem; base: string | null; content: string; operations: string | null; uncertainIds: string | null; message: string; authorName: string; baseVersion: number }>;
};

// Capture only immutable inputs while the caller still owns its transaction.
// The worker never receives a database handle or performs authorization/writes.
export function captureReviewPresentation(db: HcdDatabase, docId: string, baseVersion: number, current: Document, candidate: Document, items: PresentationItem[], conflicts: PresentationConflict[]): ReviewPresentationInput {
  return {
    baseVersion, current: JSON.stringify(current), candidate: JSON.stringify(candidate), conflicts,
    submissions: items.map(item => {
      const row = db.prepare('SELECT s.*,u.name author FROM submissions s JOIN users u ON u.id=s.author_id WHERE s.id=? AND s.doc_id=?').get(item.submissionId, docId) as { base_version: number; content: string; operations: string | null; uncertain_ids: string | null; message: string; author: string };
      const base = db.prepare('SELECT content FROM versions WHERE doc_id=? AND version=?').get(docId, row.base_version) as { content: string } | undefined;
      return { item, base: base?.content ?? null, content: row.content, operations: row.operations, uncertainIds: row.uncertain_ids, message: row.message, authorName: row.author, baseVersion: row.base_version };
    }),
  };
}

export function renderReviewPresentation(input: ReviewPresentationInput): ReviewPresentation {
  const candidateChanges = compareDocumentChanges(JSON.parse(input.current) as Document, JSON.parse(input.candidate) as Document);
  let remainingBytes = 16 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(candidateChanges));
  const proposed = input.submissions.map((row): ProposedChanges => {
    const item = row.item;
    let changeSet: ChangeSet = remainingBytes <= 0 ? { changes: [], unavailable: 'DISPLAY_TOO_LARGE' } : row.base ? submissionChanges(JSON.parse(row.base) as Document, JSON.parse(row.content) as Document, row.operations, row.uncertainIds) : { changes: [], unavailable: 'BASE_VERSION_NOT_FOUND' };
    const size = Buffer.byteLength(JSON.stringify(changeSet));
    remainingBytes -= size;
    if (remainingBytes < 0) changeSet = { changes: [], unavailable: 'DISPLAY_TOO_LARGE' };
    const candidateEffect: CandidateEffect = item.status === 'needs_resolution' ? 'excluded_unresolved' : item.status === 'excluded' ? 'excluded' : input.conflicts.some(conflict => item.conflictIds.includes(conflict.id) && /:(document|snapshot)$/.test(conflict.id) && conflict.resolution?.choice === 'drop') ? 'excluded_document_drop' : 'evaluated';
    return { submissionId: item.submissionId, message: row.message, authorName: row.authorName, baseVersion: row.baseVersion, status: item.status, candidateEffect, operations: item.ops ?? [], changeSet: { ...changeSet, changes: changeSet.changes.map(change => ({ ...change, sources: [item.submissionId] })) } };
  });
  return { version: 1, baseVersion: input.baseVersion, proposed, candidate: candidateChanges };
}
