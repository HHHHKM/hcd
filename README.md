# HCD · HTML 协作文档

![HCD](docs/screenshots/doc-1440-light.png)

HCD is an open-source web application for structured HTML documents with a review-before-publish workflow. People edit private drafts, submit changes, review a merged preview, resolve conflicts, and publish immutable numbered versions. The stored document is validated JSON; HTML is an import, rendering, or export format.

> **Built by Claude and Codex.** HCD was designed, implemented, tested and visually redesigned jointly by two AI agents — **Claude** (Anthropic) and **Codex** (OpenAI) — working in turns under the product direction of **Alkaid**, the human project owner. Codex wrote and fixed the product code and its tests; Claude reviewed it, set the fix and UI specifications, and redesigned the front end in an Apple-inspired visual language. See [AUTHORS.md](AUTHORS.md).

**HCD (HTML Collab Docs)** is licensed under MIT. Copyright (c) 2026 Alkaid and HCD contributors. Chinese product overview: [docs/PRODUCT_GUIDE.md](docs/PRODUCT_GUIDE.md).

## Status

Developer test release `0.1.0`. It is meant to be run locally, reviewed and extended — **not yet a production service**. The container deployment, real PDF rendering, real SMTP and Feishu/Lark delivery, and external OAuth connectors have not been exercised end to end (details below and in [docs/acceptance](docs/acceptance/README.md)). PostgreSQL, module owners, automatic publication, backup/restore and audit logging are deferred. Release notes and the open follow-ups are in [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md).

## What works in this build

- React/Vite workspace UI with Chinese and English copy, document list, structured content view and editing. The interface follows an Apple-inspired design language: design tokens in `packages/web/src/tokens.css`, a layered `theme/` stylesheet set, light/dark themes with checked contrast, and a compact sidebar, command-style toolbar and sheet dialogs.
- Fastify API with SQLite, cookie sessions, role checks, same-origin mutation guard, drafts, idempotent submissions, versioned previews, conflict resolutions, and immutable publishes.
- HTML import preview and confirmation, JSON/HTML/ZIP export, comments, notifications, personal access tokens, AI edit and conflict-resolution tasks with human editor/owner approval, and version restore previews.
- Core TypeScript package with recursive Zod validation, canonical JSON/SHA-256 hashing, deterministic operation application, text diff/three-way merge, and HCD Spec HTML parse/serialize.
- Standalone safe HTML renderer with shared website/export charts and embedded uploaded images.
- Document-scoped image uploads (PNG/JPEG/GIF/WebP/SVG, 10 MB limit), content-hash deduplication, and SVG cleaning.
- Discussion reply/edit/delete/resolve/reopen and member mentions; notification inbox with unread counts and read controls. Comments relocate during publication, retain explicit deleted/lost states, and can be manually moved by owners. Owners can create read-only share links pinned to a version, with expiry/revocation and public asset/discussion routes; commenter links require email verification and isolated guest sessions; external guests can comment, reply and request editor/owner-approved AI tasks.
- Preserved original HTML/ZIP downloads, private import previews with inline images, import reports, heuristic metric/timeline recognition, and import nesting limits.
- HCD ZIP archives include canonical JSON, per-module Spec HTML, theme and image files; bounded, integrity-checked reimport recreates the content with new document and asset identities. Static raw assets are included with scripts disabled.
- Isolated static raw rendering: separate hostname, five-minute signed URLs, authorization checked on reads, strict CSP, empty iframe sandbox, and no raw HTML through main-origin asset routes. Browser sandbox behavior remains unverified.
- `mdoc` commands for device-code or existing-PAT login, server-revoking logout, module pull/status/diff/submit with native operations and bounded identity recovery, local rendered previews, receipt inspection and explicit cancellation, HTML import, JSON export, and queued HTML/PDF/ZIP export with version selection. Local Chrome device consent and login-to-MCP acceptance passed; automatic operating-system browser opening remains untested because the run used `--no-open`.
- Administrator workspace screens, invitation/reset APIs and redemption pages with single-use expiring links, account disabling, member management, and final-owner protections.
- Space-level Feishu/Lark integration settings, encrypted credentials, signed cards, durable queues and local fake-service validation. Real tenant delivery remains unverified.
- Persistent HTML/ZIP/PDF export jobs with frozen snapshots, pending-change filtering, permission-checked signed downloads and 24-hour cleanup; PDF renderer service code and container configuration are supplied but real Chromium output remains unverified.
- Email notification outbox and preferences: bilingual templates, current-access checks, lease recovery, bounded retries and SMTP configuration. Local SMTP integration is tested; account/visitor mail uses encrypted queued credentials; daily review summaries have configurable timezone/hour and per-day deduplication. Real external delivery and browser editing of notification preferences remain unverified.
- Stateless HTTP MCP endpoint at `/mcp`, authenticated with scoped personal tokens or OAuth access tokens; reading, commenting, and submitting remain subject to document AI settings and role checks.

Full target acceptance is incomplete. [docs/acceptance/AT-coverage.md](docs/acceptance/AT-coverage.md) lists every specification item and its test coverage; [docs/acceptance/browser-acceptance.md](docs/acceptance/browser-acceptance.md) and [docs/acceptance/cli-acceptance.md](docs/acceptance/cli-acceptance.md) record the real-browser and CLI runs (the CLI report predates the redesign and should be re-run). PostgreSQL, module owners, automatic publication, backup/restore, audit logging and the AT-44 editor architecture are deferred. Real external OAuth, PDF rendering, container deployment and physical-device behaviour require their own evidence. JPEG trailing-data rejection and the email lockout tradeoff are intentional. Publication of pending work by a removed editor still needs a product decision.

