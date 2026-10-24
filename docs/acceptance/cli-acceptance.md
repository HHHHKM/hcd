# D2 CLI acceptance

- Started: 2026-10-24T18:26:21.698Z
- Result: PASS
- Command: `pnpm exec tsx scripts/acceptance-cli.ts` (requires loopback listener and Chrome execution permissions).
- Actual login: `pnpm mdoc login <loopback-origin> --no-open`; default 3-second device polling, no token override.
- Consent: real Google Chrome 155.0.8059.85, application built from local dist; login and approval clicked through the actual page, not API consent injection.
- Actual MCP: `node --import tsx packages/cli/src/index.ts mcp --server <loopback-origin>`; saved credentials read by the CLI.
- MCP initialize: PASS (hcd-mdoc); tools/list: 20; read_document: PASS.
- PAT: shared format validated; exact value omitted; credentials.json mode 0600.
- Isolation: fresh temporary SQLite DB, development demo seed, isolated CLI credential profile via a subprocess-only os.homedir shim; HOME unchanged. No real external service used.
- Browser requests outside the loopback application: 0 (blocked if attempted).
- Cleanup: browser, stdio child, HTTP listener, temporary DB and credential profile removed in finally.
- Evidence: cli-acceptance.log; cli-authorization.png (approval result, no PAT or cookie).

This is an executed local CLI/browser acceptance, separate from Vitest test totals.

Current archived log: [cli-acceptance.log](macos-release-20261025-logs/cli-acceptance.log). The generated authorization PNG remains local in outputs/ and is excluded from Git.
