# outputs/

- `visual-baseline/` — the 176 reference screenshots used by `pnpm test:visual` (macOS Google Chrome, zh-CN, Asia/Taipei). Tracked in git.
- Everything else written here by the acceptance and visual scripts (screenshots, JSON results, traces, logs) is generated and git-ignored.

Update the baselines only after reviewing the image diffs: `pnpm test:visual:update`, then run `pnpm test:visual` twice in a row.