## Run locally

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Development raw content uses `http://render.localhost:3000`, which must resolve to the same local server. The server listens on port 3000 and stores SQLite data in `./data/hcd.sqlite`. The development server seeds example accounts and documents once:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@example.com` | `hcd-demo-2026` |
| Owner | `d@example.com` | `hcd-demo-2026` |
| Editor | `a@example.com` | `hcd-demo-2026` |
| Editor | `b@example.com` | `hcd-demo-2026` |
| Commenter | `f@example.com` | `hcd-demo-2026` |

The development launcher explicitly enables demo seeding. Non-production launches may seed with `NODE_ENV=development` or `HCD_SEED_DEMO=1`; `NODE_ENV=production` combined with `HCD_SEED_DEMO=1` refuses startup. Use a disposable `DATA_DIR` for acceptance and do not reuse demo credentials or the development secret in deployment.

Useful commands:

```sh
pnpm dev:web       # Vite UI only
pnpm dev:server    # API only
pnpm seed:demo     # add example records in development
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` runs ESLint, the unsafe-rendering scan, light/dark contrast checks, TypeScript, tests and the production web build, stopping on the first failing step. Its test suite includes real-Chrome CSS/layout tests (Playwright Chromium, or a local Google Chrome when Chromium is not installed); they do not replace real application workflow acceptance. Read `docs/acceptance/browser-acceptance.md` for executed application flows and exclusions; jsdom or API coverage does not constitute browser acceptance.

Visual regression (`pnpm test:visual`) builds the app first, then compares 176 screenshots in `outputs/visual-baseline` using Google Chrome with a single worker. Baselines are macOS Chrome renders; after an intentional UI change run `pnpm test:visual:update`, review the image diffs, and commit the new baselines.

For a non-development server, set a unique `SECRET_KEY` of at least 32 characters and create the first administrator explicitly:

```sh
export NODE_ENV=production
export APP_URL='https://hcd.example.com'
export RENDER_URL='https://hcd-render.example.com'
export SECRET_KEY="$(openssl rand -hex 32)"
pnpm hcd user:add --email admin@example.com --name Admin --password 'use-a-long-unique-password' --admin
pnpm start
```

Production startup rejects `HCD_SEED_DEMO=1`; development seeding is limited to local non-production use.

Docker Compose and Caddy configuration is available in `deploy/`. See `deploy/README.md` for configuration and initial administrator creation. The container deployment has not yet been exercised end to end.

## Data model and API

`packages/core` owns the canonical document schema and business algorithms. `packages/server` uses SQLite transactions for version publication and stores versions as immutable JSON snapshots. A draft never changes the published snapshot; only a preview publish transaction increments the document version. Personal tokens are hashed at rest and can be restricted by scope and document.

The JSON API is rooted at `/api/v1`. The app's Vite dev server proxies `/api` and `/healthz` to port 3000. Mutating cookie-authenticated requests require the `X-HCD-Request: 1` marker and an allowed origin. See `packages/server/test/app.test.ts` for executable request examples.

Account settings implement cookie-only `POST /api/v1/auth/logout-all`, which deletes all user sessions while preserving PATs, and `PATCH /api/v1/me` with `currentPassword` / `newPassword` (10–1024 characters). Password-change failures count toward login limits; success retains the current session, deletes other sessions and invalidates unused reset links. The web settings page provides the password form and an inline logout-all confirmation. `GET /api/v1/me/tokens` includes `last_used_at` and `last_used_ip`; successful token authentication updates them at most once per 60 seconds. These fields migrate additively on existing databases.

`TRUST_PROXY` accepts an explicit comma-separated IP/CIDR list and defaults to no trust. Request logs use Pino JSON with method, route template, status, duration, actor and request ID. They exclude raw paths, query strings, bodies and credentials. `LOG_LEVEL` controls verbosity; tests are silent by default.

Administrators can create single-use invitation and password-reset links through `/api/v1/admin/users`, or locally with `pnpm hcd admin create --email user@example.com --name "Name"` and `pnpm hcd admin reset-link --email user@example.com`. The CLI commands return links. The web administrator actions also queue invitation/reset emails when SMTP is configured. The web app’s Manage workspace screen provides the same invitation/reset actions. Transfer all directly owned spaces/documents before disabling their final active owner. Member screens explain direct versus inherited access.

The `/mcp` endpoint implements stateless JSON responses for MCP `2025-03-26`, using a bearer PAT or OAuth access token. It exposes document/module/version reads, comments, and pending submissions. It does not expose publication or administrator actions. The current 20 tools include HTML/JSON module reads, a supported-format reference, comment replies, own-submission withdrawal, AI task discovery/claim/completion/failure, read-only merge previews and conflict suggestions. `hcd://spec` serves that reference. Results include `structuredContent` and a text representation. Submissions accept full JSON, strict operations or Spec HTML modules, with durable ID maps and idempotency. Low-confidence identity recovery requires human review. SSE and the complete target protocol remain unfinished. See `packages/server/test/mcp.test.ts` for request examples.

Uploaded image files are stored in `DATA_DIR/assets/<hash-prefix>/<sha256>`. Include this directory alongside the database in backups. Original imported HTML is retained in the database and served only as a download. Uploaded SVGs use a conservative static allowlist; scripts, foreign objects, external links, animation, and unsupported attributes are removed. Static raw HTML is served through the separate signed render origin described above.

