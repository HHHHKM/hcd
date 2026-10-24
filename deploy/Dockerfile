# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Bundle the TypeScript server entrypoints so the runtime image only needs Node
# and production dependencies. Third-party packages (including better-sqlite3)
# remain external and are installed in the production dependency tree below.
RUN set -eu; \
  esbuild_bin="$(find node_modules/.pnpm -path '*/esbuild/bin/esbuild' -type f -print -quit)"; \
  test -n "$esbuild_bin"; \
  mkdir -p /app/server-build; \
  "$esbuild_bin" packages/server/src/main.ts --bundle --platform=node --format=esm --packages=external --outfile=/app/server-build/main.mjs; \
  "$esbuild_bin" packages/server/src/cli.ts --bundle --platform=node --format=esm --packages=external --outfile=/app/server-build/cli.mjs; \
  "$esbuild_bin" packages/server/src/change-worker.ts --bundle --platform=node --format=esm --packages=external --outfile=/app/server-build/change-worker.mjs

# Keep only production dependencies in the image copied to the runtime stage.
RUN pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_ROOT=/app/dist \
    HCD_SEED_DEMO=0

WORKDIR /app
RUN groupadd --system --gid 10001 hcd \
  && useradd --system --uid 10001 --gid hcd --no-create-home hcd \
  && mkdir -p /data \
  && chown hcd:hcd /data

COPY --from=build --chown=hcd:hcd /app/node_modules ./node_modules
COPY --from=build --chown=hcd:hcd /app/dist ./dist
COPY --from=build --chown=hcd:hcd /app/server-build/main.mjs ./server.mjs
COPY --from=build --chown=hcd:hcd /app/server-build/cli.mjs ./cli.mjs
COPY --from=build --chown=hcd:hcd /app/server-build/change-worker.mjs ./change-worker.mjs

USER hcd
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/server.mjs"]
