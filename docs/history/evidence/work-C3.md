# C3 internationalization and supporting C1 splits

2026-10-24. Source root: `source/`.

## Completed behavior

- Added `packages/web/src/shared/i18n.ts`, using both i18next and react-i18next. Resources are bundled locally, without a translation backend or network service.
- Added matching `locales/en.json` and `locales/zh-CN.json`: **972 leaf keys** in the 16 required namespaces. Keys use English dot notation; server error-code translations use `errors.<CODE>`.
- API: `useLocaleTranslation(locale)` returns a stable fixed-language `t(key, values)` function; `getLocaleTranslation(locale)` is available outside components, and `translate(locale, key, values)` supports existing locale-prop components. Translators are cached by locale so effects can safely depend on `t`. Independent English/Chinese renderers remain independent of the global i18next language.
- Added account-first `preferredLocale` and browser-prefix normalization. The workspace agent integrates this into the main application. CLI consent uses the returned account locale unless the user explicitly chose a language, and persists explicit choices through `PATCH /me`. OAuth consent reads the authenticated preference from `/me` and persists explicit choices. Guest/auth pages start from browser language and can switch locally.
- Migrated all existing App-external bilingual choices, two-argument helpers, locale-indexed arrays and inline dictionaries to resources. The main App agent supplied and migrated 216 App keys; the comments/toolbar agent supplied their own keys. Both mappings have been merged into the shared dictionaries. No old UI Chinese remains outside resources in the migrated components.
- Added Intl helpers for date, number and relative-time formatting. Migrated date displays to the shared DateTimeFormat helper; numeric interpolation uses Intl.NumberFormat. Existing direct Intl use remains valid.
- Preserved existing locale props and public component exports so old assertions/imports stay intact.

## Additional C1 structure work

To keep formatted code files below 400 lines, split these two previously oversized components while preserving their public entry exports:

- `CliAuth.tsx` (132 lines) → `features/auth/CliAuthPanels.tsx` (328) and `features/auth/cli-auth-api.ts` (138).
- `Administration.tsx` → `features/admin/AdministrationPanel.tsx` (273), `MembersPanel.tsx` (221), `admin-shared.tsx` (74).

Counts reflect this agent's prettier 120-column output before the root's final formatting pass. BlockEditor and SharedDocument were released to the C5/C6 agent for analogous structural splits; VersionComparison was released to the C1/C2 agent for routing integration.

## Test-first evidence and verification

- `outputs/C3-red.log`: **2 failing tests / 1 file** before resources or migration: missing dictionaries, and existing inline bilingual UI choices.
- New regression test names:
  - `C3 AT-15 bundles matching English and Chinese dictionaries with every specified namespace`
  - `C3 AT-15 uses existing dot-separated translation keys and removes inline bilingual choices`
  - `C3 AT-15 prefers the account locale and keeps independent renderers in their requested language`
  - `C3 AT-15 keeps the bilingual fallback for a notification kind introduced by a newer server`
  - `C3 AT-15 translates administrator error codes without exposing or truncating their keys`
- Migration review found two tuple-index fallbacks that needed special handling. Both received real regression failures before repair: `C3-admin-error-red.log` (expected full administrator error, received `r`) and `C3-notification-red.log` (unknown notification lost its fallback). Their new tests remain in the suite.
- Final focused command: `pnpm exec vitest run packages/web/src/i18n.test.ts packages/web/src/Administration-i18n.test.tsx packages/web/src/CliAuth.test.tsx packages/web/src/App-account-settings.test.tsx packages/web/src/PasswordSettings.test.tsx packages/web/src/LogoutAllSessions.test.tsx packages/web/src/ChangeList.test.tsx packages/web/src/BlockEditor.test.tsx packages/web/src/SharedDocument.test.tsx`.
- `outputs/C3-green.log`: **59 passed tests / 9 files**.
- `outputs/C3-typecheck-final.log`: `pnpm typecheck` passed.
- `outputs/C3-lint.log`: targeted ESLint passed with no warnings/errors (production files only; test fixtures are deliberately excluded by the repository lint configuration).
- Existing test assertions were not changed. Structural splits preserve old import paths through re-exports, so no old test wrapping/import change was necessary.
- Full phase C `pnpm verify` and browser acceptance remain the root agent's stage responsibilities; this report does not represent those as executed.

## Changed areas

Core/resources/new tests above, plus locale text migration in Administration, AiConflictSuggestion, AiTasks, AuthLink, BlockEditor, ChangeList, CliAuth, ConflictPlacement, DocumentAssets, DocumentEditor, EditorFields, ExportPanel, ForgotPassword, GuestVerification, ImportArchive, LogoutAllSessions, NotificationBell, NotificationPreferences, OAuthConsent, PasswordSettings, ReviewChanges, SelectionComment, ShareLinks, SharedDocument, SpaceIntegrations, SubmissionDetails, VersionComparison and editor-model. Main App and DiscussionThreads/DocumentToolbar migrations were performed by their owning agents and merged through the shared resources.

## Final error-code follow-up

- Found and repaired two remaining raw API-message paths: the main workspace's shared `errorText` and the share-link dialog's private error helper. Known codes resolve through `errors.<CODE>` in the explicitly requested locale; unknown codes and non-API/network errors use the caller's local translated fallback. The share-link SMTP configuration instruction remains its existing specific translated message.
- Added `translateErrorCode(locale, code, fallback)` without a dependency on the global language. Updated all 27 workspace callers to pass their current `locale`; this includes app data, document navigation/drafts, imports, review actions/polling, comments and settings. No route behavior was changed by this follow-up.
- New tests:
  - `C3 AT-15 translates server error codes in the requested interface language`
  - `C3 AT-15 uses a local fallback for unknown server codes and network errors`
  - `C3 AT-15 localizes share-link API errors for $locale and $code` (3 UI cases: Chinese/English rate limit and Chinese unknown-code fallback).
- `outputs/C3-error-code-red.log`: **2 failing tests / 1 file** before the workspace helper fix. `outputs/C3-error-code-green.log`: **6 passing tests / 2 files**.
- `outputs/C3-share-error-red.log`: **3 failing tests / 1 file** against the pre-repair share-link helper. All three rendered the raw server message.
- Final focused command: `pnpm exec vitest run packages/web/src/ShareLinks-i18n.test.tsx packages/web/src/app/error-translation.test.ts packages/web/src/i18n.test.ts packages/web/src/Administration-i18n.test.tsx`.
- `outputs/C3-error-code-final-green.log`: **10 passed tests / 4 files**. `outputs/C3-error-code-final-typecheck.log`: typecheck passed. ESLint for ShareLinks/shared i18n/workspace helper and `node scripts/security-check.mjs` passed.
- Corrected the new administrator regression's cleanup to `document.body.replaceChildren()` because the repository security scan also scans `.test.tsx`. This is a new-test cleanup change, without any assertion change.

## Process notes and existing-test changes

- No pre-existing test assertion, import or render wrapper was changed by this agent's C3 work. Public re-export entry points preserved old imports through the component splits.
- The newly authored share-link unknown-error case initially used `请求失败，请重试。`, while the existing approved fallback text is `操作失败，请重试。`. That mistaken new expectation was corrected to the existing dictionary text; the pre-repair implementation was restored and all 3 final test cases were rerun red before applying the fix again. Both the initial red log (`C3-share-error-red-initial.log`) and failed interim run (`C3-share-error-fixture-correction.log`) are retained for transparency. No existing assertion was weakened to make a repair pass.
- No C3 browser acceptance was executed by this agent. No phase D work was started. The root agent owns the phase C full `pnpm verify` gate and phase D acceptance/packaging.