## Command line

Start device authorization and open the printed URL manually:

```sh
pnpm mdoc login https://hcd.example.com --no-open
pnpm mdoc pull d_abcdefgh ./q4-plan
cd ./q4-plan
/path/to/hcd/node_modules/.bin/tsx /path/to/hcd/packages/cli/src/index.ts status
/path/to/hcd/node_modules/.bin/tsx /path/to/hcd/packages/cli/src/index.ts submit -m "Update rollout dates"
```

From the HCD repository root, use `pnpm mdoc …`. `mdoc mcp` forwards tools/resources through the official SDK; `mdoc diff` displays readable text additions/deletions, formatting, structural positions and coupled table/chart deletions. `mdoc diff --json` emits a standalone structured `ChangeSet`; `mdoc diff --ops` retains raw operations. Machine modes omit the status preamble so their output is valid JSON. Module renames are matched by ID and reorders are detected. Duplicate IDs are rejected. Pull protects local edits and refuses a nonempty directory without valid HCD metadata. `--force` replaces local module HTML files in an initialized checkout; other files are retained.

### Login, credentials and logout

Use the public origin configured as `APP_URL`. With `pnpm dev`, use `pnpm mdoc login http://localhost:5173 --no-open`; Vite proxies the API to port 3000. The CLI rejects a confirmation URL on a different origin, so the internal API port is not the login address in this setup.

`mdoc login <server>` prints a code and the same-server `/cli-auth?code=XXXX-XXXX` URL, then asks the operating system to open it. `--no-open` prints the URL without invoking a browser. In the consent page, sign in and compare both the code and computer name with the terminal before allowing access. The default scopes are `read`, `comment`, `submit` and `ai_tasks`; `preview` is optional. Choose specific documents or explicitly allow all documents the account can access, including future ones. The page initially selects the specific-document option with no documents selected. Authorization defaults to 30 days and permits 1–90 days. Document role, token scope and the document's AI-access switch still apply to every document request; a token cannot publish or perform owner actions.

The device request lasts ten minutes and polls no more often than every three seconds. Its display code is not a credential; the separate random `pollToken` stays out of the verification URL and page responses. First inspection binds approval to that signed-in account and exact session. Repeated approval never changes the original grant or creates another PAT. During the original ten-minute window, the same `pollToken` can retrieve the same approved PAT again after a lost response, subject to live session, account, token and selected-document access checks. Expiry removes the delivery secret; an already issued PAT retains its chosen lifetime. Denial, expiry, cancellation and failed verification leave existing local credentials intact.

Existing personal tokens from Settings remain supported: `mdoc login <server> --token <PAT>`, or set `HCD_TOKEN` in the environment and run `mdoc login <server>`. `--token` takes precedence over `HCD_TOKEN`; either bypasses device authorization and verifies the token with `/me` before saving it. `HCD_TOKEN` also supports the MCP bridge directly with `mdoc mcp --server <server>`; it is not a general override for the other checkout commands. Server addresses must be HTTPS origins, except HTTP localhost/loopback development addresses, and may not include credentials, a path, query or fragment.

Credentials are stored per server in `~/.config/mdoc/credentials.json`, or `%APPDATA%\mdoc\credentials.json` on Windows. Updates write a private temporary file, sync it and atomically replace the JSON file. A `credentials-lock.sqlite` process lock serializes changes; keep that lock file in place. On Unix, new credential directories use mode `700`, and credential/lock files use mode `600`. Invalid or duplicate records and symlinked credential files/directories are rejected without overwriting their targets. Logging out removes only the exact saved token that was revoked, preserving any concurrent replacement for the same server.

`mdoc logout [server]` revokes each selected saved bearer token on the server before removing its local record; omitting the server selects all saved servers. A `401` means that credential is already unusable and allows local removal. Network failures, `403`, `5xx`, and an older server's `404` preserve the local credential and report failure so logout can be retried. `mdoc logout [server] --local-only` explicitly removes local copies without server revocation; revoke any still-valid token in HCD Settings. An environment-only token is not a saved record and is not selected by logout.

The device API uses `POST /api/v1/cli-auth/start`, `POST /api/v1/cli-auth/poll`, session-only `GET`/`POST /api/v1/cli-auth/requests/:code`, and bearer-only `POST /api/v1/cli-auth/revoke`. Approvals require the normal same-origin write guard; anonymous start/poll also reject an unexpected Origin. A bearer can revoke only itself; OAuth access-token logout revokes its authorization family. Device authorization has local HTTP/API, SSR and unit-test coverage. The final local run executed `mdoc login --no-open`, approved the request in Chrome, then used `mdoc mcp` to initialize, list 20 tools and call `read_document` successfully. See `docs/acceptance/cli-acceptance.md`; automatic operating-system browser opening and deployed-server acceptance remain unverified.

### Shared local submission planning

Local comparison, `status`, `diff`, `preview` and new `submit` requests use the same `prepareSubmissionPlan` implementation. Each run freezes the filenames and HTML once, parses draft modules and reconciles their identities against the pulled base before assigning IDs to new nodes. High-confidence recovered IDs are preserved. New wire nodes use `tmp_` IDs for permanent allocation by the server. Local displays use deterministic IDs that cannot collide with existing nodes; these IDs are never written back into source files.

