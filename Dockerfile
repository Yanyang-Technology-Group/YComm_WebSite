# syntax=docker/dockerfile:1
#
# Single-image deployment: the whole application (Next.js + embedded Hono API +
# schema + migrations) runs in one container; Postgres runs alongside via
# docker-compose. Image size is traded for simplicity and debuggability on
# purpose — this is a self-hosted community site, not a distroless SaaS.
#
# AGPL note: the source tree is intentionally left in the image, which also
# satisfies the "corresponding source" obligation for network users.
#
# Base image comes from a China-reachable Docker Hub mirror (DaoCloud syncs the
# official library) because many self-hosted CN servers cannot pull
# docker.io/library/node fast enough. Swap back to node:22-bookworm-slim if
# your network has direct Hub access.

FROM docker.m.daocloud.io/library/node:22-bookworm-slim

WORKDIR /app

# Install once; cache the layer by copying manifests first.
ENV NPM_CONFIG_CACHE=/tmp/npm-cache
COPY package.json package-lock.json ./
COPY config/package.json config/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/kernel/package.json packages/kernel/
COPY packages/db/package.json packages/db/
COPY packages/access/package.json packages/access/
COPY packages/audit/package.json packages/audit/
COPY packages/downloads/package.json packages/downloads/
COPY packages/forum/package.json packages/forum/
COPY packages/identity/package.json packages/identity/
COPY packages/jobs/package.json packages/jobs/
COPY packages/moderation/package.json packages/moderation/
COPY packages/notify/package.json packages/notify/
RUN npm ci --ignore-scripts --no-audit --no-fund

# Build the Next.js production bundle (turbopack).
#
# 版本号由 release workflow 传入（镜像里没有 .git，无法自己数提交数）；
# 未传时 next.config.ts 会退化成「日期」而不报错。
ARG APP_VERSION=
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
COPY . .
RUN npm run build

# Custom Node server (tsx runtime retained above) serves Next HTTP + /api/ws.
# Do not switch to `next start` or standalone output: they bypass WS upgrades.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker/entrypoint.sh"]