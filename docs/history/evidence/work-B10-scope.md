# B10 scope preservation follow-up

2026-10-24, code root `source/`.

## Finding and minimal change

Removing `list_documents` per-document reads also removed their inherited document-read scope guard. An `ai_tasks`-only token could therefore list titles. The existing smallest fix adds one scope guard to `GET /api/v1/docs`: tokens must have at least one of `read`, `comment`, `submit`, or `preview`, matching the existing document read implication rules. The existing document selection and AI-enabled filters remain authoritative. Cookie access is unaffected.

Changed source: `packages/server/src/app.ts` (`GET /docs` guard only for this follow-up).
New test: `packages/server/test/mcp-list-scope.test.ts`, `B10 preserves document-read scope checks when listing documents without per-document reads`.

## Red / green evidence

- Genuine pre-fix evidence is retained in `outputs/B10-scope-red.log`: 1 failed test / 1 file; `ai_tasks`-only MCP list incorrectly returned `isError: false` (expected `true`).
- Existing `outputs/B10-scope-green.log`: scope test plus MCP regressions, 10 passed tests / 2 files.
- Re-ran those tests in this follow-up: 10 passed tests / 2 files.
- Requested `token-access.test.ts` does not exist in this snapshot. Existing permission tests are in `app.test.ts` and `oauth.test.ts`; these and `oauth-client.test.ts` were included in a final regression run already in flight when the instruction arrived to avoid extra reruns. Result: **42 passed tests / 5 files**, exit code 0. Exact command and output: `outputs/B10-scope-regression.log`.
- Command: `pnpm exec vitest run packages/server/test/mcp-list-scope.test.ts packages/server/test/mcp.test.ts packages/server/test/oauth-client.test.ts packages/server/test/oauth.test.ts packages/server/test/app.test.ts`.

No old test assertions were modified. No additional source changes were needed in this follow-up; the previous agent's minimal guard was reviewed and confirmed. No B4 or C files were changed. Full phase B verify remains the root agent's responsibility.
