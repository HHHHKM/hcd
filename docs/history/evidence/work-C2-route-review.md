# C2 route review and regression handoff

Implementation files were read only during this review. Fixes are assigned to the C1/C2 implementation owner. This record does not claim a phase verification or browser acceptance.

## New regression coverage

Nine new tests were added across three files: eight defect regressions and one passing check of the existing new-document route.

| File | New tests | Genuine red evidence |
| --- | --- | --- |
| `packages/web/src/App-toolbar.test.tsx` | Share panel, Members panel, Back from edit to reading | `outputs/C2-toolbar-route-red.log`: 3 failed / 2 passed (the two earlier C5 tests remained green) |
| same | Saving a title from settings navigates to document edit mode | `outputs/C2-settings-title-red.log`: 1 failed / 5 filtered by test-name selection |
| `packages/web/src/app/C2-route-timing.test.tsx` | Cancels delayed review response when navigating to settings; waits for requested historical version before hash passage location | `outputs/C2-timing-red.log`: 2 failed / 2 tests |
| `packages/web/src/app/C2-space-routes.test.tsx` | Space button URL plus document filtering through refresh/Back; direct space settings selects the requested space | `outputs/C2-spaces-red.log`: 2 failed / 1 passed (3 tests) |
| same | New-document button writes `/new`, and refresh restores its form | Passed before any related fix; no defect claimed |

The first three tests demonstrate that Share/Members route synchronization replaces the intended panel with personal settings, and that Back from `?edit=1` leaves editing enabled. The title test demonstrates an editing page remaining at `/settings`. The timing tests demonstrate a review request remaining active after leaving its page, and a historical comment link scrolling the current `v2` document while the requested `v1` response is still pending. The space tests demonstrate that the space button still navigates to `/` and that a direct second-space settings route does not select that space.

## Test fixture changes and assertion preservation

- Existing snapshot test assertions were not changed. The earlier two C5 assertions in App-toolbar were also preserved.
- App-toolbar's local fixture preloads the existing ShareLinks/Administration lazy modules and adds local share-link/member responses so route panel tests settle without a real service.
- The new timing fixture's scroll observer was narrowed to elements inside `.document-page`, so the unchanged `[]` then `['v1']` assertions measure passage positioning independently from the newly required thread-row positioning. This is a fixture adjustment; no assertion changed.
- During authoring of the new `/new` check, an assumed `create-title` ARIA selector did not exist in the original form. The selector was corrected to the existing `form.create-modal`; this was a test authoring correction, with no product change. The canonical `C2-spaces-red.log` was rerun afterward and truthfully contains two space failures and the passing `/new` check.
- Intermediate `outputs/C2-review-followup.log` captured the concurrent implementation in progress: 3 failed / 5 passed across the toolbar and timing files. It is not a final verification result.

## Scope and remaining handoff

The implementation owner also found and is covering preview creation URL persistence and explicit thread-row scroll/highlight. Their tests and final green logs are maintained separately. No D-stage work was started by this review. Source writes are paused after these new tests and this record.