Ordinary submissions send `ops`, including supported module reorders and cross-module moves. When identity matching is uncertain, the request sends the original source `moduleHtml` with explicit `deleteModules`, so the server independently reconciles it and requires human identity review. It never substitutes inferred local IDs into the outgoing HTML. Uncertain matching can accompany new module insertion or module deletion, but cannot currently accompany an existing-module reorder or a cross-module node move in one request. Uncertain module-root targets and conflicting recovered root IDs also block submission. These plans can still show a local preview and warnings; `submit` fails without sending a partial request or splitting the changes.

Local input rejects multiple module roots, duplicate IDs, unsupported or lossy HTML, executable scripts and event attributes. The validated inert chart JSON described below is the only script-element exception. Planning accepts at most 200 source files, 500,000 characters per HTML file and 16 MiB of aggregate source HTML; submissions are limited to 500 operations. Uncertain HTML requests additionally allow at most 100 module updates and 100 explicit deletions. Complete reconciliation and merge acceptance coverage remains unfinished.

### Local working-copy preview

Run `mdoc preview --no-open` inside a pulled checkout to generate `.mdoc/preview.html`, or add `--locale zh-CN` / `--locale en` to choose its language. The page renders the current local files and displays an unreviewed-working-copy banner with the pulled base version. It does not create a submission or modify the published document. Without `--no-open`, the command also asks the operating system to open the result. Automated checks have exercised only `--no-open`; the opener and browser visual behavior remain unverified.

A document without asset references can render offline. Image/raw references require a credential and current server access. Each run fetches every referenced asset again, even when a content-hash file already exists in `.mdoc/assets`; that directory is not an offline authorization cache. Fetches reject redirects. API requests use the PAT, while signed raw-content downloads receive no PAT. Images are checked and raw HTML is sanitized before embedding. The preview supports at most 100 unique assets, 10 MiB per asset, 40 MiB of asset data in total and a 64 MiB estimated inline expansion budget, including repeated references. Failure preserves the previous `.mdoc/preview.html`; already downloaded hash files may remain. The generated page and asset files contain document content and should be handled like the checkout itself.

## Submission formats and retry recovery

`POST /api/v1/docs/:id/submissions` and MCP `create_submission` require an immutable `baseVersion`, an idempotency key and exactly one of `content`, `ops` or `moduleHtml`. Complete JSON is validated before normalization and converted to strict operations against that base. Its existing and newly supplied permanent IDs are preserved, and replay must exactly reproduce the canonical submitted snapshot. JSON requires complete, unique valid IDs; missing/duplicate IDs and dangling references are rejected. Changing the document ID, an existing node’s kind, theme ID/version or an existing raw asset reference is rejected; replace a node with a fresh ID when changing its kind or raw asset. More than 500 derived operations returns TOO_MANY_OPERATIONS. Exact retries of previously accepted requests keep the original receipt contract. Strict operations check before values and hashes against the selected base; inserted objects use unique `tmp_` IDs, and subsequent operations may refer to them. Responses return the permanent `idMap`, operation count and original submission. Identical retries reuse the first assigned IDs; changing the payload under the same key returns a conflict.

`moduleHtml` entries contain `{moduleId?, html, after?}`. An explicit or recognized root module ID updates that module. New modules append unless an existing `after` anchor is supplied (`null` inserts at the beginning). Entries sharing an anchor retain their order. `deleteModules` must list deletions explicitly; omitted modules are preserved. Mixed formats, duplicate/borrowed IDs, conflicting targets, multiple roots, executable scripts, event attributes and unsupported Spec HTML are rejected. Cross-module moves and existing-module reorders use operations.

Chart module HTML may use the serializer’s inert `<script type="application/hcd+json">` payload as the sole non-whitespace direct child of `<figure data-block="chart" data-kind="bar|line|pie">`. The chart must be a direct module block or a direct leaf in a supported column/card. The script has only its type attribute. Its JSON accepts only known title/unit/category/series fields, bounded strings and arrays, and finite numbers or null values; every series must have exactly one value per category. This narrow data-block exception does not permit executable scripts or event attributes.

When HTML loses IDs, bounded text matching recovers identities among siblings of the same type. Weak or near-tied matches create a human-review requirement. The owner can now accept or drop each uncertain operation. Accepted matches may reveal ordinary text or structural conflicts, which require separate decisions. Dropping an insertion also drops its dependent operations; their outcomes remain visible. A submission with any unresolved conflict is entirely excluded from the candidate and from pending exports. `uncertainCount` counts operations requiring review. New full-JSON submissions return a numeric `opCount` and an empty `idMap`, since their permanent IDs are already supplied. Historical records retain their original response fields, including a possible null count.

Operation and module HTML submissions use sequential merge evaluation: three-way text, scalar conflicts, subtree-aware deletions, moved targets and missing anchors. Submissions sort by creation time and ID, including stable same-anchor insertions. Owners can append, choose a legal new destination or restore the original deleted block. If its original module is gone, restoration uses a deterministic “已恢复的内容 / Restored” module. Surviving containers retain concurrent edits; missing paths and coupled table/chart references are restored. Restoration refuses ID collisions with descendants moved elsewhere. A restored missing block can include its original child content; review it before publication.

Saved previews include per-operation outcomes and a candidate hash. Decisions bind the conflict and its relevant structure; changing an earlier choice can invalidate later decisions. Final validation runs before normalization so dangling cells/chart values cannot silently disappear. Invalid combined structure creates a whole-submission discard choice. Publication recomputes and compares the candidate in its transaction. The database upgrade invalidates old open merge previews once, preserving their data and all versions; rebuild those previews before publishing.

