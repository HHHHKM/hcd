# Docker Compose deployment

HCD runs as a Node 24 application container with SQLite stored in a persistent Docker volume. Caddy terminates HTTPS for the app and render hostnames and proxies both to Fastify. A separate Playwright PDF exporter listens on the internal `export_private` network, has no published host port or application data volume, and is configured automatically through `EXPORTER_URL`.

This deployment configuration has not yet been verified with a running container. Fastify enforces separate routes for the rendering hostname and checks short-lived signed URLs against current authorization. Browser sandbox behavior and the running container remain unverified.

Before deploying, point `APP_HOST` and `RENDER_HOST` at the server and allow inbound TCP ports 80 and 443 (plus UDP 443 for HTTP/3). Create the runtime environment file and a unique key:

```sh
cp deploy/.env.example deploy/.env
openssl rand -hex 32
chmod 600 deploy/.env
```

Put the generated value in `SECRET_KEY` in `deploy/.env`. Set `APP_HOST`, `RENDER_HOST`, and `APP_URL` to your actual hostnames; `APP_URL` must be the public HTTPS origin. Keep `HCD_SEED_DEMO=0` for normal production deployments. Production startup rejects `HCD_SEED_DEMO=1` before opening the database. Use a non-production disposable instance for demos.

Start the app from the repository root:

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

The first production start creates no login account. Create an administrator with the bundled one-shot CLI, replacing the example identity and password with your own values:

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm app \
  node /app/cli.mjs user:add --email admin@example.com --name "HCD Admin" \
  --password 'replace-with-a-unique-password-of-at-least-10-characters' --admin
```

SQLite lives in the `hcd_data` volume. Back up that volume before replacing or removing it. Caddy's certificate and config data are kept in `caddy_data` and `caddy_config`.


The exporter image is pinned to Playwright 1.64.1 to match `package.json`; update both together. Its runtime is non-root, read-only except `/tmp`, with dropped capabilities and no-new-privileges. Chromium runs with JavaScript disabled, offline context and routed requests blocked. The Compose network is marked internal. These controls and the image startup have not been verified in a running container; do not treat the local fake PDF tests as deployment or document-fidelity acceptance.

Export results live in `DATA_DIR/exports` and expire after 24 hours. They are derivative files, not the source of truth. Include the SQLite database and `DATA_DIR/assets` in backups. The application needs outbound SMTP or the selected Feishu/Lark domains only when those integrations are configured. Space owners configure encrypted bot credentials in the app; `FEISHU_BASE_URL` selects the official Feishu or Lark host.

## Client IP addresses

The default Compose network uses `172.28.0.0/24`; `TRUST_PROXY` trusts that subnet so Caddy can forward client IPs for every IP rate limit. Change both values together if this subnet conflicts with your network. `TRUST_PROXY` accepts comma-separated IP addresses or CIDRs. Outside Compose, leave it unset for a directly exposed app port; forwarded headers are then ignored. Do not use a wildcard or trust all proxies.
