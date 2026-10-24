# Root-level web formatting handoff

Only `packages/web/src/*.{ts,tsx,css}` and `packages/web/src/test-fixtures/*.{ts,tsx}` were formatted. No `app/`, `features/`, `shared/` or nested styles were edited by this formatting task. No tests were added, and no existing assertion expression was changed.

- 84 root/test-fixture files snapshotted; 57 differ after formatting (includes the independently owned concurrent VersionComparison scalar-dependency fix). Full list with final line counts and widths: `outputs/C-root-format-files.json`.
- Root TS/TSX/CSS files: 82. Every root file has at most 400 lines and 120 characters per line; there are no remaining long-line exceptions.
- Long production lines repaired without behavior changes: AiTasks middle-dot JSX text was made explicit; DiscussionThreads URL template was split into concatenation.
- Existing test-only long lines use concatenation with unchanged resulting text: App-comment-selection (3 test titles), CliAuth (1 title), DiscussionThreads-menu (1 title), SharedDocument (1 title), VersionComparison (1 title), comment-location (HTML fixture), comment-selection-dom (6 HTML fixtures), reading-layout (2 HTML fixtures).
- Prettier check passes for all scoped files.
- TypeScript AST comparison before/after: all 616 existing expect/matcher expressions are identical after ignoring formatting and parentheses. The initial comparison used punctuation children and incorrectly flagged trailing commas; a corrected AST-child comparison found zero changed expressions.

## Actual targeted validation

`outputs/C-root-format-tests.log`: 72 tests / 8 files; 68 passed and 4 failed (3 failed files).

- VersionComparison: the old assertion expects `Created by: u_owner`, while B1 now correctly renders missing author names as `Unknown user`. Left unchanged and reported to root.
- App-comment-selection: the old phone review visibility assertion receives `undefined` for the queried control. Left unchanged and reported to root.
- reading-layout: both C7/C8 tests fail at Chrome launch under the restricted sandbox; no layout assertion was reached. Left unchanged and reported to root.

This targeted run does not constitute phase C verify or phase D browser acceptance. Root owns the full gate. Formatting changes are complete and this agent has paused writes.
