# Build on the server, run via docker compose (see kb/plans/2026-07-02-nce-class-deploy.md).
# Runtime = server (tsx, no build step) + web/dist (extracted to the host for Caddy by deploy/release.sh).
FROM node:22-bookworm-slim AS base
# pnpm 11：构建白名单在 pnpm-workspace.yaml 的 allowBuilds（f6a23e9 迁移后
# pnpm 10 不认它，better-sqlite3 的 native 编译会被静默跳过，migrate 起不来）
RUN npm install -g pnpm@11.15.1
WORKDIR /app

FROM base AS build
# python3/make/g++: fallback toolchain in case better-sqlite3 has no prebuilt binary for this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
COPY miniapp/package.json miniapp/
RUN pnpm install --frozen-lockfile --filter server --filter web
COPY server/ server/
COPY web/ web/
RUN pnpm --filter web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 5177
CMD ["pnpm", "--filter", "server", "start"]