SQLite publication takes an immediate write lock before rereading the preview and document head. Competing previews can produce only one new version; the losing request receives `409 PREVIEW_STALE`. Simultaneous retries of the same preview return the same stored version. Session validity, account state and review permission are checked again while holding the lock, so logout, disablement or role removal during the wait cannot authorize a later write. Published preview status remains `published`. Independent HTTP workers verify these SQLite paths; PostgreSQL support remains pending.

All three submission formats now use the operation merge path. Historical JSON submissions without stored operations are converted read-only against their immutable baseline, preserving the original content and receipts. Incompatible historical content produces an explicit conflict requiring owner discard or submission withdrawal; it is excluded from pending exports and never silently merged. This upgrade invalidates existing open merge reviews once; restore previews and published versions are preserved. Detailed proposal and candidate comparisons are implemented as described below. Browser interaction and the full merge acceptance matrix remain unfinished.

`mdoc submit` saves the exact request, key and verified author ID to `.mdoc/submissions.json` before sending. Receipts freeze whichever shape was sent: `ops`, `moduleHtml` or legacy `content`. An identical retry replays that shape and payload without conversion, preserving newly generated IDs. Before parsing files or planning operations, ordinary submit looks up the source fingerprint and reuses any matching receipt; stricter new parsing does not rewrite or prevent recovery of that old request. New local edits cannot replace a request whose outcome is unknown. Use `mdoc submit --retry --yes` to resend a saved request bound to the current account; this path runs before reading or parsing current HTML, so it also works when newer local files are invalid. Confirmed receipts avoid duplicate sends. The CLI checks the current account through `/me` and validates document/author IDs on responses. Server idempotency is scoped to document, author and key, so changing accounts cannot safely replay another author’s request and is rejected.

`mdoc receipts` lists the saved requests and outcomes without modifying the ledger. `mdoc receipts --json` emits structured summaries, including author identity when recorded, but excludes the frozen document payload. `mdoc cancel <receipt-key> --yes` explicitly recovers the saved request using its original key, reads the resulting submission and withdraws it if it is still pending. Recovery may create the original submission for the first time before withdrawing it. Cancellation cannot undo a published version; published/rejected states are reported accurately and their receipts are retained.

Cancellation persists `cancelling` before network mutations. A lost response or unresolved error retains that state and blocks both new submissions and ordinary submit retries; rerun the same cancel command to reconcile it. A verified server read can settle a lost withdrawal response, but 403/404 responses never prove cancellation. Confirmed withdrawal becomes `cancelled`, preserving the original payload, key and submission ID. The same fingerprint cannot automatically submit again; changing local content or the message creates a new explicit request after cancellation is confirmed. Persistently rejected recovery requests still require diagnosis and remain unresolved.

Old receipts remain readable, including the legacy receipt list. Valid stored full-content requests retain read/replay compatibility even when their message or JSON size exceeds newer CLI admission limits; new requests must pass the current limits. Replay preserves the old payload and does not guarantee that the server will accept it. An old pending/cancelling record with neither a recorded author nor a submission ID cannot be safely attributed to the current account, so automatic replay/cancellation is refused without rewriting its payload or key. An old record with a submission ID can use cancellation to read that exact submission, verify its author and bind the receipt before proceeding. Ordinary submit also refuses to blindly reuse an old completed receipt without an author binding.

A SQLite process lock serializes submission and cancellation from the same checkout and releases after a process crash. Keep `.mdoc/submission-lock.sqlite` in place. Receipts are tied to the original document/server/author, use private file permissions and contain document content but no credentials. Corrupt, contradictory or symlinked receipt files are rejected. Inspection does not create metadata or change permissions.

Native CLI operation submission, bounded local reconciliation, local preview generation and device authorization are implemented. Device-issued credentials share the `hcd_pat_` plus 32-character base32 format used by web PATs and MCP. Current local login-to-MCP execution is recorded in `docs/acceptance/cli-acceptance.md`; browser consent evidence belongs to `docs/acceptance/browser-acceptance.md`. The unsupported combinations above and the complete specification matrix require separate coverage.

## Reading changes

Submission detail responses add `submission.changeSet` alongside the existing `changes` compatibility field. Each row carries its original operation index, module/target identity, text or scalar before/after values, structural positions, and inserted/deleted content. Text differences preserve spaces, line breaks, formatting and link destinations. Deleting a table column or chart category also shows the removed cells or series values. Recorded operations are replayed in their original order, so insert/edit/delete sequences remain inspectable even if the final snapshot is unchanged.

Saved review responses add `presentation: {version: 1, baseVersion, proposed, candidate}`. `proposed` describes each original submission against its own immutable baseline and includes operation outcomes and whole-submission exclusion status. An evaluated operation does not guarantee final inclusion: unresolved conflicts roll back a whole submission, manual choices can replace text, and later submissions can supersede changes. `candidate` compares the saved review baseline with the actual saved candidate. Candidate rows do not claim submission provenance; proposal rows identify their source submission. Publishing or advancing the document does not rewrite a saved comparison. Older reviews with no saved display return `presentation: null`; the UI offers the full candidate and explains that a new review is needed for detailed comparison.

