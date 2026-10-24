# C1 remaining component split

- Added `C1 keeps each frontend implementation file within 400 formatted lines` before splitting. `C1-component-size-red.log` records genuine failure: BlockEditor 843 lines, SharedDocument 460 lines.
- BlockEditor retains its existing default export and named BlockPicker export. Structured editors now live under `features/editor/`: table, chart, KPI, timeline, columns/cards, list/leaf collection and field helpers. The root file is 166 lines; all child files are under 400 lines.
- SharedDocument retains its original import path as a re-export. `features/share/` separates request/state/anchor handlers, main page, discussion projection, comment composer and shared types. Existing DOM class names and selection/quote handling are preserved; root C7 CSS continues to remove the guest outer outline.
- No existing test assertions or existing test imports were changed.
- `C1-components-green.log`: **32 tests / 4 files passed** (22 guest document behavior tests, 9 editor/model tests, and the size regression).
- `C1-component-typecheck.log`: repository typecheck passed after the concurrent frontend modules settled.
- `C1-components-eslint.log`: passes without warnings after making readComments a stable callback with its base URL dependency. The final 32-test focused run also passes after this correction.
- Intermediate `C1-shared-green.log` contains a failed first extraction attempt (duplicate unsplit JSX retained in the page, 21 failures). This was an implementation mistake, fixed without changing tests; final combined log above is authoritative.
