# FreeLLM API （Node 22 alpine multistage · 非 root · healthcheck）。
# 构建上下文必须为 monorepo 根目录：
#   docker build -f apps/api/Dockerfile -t freellm-api:0.9.2 .

# ───── stage 1: deps（缓存 pnpm 依赖图）─────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
    && apk add --no-cache openssl
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/provider-core/package.json packages/provider-core/
COPY packages/routing-core/package.json packages/routing-core/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --filter @freellm/api...

# ───── stage 2: build（编译 TS + 生成 Prisma client）─────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
    && apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @freellm/shared run build \
    && pnpm --filter @freellm/provider-core run build \
    && pnpm --filter @freellm/routing-core run build \
    && pnpm --filter @freellm/api run build \
    && pnpm prisma:generate

# ───── stage 3: runtime（精简产物 + 非 root + healthcheck）─────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    FREELLM_NODE_ENV=production \
    FREELLM_API_HOST=0.0.0.0 \
    FREELLM_API_PORT=3001
RUN apk add --no-cache wget openssl tini ca-certificates \
    && addgroup -S freellm -g 1001 \
    && adduser -S freellm -G freellm -u 1001 -h /app -s /sbin/nologin
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=build --chown=freellm:freellm /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=freellm:freellm /app/prisma ./prisma
COPY --from=build --chown=freellm:freellm /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=freellm:freellm /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=freellm:freellm /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=freellm:freellm /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=freellm:freellm /app/packages/provider-core/dist ./packages/provider-core/dist
COPY --from=build --chown=freellm:freellm /app/packages/provider-core/package.json ./packages/provider-core/
COPY --from=build --chown=freellm:freellm /app/packages/routing-core/dist ./packages/routing-core/dist
COPY --from=build --chown=freellm:freellm /app/packages/routing-core/package.json ./packages/routing-core/
RUN pnpm install --prod --frozen-lockfile --filter @freellm/api... \
    && mkdir -p /app/data && chown -R freellm:freellm /app/data /app/node_modules
USER freellm
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --tries=1 --spider http://127.0.0.1:3001/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