The review UI offers actual candidate changes, original proposals and the full candidate document. Submission details offer changes or full submitted content. `GET /api/v1/docs/:id/compare?from=N&to=M` adds `changeSet`, `from` and `to` while preserving its existing `changes` field. Restore previews compare the current version against the chosen historical snapshot. The bilingual history page selects any two versions, supports reversing the direction, displays version metadata and loads complete read-only historical snapshots. Only owners see restore-preview actions; publication still requires the existing review confirmation. Changing selections or leaving the page cancels reads, and stale responses are hidden. All routes retain their existing role/scope checks.

Comparison failures return an explicit `unavailable` reason instead of a misleading empty diff. Text comparison has a bounded work budget and falls back to before/after replacement for expensive edits. Each comparison is limited to 8 MiB; review display uses a 16 MiB budget prioritizing candidate changes. Net comparisons may exceed 500 rows; the 500-operation submission limit is unchanged. Lists initially show 25 rows. B4 moves comparison and presentation work to a worker with a bounded queue, a byte/entry-bounded LRU, concurrent request coalescing and per-user admission limits. Authorization is rechecked after asynchronous work before returning content. Worker responsiveness, cache, overload and revocation regressions are automated; the old synchronous 1.43-second benchmark no longer describes the request architecture. Current browser comparison evidence and omissions are recorded separately in `docs/acceptance/browser-acceptance.md`.

## Text comments and original-text navigation

In the official document's reading mode, members with commenter access or higher can select text within one supported field and choose **Comment on selected text**. The composer shows the captured quote and source version, with an explicit option to comment on the module instead. Selections may include formatted text, emoji and line breaks, including a single table cell or nested list item. Cross-field selections, draft-editor content, raw HTML and unsupported fields cannot create text anchors. Verified guests with commenting access can also select text on a share page. Their quotes always use the visible share version, including a pinned older version. Private draft selection is an optional future extension, not a requirement for the published-reading comment flow.

Quotes are limited to 500 UTF-16 code units, matching JavaScript strings and DOM Range offsets; most emoji use two units. Each surrounding context is at most 32 units. A rendered line break counts as one newline, and selection capture preserves spaces and combining characters without normalization. It rejects incomplete surrogate pairs and checks that the marked field still equals the displayed model. Before offering a comment, the generated anchor must relocate to the exact selected range in the same snapshot. If bounded context would identify a different occurrence of repeated text, change the selection or use a module comment. Parent-element selection boundaries are accepted only when their exact first/last-child path is equivalent to an edge of the same field; outside whitespace, controls, hidden content and cross-field selections remain rejected.

The API validates the module, node, field and exact quote/prefix/suffix in the supplied source version before relocating to the target version. An omitted version means the currently visible version. Invalid versions, missing targets, unsupported fields and mismatched text return `400` with `INVALID_ANCHOR_VERSION`, `ANCHOR_NOT_FOUND`, `INVALID_ANCHOR_FIELD` or `ANCHOR_QUOTE_MISMATCH`. A valid historical selection can move to the current document, including a `text_changed` or `block_deleted` fallback; a completely lost target returns `409 ANCHOR_STALE`. The composer retains the comment body on these failures so the author can reload and choose another location. Verified guests on a pinned link can anchor only to that link's visible version. Guest comment responses project anchors into the visible snapshot and omit quote, context and range when they cannot reliably match it, preventing later-version text from leaking through anchors. The share composer supports section fallback, refresh/reselection without losing the body, and replies without separate anchors. A synchronous send guard prevents duplicate posts. Discussion reads use a request sequence so late initial responses or errors cannot overwrite a newer post refresh.

**Locate original text** opens enclosing content and navigates to the supported field, block or module. Text highlighting requires an `ok` anchor whose version equals the displayed official version and whose returned range exactly matches the quote. Changed, deleted or stale anchors use the available broader location without misleading text highlighting. Guest pages highlight only the exact quoted text without a paragraph outline. Local API, renderer and synthetic DOM checks cover these behaviors; current native selection, responsive and light/dark browser evidence is recorded in `docs/acceptance/browser-acceptance.md`. Physical touch/IME, remaining anchor branches and deployed-server acceptance need independent evidence.

## Development notes

- Keep user content as structured JSON. Do not persist edited HTML as the canonical document.
- Validate and canonicalize on the server before creating a submission or formal version.
- Never let an AI or personal access token publish, reject, restore, or alter owner settings.
- Imported HTML is parsed into data; scripts and event attributes are not carried into the document.
- Run `pnpm verify` before submitting changes.

## Contributing

Issues and pull requests are welcome. Please include focused tests for schema, merge, permission, or versioning changes. Start with the target requirements in `docs/BUILD_SPEC.md`; note when a behavior is intentionally not implemented yet.

## Email notifications

Set `SMTP_HOST` and `SMTP_FROM` to enable the worker, with optional `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS` and `SMTP_SECURE`. STARTTLS is required by default; `SMTP_REQUIRE_TLS=false` is intended for a trusted local test SMTP service. New in-app events are atomically queued; historical notifications are not backfilled. Without SMTP configuration, queued events are retained without consuming attempts.

Users can select event emails in Settings → Notification preferences. The worker rechecks active account, document access and preferences before delivery. It checks every 30 seconds, retries after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, and marks the sixth failure as failed. Crash recovery may deliver a message more than once; fixed Message-ID does not guarantee recipient-side deduplication. Existing unconfigured installations should review queued events before enabling SMTP.

## Account email and verified guest links

