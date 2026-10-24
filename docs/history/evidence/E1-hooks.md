# E1 hooks dependency repair

Only `AuthLink.tsx`, `SpaceIntegrations.tsx`, and the new
`E1-hook-dependencies.test.tsx` changed for this subtask. No existing assertion changed.

## Before the repair

- `pnpm exec eslint packages/web/src/AuthLink.tsx packages/web/src/SpaceIntegrations.tsx --max-warnings 0`
  exited 1 with the two specified `react-hooks/exhaustive-deps` warnings. See
  `E1-hooks-eslint-red.log`.
- The new integration DOM test failed before production edits: after switching from English
  to Chinese while its only GET was pending, the late error still appeared in English.
  See `E1-hooks-red.log` (1 test, 1 failed).

## Changes

- AuthLink's title/language effect includes its `t` dependency. Its separate token-read
  effect retains its original token/kind/retry dependencies, so changing language does not
  recheck the token. This was a lint defect; the existing locale dependency already made
  ordinary title switches correct. No artificial behavior failure is claimed for it.
- SpaceIntegrations' `report` uses `useCallback` with stable state setter dependencies,
  and the read effect includes `report`. Errors retain a translation key and translate at
  render time, so pending and settled failures follow the currently displayed language.
  Changing language does not restart the GET. No effect dependency was suppressed.
- New public DOM/fetch boundary regressions cover late and settled integration errors,
  email-link document titles/language changes, and exactly one GET across those rerenders.

## Results

- Initial focused green after minimal integration repair: 1/1 test passed
  (`E1-hooks-first-green.log`).
- Final focused command:
  `pnpm exec vitest run packages/web/src/E1-hook-dependencies.test.tsx packages/web/src/Administration-i18n.test.tsx packages/web/src/ShareLinks-i18n.test.tsx packages/web/src/CliAuth.test.tsx`.
  21/21 tests across 4 files passed (`E1-hooks-green.log`).
- Targeted production ESLint command above exited 0 with no output: 0 errors, 0 warnings
  (`E1-hooks-eslint-green.log`).
- `pnpm typecheck` exited 0 (`E1-hooks-typecheck.log`).
- A prior targeted command also named the new test file; the repository intentionally
  ignores tests in ESLint, causing an ignored-file warning. That attempt is retained in
  `E1-hooks-eslint-test-ignore.log`, separate from the successful production lint command.
- Full phase verify and `UI_REPORT.md` are owned by the main task, not this subtask.
