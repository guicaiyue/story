# 小故事铺 2.0 · 运营后台镜像（M4 打包）
#
# 多阶段：base(pnpm) → build(vite build + tsc) → runtime(nginx:alpine，只放静态产物)。
# 后台是纯静态站点，运行层不需要 node。
#
# 构建上下文是**仓库根目录**（monorepo），用同目录的 Dockerfile.dockerignore 隔离，
# 避免把 apps/server/.audio-cache（537MB）、node_modules 等传进 daemon。

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine
# registry 默认官方 npmjs（理由见 apps/server/Dockerfile 同名 ARG）。
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_VERSION=11.20.0

# ---------------------------------------------------------------------------
# base
#
# pnpm 用 corepack 装（见 apps/server/Dockerfile 同名说明）：
# `npm install -g pnpm` 要经 registry 取 pnpm，而本机 npmmirror 从容器里不可达。
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG NPM_REGISTRY
ARG PNPM_VERSION
# CI=true + 关掉 deps 检查：pnpm 在无 TTY 的构建环境里会在 `pnpm run` 前尝试
# purge node_modules 并 abort（ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY）。
ENV CI=true \
    npm_config_verify_deps_before_run=false \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    corepack enable \
 && COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    corepack prepare pnpm@${PNPM_VERSION} --activate \
 && pnpm --version

# ---------------------------------------------------------------------------
# build — 安装（含 devDeps：vite/tsc 都在 devDependencies）后构建静态产物
# ---------------------------------------------------------------------------
FROM base AS build
ARG NPM_REGISTRY
WORKDIR /app
# registry 与 verify-deps 写进项目 .npmrc（`pnpm run` 前的隐式依赖检查 install
# 不读命令行 --registry）。node-linker 必须走命令行 --config.*：pnpm 11 不从
# .npmrc 读 node-linker（详见 apps/server/Dockerfile 同名说明）。
RUN printf 'registry=%s\nverify-deps-before-run=false\nfetch-timeout=600000\nfetch-retries=5\nfetch-retry-maxtimeout=120000\n' "${NPM_REGISTRY}" > /app/.npmrc
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/admin/package.json apps/admin/
RUN --mount=type=cache,target=/pnpm-store,id=story-pnpm-store \
    pnpm install --frozen-lockfile \
      --config.node-linker=hoisted \
      --config.store-dir=/pnpm-store \
      --filter @story/admin
COPY apps/admin/index.html apps/admin/tsconfig.json apps/admin/vite.config.ts apps/admin/
COPY apps/admin/src apps/admin/src
COPY apps/admin/public apps/admin/public

# VITE_API_BASE 留空 = 同源，前端请求 /api/*，由下面 nginx 反代到 server。
# 这是容器里的默认形态：admin 与 server 同机同源，不需要 CORS。
ARG VITE_API_BASE=""
ENV VITE_API_BASE=${VITE_API_BASE}
# 挂同一个 store 缓存：即便依赖检查仍触发一次 install，也走本地 store 而不是网络。
RUN --mount=type=cache,target=/pnpm-store,id=story-pnpm-store \
    pnpm --filter @story/admin run build \
 && test -f /app/apps/admin/dist/index.html \
 && echo "admin build OK"

# ---------------------------------------------------------------------------
# runtime — nginx 只服务静态文件 + 反代 /api
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
# wget 由 busybox 提供，健康检查用它。
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