With SMTP enabled, the login page exposes `/auth/forgot`. The public reset endpoint always returns 204 for a syntactically valid email, including unknown, disabled or pending accounts. Password reset invalidates prior sessions, reset tokens, active PATs and OAuth authorization families. Security credentials are encrypted in the queued mail using a key derived from `SECRET_KEY`; terminal delivery erases ciphertext. Changing this key also invalidates existing tokens and unread queued credentials. Keep the server and administrator CLI on the same key.

Owners can create viewer or commenter links. Pinned links filter root comments and replies by their creation-time visible version, not their relocated anchor version; all replies to an externally initiated thread remain visible. An invisible parent cannot receive a pinned-link reply, and pinned document responses omit `currentVersion`. Member reply composers warn when the thread is visible to an external guest. Commenter links require a six-digit code (10 minutes), with five incorrect attempts locking the normalized email for an hour across links. Resending does not reset failure counts. Guest cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS, with paths scoped to the corresponding share link and API. Guest sessions last seven days; link expiry/revocation invalidates access immediately. A guest is not a workspace account. Guest mentions of members remain plain text; AI requests wait for owner approval.

Signed raw resource URLs bind the guest session record and recheck its expiry and link authorization. They remain temporary bearer URLs if copied; the session binding provides revocation, not identity verification on the separate render host.

Daily pending-review summaries are enabled by default and can be disabled in notification preferences. `MAIL_DIGEST_TIMEZONE` defaults to `UTC`, and `MAIL_DIGEST_HOUR` defaults to `9` (0-23). The worker queues one summary per user/local date after that hour, skips empty summaries, rechecks current review permissions and pending submissions, and cancels summaries older than 24 hours. Restarting does not duplicate a day's summary; downtime before the next date does not backfill old dates.

To send an explicit configuration test to an address you control:

```sh
pnpm hcd mail test --to you@example.com --locale en
```

This command sends a real message when real SMTP is configured. Its success means SMTP accepted the message; inbox receipt needs a separate check. Development tests use only injected delivery or the local SMTP fixture.


## Feishu and Lark

Space owners can configure a group webhook or application direct messages in Manage workspace. `FEISHU_BASE_URL` selects `https://open.feishu.cn` (default) or `https://open.larksuite.com`; arbitrary destinations and redirects are rejected. The app requires bot sending and email-to-user-ID lookup permissions. Application credentials and optional webhook signing secrets are encrypted with a separate key derived from `SECRET_KEY`, never returned by the settings API. Use the same key across restarts.

Enabled integrations queue new submission, publication, mention and AI approval events. Group cards contain the document title, a link, and up to 200 characters of a mentioned comment; ensure the target group is appropriate for the space. Private messages resolve the current account email and cache the tenant-specific open ID for 24 hours. Delivery rechecks current membership, configuration revision and event state before each request. Configuration replacement/disable cancels pending jobs; a request already sent to the upstream service cannot be recalled. Explicit connection tests send a real message only after the owner presses and confirms the test action.

The worker uses renewable leases and six attempts with the same backoff as email. Delivery remains at-least-once after a crash. App messages use a stable UUID within the provider's one-hour deduplication window; webhooks have no such guarantee. Tests use local HTTP fixtures or injected requests for both hosts. Actual Feishu/Lark tenants and the settings UI have not been verified. See D-009 in `docs/DECISIONS.md` for official API references and the token endpoint distinction.

Every minute, maintenance removes expired sessions and used/expired invitation and guest credentials, clears unusable encrypted mail payloads and expired CLI device-delivery secrets, and expires identity caches. It preserves active verification lockouts/cooldowns, current mail leases, document content and delivery audit metadata. Expiring a device-delivery window does not shorten an already issued PAT's chosen lifetime. This is credential expiry cleanup; asset garbage collection and audit-retention policy are still pending.


## Queued exports

Open Export HTML or Export ZIP on a document to choose HTML, PDF or HCD ZIP, a published version, and optionally pending changes. The panel resumes its last job within the same browser tab. API clients use `POST /api/v1/docs/:id/exports` and `GET /api/v1/exports/:id`. The request freezes the document snapshot in a transaction; later edits do not change the result. Pending exports require commenter or higher access, include all clean submissions, exclude entire conflicting submissions, and return the excluded IDs. Pending content must be based on the current version; combining it with an older explicit version returns `PENDING_REQUIRES_CURRENT_VERSION`.

Only the creator can query a job. Downloads use the separate render origin, an attachment response, and a five-minute signed URL that rechecks account, document access, pending visibility and any originating PAT's validity. These are transferable short-lived bearer URLs, not proof of the downloader's identity. PAT export requires `read`, document scope and enabled document AI access. Changing permission or revoking the originating PAT invalidates an already issued URL.

The queue runs one active job across workers sharing the SQLite database. Renewable leases recover interrupted jobs up to three claims; stale workers cannot register or overwrite a newer result. Limits are three active jobs and twenty jobs per user per day, plus one hundred active jobs globally. Each POST creates a separate job; submission idempotency keys are not reused for exports. Files and frozen snapshots expire after 24 hours. Completed/failed metadata remains for diagnosis, while completed snapshots are cleared. Incomplete temporary files are removed after one day.

HTML embeds CSS/images and sandboxed static raw blocks, includes a pending warning when applicable, and ends with title/version/export time. ZIP uses the same checked archive format as the original export/reimport workflow. Legacy synchronous HTML/ZIP/JSON downloads remain available for compatibility.

