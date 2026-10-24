# C5 / C6 implementation record

- Scope: C5 grouped document toolbar; C6 comment action hierarchy and inline deletion confirmation. Existing test assertions were preserved. New components and tests are formatted at printWidth 120 and remain below 400 lines.
- UI strings use `useLocaleTranslation(locale)` with explicit locale, including SSR. The locale additions are recorded in `C3-comments-toolbar-dictionary.json` and merged into both dictionaries by the C3 owner.

## Tests and actual sequence

- `C6 keeps reply and resolve visible and requires inline confirmation before deleting from the comment menu`: written and run before the comment UI fix. `C6-red.log` fails because the original Edit button is directly visible. The updated test also checks no network call before confirmation, cancellation without deletion, danger menu styling, DELETE endpoint and refresh. The added focus assertion has its own genuine red/green logs (`C6-focus-red.log`, `C6-focus-green.log`).
- `C5 groups secondary document actions in a keyboard menu and restores focus on Escape`; `C5 offers only reading actions at 360px while preserving access to read-only review`: written before creating DocumentToolbar; `C5-red.log` fails at module resolution because the component did not yet exist. These contract tests are green after implementation.
- `C5 the application hides secondary toolbar actions until More is opened`: the app integration happened concurrently before this test ran, so `C5-app-red.log` actually contains a passing run and is **not** evidence of a failing-first run. To verify the original defect, the original ZIP's unmodified App was temporarily restored as an isolated test fixture with the same assertions. `C5-app-baseline-red.log` genuinely fails on directly visible Export ZIP. The temporary fixture was removed, test import restored to current App, and the same assertions pass in `C5-C6-green.log`. This baseline reproduction was performed after implementation, not claimed as strict failing-first evidence.
- `C5 the owner toolbar displays the pending submission count before opening review`: written and run before adding owner submission loading. `C5-count-red.log` fails because count is initially zero; the C1/C2 owner is implementing the related loading fix.
- Last combined focused run before the count follow-up: `C5-C6-green.log`, 9 tests / 5 files passed. Includes existing SSR mention/deleted/location tests and B2/B9 action tests.
- Intermediate repository typecheck `C5-C6-typecheck.log` failed only on concurrent C1/C3 migration files; no errors in owned C5/C6 files after the fetch mock type fix. This is not a phase verification result.

## Changed files

- `packages/web/src/DocumentToolbar.tsx`, `document-toolbar.css`: edit/submit, owner review with count, owner share as primary desktop actions; remaining actions in More. At ≤480px, share joins More and edit/publication entry is withheld. Existing phone read-only View review access remains.
- `packages/web/src/shared/ActionMenu.tsx`, `shared/action-menu.css`: aria menu button, ArrowUp/Down, Home/End, Escape and Tab handling, outside click dismissal and focus restoration.
- `packages/web/src/DiscussionThreads.tsx` with `features/comments/CommentRow.tsx`, `CommentText.tsx`, `MentionPicker.tsx`: focused comments modules, explicit locale translations, Intl timestamps; Reply/Resolve remain visible, Edit/Delete move to …; deletion is danger colored with inline confirmation and cancellation focus restoration. B2 guest visibility note remains above textarea.
- `packages/web/src/discussion.css`: inline confirmation style uses design token colors/fonts.
- New tests: `DocumentToolbar.test.tsx`, `App-toolbar.test.tsx`, `DiscussionThreads-menu.test.tsx`.

## Browser status

Real-browser screenshots for 360/805/1440 are not executed by this subtask. The root D2 run must verify overflow and screenshots; jsdom behavior tests are not browser acceptance.

## Final focused result

- `C5-C6-green.log` now passes **10 tests / 5 files**, including the pending-count test after the C1/C2 owner added owner-only pending-submission loading with cancellation.
