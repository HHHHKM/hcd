# E4 import upload follow-up

Guide E4 §8 requires a dashed upload area with large radius and shallow fill. The owner declarations already existed but lost to the generic theme input selector. Root retained the original owner selector and grouped it with the explicit real file-input state. No existing test assertion or screenshot mask was changed.

The new permanent visual/import-upload.visual.ts regression checks the real compiled app in all four width/theme combinations. It records computed border/radius/background, measures the usable area, and compares the fill against Chrome's own serialization of a hidden local token probe.

| Viewport / theme | Before | After | Exact computed surface | Size |
| --- | --- | --- | --- | --- |
| 1440 / light | [before](E4-followup-import-red-1440-light.png) | [after](E4-followup-import-green-1440-light.png) | dashed / 16px / rgba(120, 120, 128, 0.12) | 504 × 76 |
| 390 / light | [before](E4-followup-import-red-390-light.png) | [after](E4-followup-import-green-390-light.png) | dashed / 16px / rgba(120, 120, 128, 0.12) | 310 × 76 |
| 1440 / dark | [before](E4-followup-import-red-1440-dark.png) | [after](E4-followup-import-green-1440-dark.png) | dashed / 16px / rgba(118, 118, 128, 0.24) | 504 × 76 |
| 390 / dark | [before](E4-followup-import-red-390-dark.png) | [after](E4-followup-import-green-390-dark.png) | dashed / 16px / rgba(118, 118, 128, 0.24) | 310 × 76 |

- Red: 4 failed, exit1; all were solid / 8px / paper.
- Green: 4 passed, exit0; all now dashed / 16px / fill.
- Full changed run: 38 passed, exit0; zero SHA changes because the improvement was within the existing image tolerance.
- Full missing run: 38 passed, exit0; only the four import-upload files were regenerated through their unchanged original screenshot assertions. All172 others, including import-preview, retain their original SHA.
- Original176 files and hashes remain preserved in E4-followup-before-visual-baseline/ and E4-followup-before-visual-baseline-manifest.json.
- Final two full checks have not started: root requested a pause after this run for a separately confirmed E4 dangerous-action defect. The new176 manifest is provisional.

Evidence: E4-followup-import-summary.json, E4-followup-import-baseline-integrity.json, E4-followup-import-red.log, E4-followup-import-green.log, E4-followup-visual-update.log, E4-followup-visual-update-missing.log and their result/artifact files.
