import { canonicalJson, createCounterTmpIdSource, validateDocument, type Document } from './model';
import { diffDocuments } from './diff';
import { applyOpsStrict, type ApplyOpsResult } from './ops';

export class SnapshotConversionError extends Error {
  constructor(readonly code: string, readonly details?: unknown) { super(code); }
}

/** Compatibility boundary for complete JSON snapshots; never silently changes IDs or content. */
export function snapshotToOperations(base: Document, input: unknown): ApplyOpsResult {
  const checked = validateDocument(input);
  if (!checked.ok) throw new SnapshotConversionError('VALIDATION_FAILED', checked.error);
  const target = checked.value;
  if (target.id !== base.id) throw new SnapshotConversionError('DOCUMENT_ID_MISMATCH');
  const preservedIds = new Map<string, string>();
  let operations;
  try {
    operations = diffDocuments(base, target, createCounterTmpIdSource('snapshot'), (original, temporary) => preservedIds.set(temporary, original));
  } catch (error) {
    throw new SnapshotConversionError('SNAPSHOT_NOT_REPRESENTABLE', { reason: error instanceof Error ? error.message : 'DIFF_FAILED' });
  }
  if (operations.length > 500) throw new SnapshotConversionError('TOO_MANY_OPERATIONS', { count: operations.length });
  const applied = applyOpsStrict(base, operations, { next: (_prefix, temporaryId) => preservedIds.get(temporaryId ?? '') ?? '' });
  if (!applied.ok) throw new SnapshotConversionError('SNAPSHOT_NOT_REPRESENTABLE', applied.error);
  if (canonicalJson(applied.value.doc) !== canonicalJson(target)) throw new SnapshotConversionError('SNAPSHOT_NOT_REPRESENTABLE', { reason: 'REPLAY_MISMATCH' });
  return applied.value;
}
