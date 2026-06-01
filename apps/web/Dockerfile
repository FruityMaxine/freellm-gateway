# FreeLLM Web（vite 构建 → nginx 静态分发）。
# 构建上下文必须为 monorepo 根目录：
#   docker build -f apps/web/Dockerfile -t freellm-web:0.9.2 .

# ───── stage 1: build（pnpm 装依赖 + vite 产 dist）─────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @freellm/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @freellm/shared run build && pnpm --filter @freellm/web run build

# ───── stage 2: runtime（nginx 静态 + SPA 回退）─────
FROM nginx:1.27-alpine AS runner
RUN apk add --no-cache wget
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --tries=1 --spider http://127.0.0.1:8080/ || exit 1