`EXPORTER_URL` configures the internal PDF endpoint. The app posts HTML to `/pdf`, rejects redirects and invalid or oversized PDF responses, and aborts after 60 seconds. `packages/exporter` contains the Playwright renderer with JavaScript disabled, offline context and all routed requests blocked. Compose connects it only through an internal network, exposes no host port, and mounts no application data volume. Both client and service enforce one render at a time; the exporter enforces A4 print output. This code, image configuration and real browser network isolation have not been executed. Current PDF tests use synthetic PDF bytes and an injected renderer; they validate transport/lifecycle, not a readable PDF or print layout.

```sh
pnpm mdoc export d_abcdefgh --format zip --version 2 --out ./document.zip
pnpm mdoc export d_abcdefgh --format pdf --out ./document.pdf
```

The CLI polls for up to five minutes, downloads binary files atomically and does not forward the PAT to the render domain. A separate render URL is required even for HTML/ZIP queued exports. Without `EXPORTER_URL`, PDF jobs fail explicitly with `EXPORTER_NOT_CONFIGURED`.


## OAuth client authorization

Discovery is available at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp` (also the root protected-resource path). The configured `APP_URL` origin is the issuer; `<APP_URL>/mcp` is the required resource at authorization and token exchange. The REST document endpoints backing MCP use the same resource authorization. Resource URLs are not accepted from caller-controlled host headers.

Public clients may use a Client ID Metadata Document URL or register using `POST /oauth/register` with `client_name`, `redirect_uris`, and `token_endpoint_auth_method: "none"`. Only code flow and PKCE S256 are supported. Metadata documents require HTTPS, a non-root path, port 443, no query/userinfo/fragment, and publicly routable IPv4 DNS answers. Fetches pin the verified IP for TLS, reject redirects, limit responses to 64 KiB, and bound cache lifetime. IPv6-only metadata hosting and confidential clients are not supported yet. Redirect URIs must match registration exactly and use HTTPS, or HTTP localhost/loopback for installed clients.

`GET /oauth/authorize` accepts `client_id`, `redirect_uri`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `resource`, optional `scope` and `state`. `/oauth/consent` presents a bilingual login/consent page with the unverified client name, full return address, requested scopes, explicit document selection and a 1/7/30-day authorization lifetime. Consent is tied to a ten-minute browser request and the inspecting account. Starting another authorization in the same browser replaces its flow cookie; restart the earlier request if needed.

`POST /oauth/token` accepts form-encoded authorization-code and refresh-token grants. Codes last five minutes. Access tokens last at most one hour; authorization and refresh credentials have an absolute maximum of 30 days. Refreshes rotate, may narrow scopes and cannot extend the authorization. Reusing a redeemed code (with its correct PKCE binding) or consumed refresh token revokes the complete family. `POST /oauth/revoke` and personal settings revoke a family; resetting a password or disabling an account also invalidates outstanding codes. Token values are hashed at rest. Refresh tokens cannot authenticate API or MCP calls.

Access intersects current role, scopes, selected documents and the live AI switch. Tokens cannot publish, reject, restore, administer memberships, or read/clear the private browser draft. Signed image/raw URLs requested with a token recheck that token on every download. `ai_tasks` requires `submit` and current editor permission for claiming/completing tasks. The `preview` scope permits read-only preview computation and saved-preview reads; suggestions additionally require `ai_tasks` and `submit`. Explicit scope narrowing affects newly issued access tokens; earlier access tokens expire normally unless the family is revoked.

Protocol routes support public-client CORS without cookies. The MCP endpoint retains its strict allowed-Origin policy; native/server clients work without an Origin header. Browser clients hosted on another origin are not supported by that policy. Real connector interoperability and browser consent interactions remain unverified.

To use the stdio bridge after saving a PAT through device authorization or `login --token`:

```sh
pnpm mdoc mcp
# Or provide HCD_TOKEN through your MCP host's environment:
pnpm mdoc mcp --server https://hcd.example.com
```

The bridge uses SDK 2.3.1 but negotiates this server's existing MCP `2025-03-26` subset. It forwards supported tools/resources, structured results and protocol/tool errors, with no stdout diagnostics. All HTTP requests stay on the configured `/mcp` endpoint, reject redirects and have a 30-second timeout. Local EOF/signals close both connections. It does not implement sampling, elicitation, progress forwarding or subscriptions. Tests exercise an actual SDK HTTP client and a stdio child process against local fixture servers; they do not launch a browser.

## AI tasks and review suggestions

Human editors/owners can approve requests; their own root comments mentioning `@[AI](ai)` create approved edit tasks. Commenter/guest requests require approval. Tokens cannot approve their own requests. Task workers need `ai_tasks` and `submit` scopes plus current editor access and an enabled document. A claim returns a random `claimId`, fixed `baseVersion` and allowed module IDs. Use that same token and claim ID in task submissions, completion and failure requests. Claims last 30 minutes; three failed/expired attempts end automatic retries. OAuth refresh does not transfer a claim to the new access token; wait for expiry and reclaim. All attempts retain audit records.

A task submission must preserve document metadata, module identities/order and all unrelated modules. Completion requires a submission created with that exact task/claim/token. Completion creates one system reply linked to the submission and leaves publication to a human. Private browser draft endpoints reject all bearer tokens.

Owners can ask for AI advice on a saved review conflict. `suggest_resolution` also requires `preview` scope. Suggestions are bound to the exact preview revision and conflict fingerprint. Human adoption validates the complete candidate and records the source task; any intervening preview edit, replaced preview, withdrawn submission or published version invalidates earlier advice. Adopting advice does not publish. The web task panel and suggestion controls are compiled but browser interactions remain unverified.
