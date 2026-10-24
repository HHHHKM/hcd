import type { ChangeSet } from './changes';
import type { MergeItem } from './merge';

export type CandidateEffect = 'evaluated' | 'excluded_unresolved' | 'excluded_document_drop' | 'excluded';
export type ProposedChanges = {
  submissionId: string; message: string; authorName: string; baseVersion: number;
  status: MergeItem['status']; candidateEffect: CandidateEffect;
  operations: MergeItem['ops']; changeSet: ChangeSet;
};
export type ReviewPresentation = {
  version: 1; baseVersion: number; proposed: ProposedChanges[]; candidate: ChangeSet;
};
