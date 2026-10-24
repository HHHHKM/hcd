# E5 migration log

E4 gate complete. Only owner CSS is changed; existing assertions and visual baselines remain frozen. Start CSS total: 9161 lines. Every region requires build + complete visual test; no snapshot updates.

## 01 dark titles/forms

12 explicit operations; original dark values corrected or redundant dark members removed, two reconciliation rules removed. Build exit 0; complete visual 34 passed, exit 0. Original baseline unchanged. Evidence: E5-01-build.log / E5-01-visual.log / E5-01-visual-results.json.

## 02 dark surfaces/badge — rolled back

Apply/build succeeded, but complete visual gate exit 1: 31 passed and 3 failed in E4 ui-surfaces.visual.ts snapshots (OAuth 1440 light; notification-empty 390 light/dark). Immediately restored full helper backup; no baseline updates. This region is not accepted. Evidence: E5-02-visual.log, E5-02-rollback.json.

## 02 02-dark-surfaces-badge

Retry after fixture-only readiness/OAuth identity stabilization: full 34 visual cases passed; original 176 baselines unchanged.

9 explicit operations. Build exit 0; complete visual 34 passed, 0 skipped/unexpected/flaky. Frozen 176 baseline SHA mismatches: 0. Evidence E5-02-build.log / E5-02-visual.log / E5-02-visual-results.json.

## 03 editor: failed and restored

Build exit0; complete visual32 passed /2 failed. Lost contextual title scope allowed the generic TextField rule to reduce title height by20px; complete7file backup immediately restored. Diagnosis: E5-03-diagnosis.md. The retry manifest preserves original scope and was previewed only.

## E5 pause for E4 follow-up

All accepted01+02 production changes restored in reverse from complete backups under root instruction. E5-paused-for-E4-followup.json records SHA before/after. Historical passes remain evidence only; all regions must be rerun after the corrected E4 gate.
