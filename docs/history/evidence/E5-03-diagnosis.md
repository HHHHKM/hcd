# Region03 first-run diagnosis

Full build exited0; full visual exited1, 32 passed/2 failed. Complete 7-file region backup restored immediately. `E5-03-rollback.json` and failed screenshots/results retained. No baseline changed.

The edit full-page image is exactly20px shorter, starting at the title field. The field falls from the original56px headline control to a36px regular form field. DocumentTitle uses TextField, which wraps input.doc-title-edit in label.be-field. The prepared manifest merged theme `.doc-title-block .doc-title-edit` declarations into `.doc-title-edit`, silently dropping a real contextual class in addition to html. The component's `.be-field input` then wins font/padding/min-height by its element specificity. Dark passes because `.app.dark .doc-title-edit` retains higher specificity.

Correction in retry manifest preserves the original contextual selectors via `selectorAfter`: `.doc-title-block .doc-title-edit` and `.app.dark .doc-title-block .doc-title-edit`, with max760 exact media anchors updated. This is restoration of original scope, not invented specificity. Preview exits0. Full visual still required after root releases the E4 follow-up pause.

The light rich-editor surface also captures a different scroll position. Resolve title layout first, then rerun the complete unchanged baseline gate; do not attribute the remaining rich-editor difference to fixture timing before the CSS correction is measured.
