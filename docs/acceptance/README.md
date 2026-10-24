# Acceptance reports

This directory contains the 2026-10-25 macOS release verification and historical build evidence. Each report states the tree and checks it covers; local verification does not imply deployment or GitHub CI success.

| File | What it covers | Status |
| --- | --- | --- |
| [github-release-verification.md](github-release-verification.md) | Public repository, attribution, first Linux CI and fresh GitHub clone verification | First CI and fresh-clone verify passed; release target v0.1.0 prerelease |
| [macos-release-verification.md](macos-release-verification.md) | Release package integrity, complete verify, visual review and two consecutive comparisons, all five Chrome/CLI acceptance scripts | Current local release verification; upload and first CI results recorded separately |
| [visual-review-20261025.md](visual-review-20261025.md) | Per-file decisions for 45 baseline updates | Reviewed before update; two subsequent complete visual runs passed |
| [AT-coverage.md](AT-coverage.md) | Every specification item (AT-xx), the tests that cover it, and what is partial or not implemented | Current as of the last Codex build; update when tests change |
| [browser-acceptance.md](browser-acceptance.md) | Real-Chrome application flows, viewports and themes | Run on the 665/686 builds |
| [ui-acceptance.md](ui-acceptance.md) | Real-Chrome UI surface acceptance for the redesigned front end (45 observations, toolbar, guest scroll, 38 surface types) | Run on the 686 build, before the release fixes |
| [cli-acceptance.md](cli-acceptance.md) | `mdoc login --no-open` → Chrome consent → `mdoc mcp` | Re-run successfully on the 2026-10-25 release tree; current executed report |
| [verify-686-final.log](verify-686-final.log) | Last full `pnpm verify` run by Codex (114 files / 686 tests, exit 0) | Before the release fixes listed in [../RELEASE_NOTES.md](../RELEASE_NOTES.md) |

Historical screenshots and generated output bundles are not shipped (they were ~200 MB, much of it duplicate or from failed runs). Current release JSON and text logs are included in `macos-release-20261025-logs/`; screenshots and traces remain local in `outputs/` and are excluded from Git, apart from the reviewed regression baselines. The scripts regenerate the evidence:

```sh
pnpm build
tsx scripts/acceptance-browser.ts        # core application flows
tsx scripts/acceptance-ui-surfaces.ts    # redesigned UI surfaces, light/dark, 390/1440
tsx scripts/acceptance-toolbar-menu.ts
tsx scripts/acceptance-guest-scroll.ts
tsx scripts/acceptance-cli.ts            # device authorisation → MCP
```

The acceptance scripts launch Google Chrome (`channel: 'chrome'`) against a disposable database.
