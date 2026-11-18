# 小故事铺 2.0 · 服务端镜像（M4 打包）
#
# 多阶段：base(工具链) → deps(全量依赖) → build(tsc + prisma generate)
#              → prod-deps(仅运行依赖) → runtime(node22-alpine)。
#
# 为什么用 alpine：本机 Docker 的 registry 镜像源（docker.fnnas.com）只提供
# alpine 系 tag，Debian 系 tag 会 401（见 M4 报告）。
#
# 构建上下文是**仓库根目录**（monorepo 需要 pnpm-workspace.yaml + lockfile），
# 用同目录的 Dockerfile.dockerignore 把上下文从 1.4GB 压到几百字节。

ARG NODE_IMAGE=node:22-alpine
# 依赖安装用官方 registry.npmjs.org。
# registry.npmmirror.com 从构建容器里不可达（curl 000 / 500，ER_NO_SUCH_TABLE），
# 不能用。npmjs 可用但**速度波动大**：同一份 prisma 17.6MB tarball 两次实测
# 分别是 >90s（pnpm 报 error 23 / TimeoutError）和 35s，所以下面把
# fetch-timeout 放宽到 10min，避免在大包上随机超时。
# 换源：NPM_REGISTRY=<url> docker compose -f docker-compose.m4.yml build
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_VERSION=11.20.0

# ---------------------------------------------------------------------------
# base — pnpm（用 corepack 装）
#
# pnpm 走 corepack（node 自带），不走 `npm install -g`。
# corepack 直接连 registry.npmjs.org —— 与上面的 NPM_REGISTRY 同源，所以这里
# 用 ${NPM_REGISTRY} 即可；若把 NPM_REGISTRY 换成第三方镜像，corepack 可能
# 拒收其 dist 元数据（实测 huaweicloud 会报 "does not have a valid tarball"），
# 那种情况下需要把这两行改回写死 registry.npmjs.org。
#
# 装 openssl：apk 默认源 dl-cdn.alpinelinux.org 可达（实测 apk update OK，
# 28670 packages available），不需要换 aliyun 镜像。
# 其实 node:22-alpine 自带 libssl.so.3 / libcrypto.so.3（Prisma musl 引擎所需），
# 显式装上 openssl 是为了把这层依赖写明，不依赖基础镜像的偶然内容。
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG NPM_REGISTRY
ARG PNPM_VERSION
# CI=true：pnpm 在无 TTY 的构建环境里跑 `pnpm run` 前会做一次依赖状态检查，
# 发现不一致就想 purge node_modules，而无 TTY 时直接 abort
# （ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY）。
ENV CI=true \
    npm_config_verify_deps_before_run=false \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache openssl \
 && COREPACK_NPM_REGISTRY=${NPM_REGISTRY} corepack enable \
 && COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    corepack prepare pnpm@${PNPM_VERSION} --activate \
 && pnpm --version

# ---------------------------------------------------------------------------
# deps — 全量依赖（含 devDependencies：构建期要 tsc / prisma CLI）。
#
# node-linker / store-dir 必须用**命令行** --config.* 传，不能只写 .npmrc：
# pnpm 11 不从 .npmrc 读 node-linker（实测 .npmrc 里写了 hoisted，出来的
# .modules.yaml 仍是 nodeLinker: isolated）。用 isolated 时依赖只落在
# apps/server/node_modules 的符号链接上，运行时 COPY 根 node_modules 会拿到
# 一个空壳。用 hoisted 才是可整棵拷走的普通目录树。
#
# prisma/ 必须在 install 之前就位：package.json 的 postinstall 是
# `prisma generate`，缺 schema 会直接失败。
# ---------------------------------------------------------------------------
FROM base AS deps
ARG NPM_REGISTRY
WORKDIR /app
# .npmrc 里放 registry 与「关掉 deps 检查」—— 这两个 pnpm 认。
# 尤其是 verify-deps-before-run=false：不关掉的话，后面 build 阶段的
# `pnpm exec` 会隐式触发一次依赖检查式 install，重装整个依赖树
# （实测日志里 "Recreating /app/node_modules"），白走一次网络。
#
# fetch-timeout / fetch-retries 也写在这里：npmjs 对 prisma 这种 17.6MB 大包
# 速度波动很大（实测 35s 到 >90s 都有），默认 60s 超时会让构建随机失败
# （pnpm 报 error 23 / TimeoutError）。放宽后大包不再随机中断。
RUN printf 'registry=%s\nverify-deps-before-run=false\nfetch-timeout=600000\nfetch-retries=5\nfetch-retry-maxtimeout=120000\n' "${NPM_REGISTRY}" > /app/.npmrc
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
RUN --mount=type=cache,target=/pnpm-store,id=story-pnpm-store \
    pnpm install --frozen-lockfile \
      --config.node-linker=hoisted \
      --config.store-dir=/pnpm-store \
      --filter @story/server

# ---------------------------------------------------------------------------
# build — 编译 TS，并在 alpine 上重新生成 Prisma Client（= musl 查询引擎）
# ---------------------------------------------------------------------------
FROM deps AS build
ARG NPM_REGISTRY
WORKDIR /app
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
RUN pnpm --filter @story/server exec prisma generate \
 && pnpm --filter @story/server run build \
 && test -f /app/apps/server/dist/src/index.js \
 && test -f /app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node \
 && echo "build OK: dist + musl query engine present"

# ---------------------------------------------------------------------------
# prod-deps — 只装运行依赖。
# postinstall（prisma generate）必须跳过：prisma CLI 是 devDependency，
# 生产安装里没有它，不跳过会 `prisma: not found` 而失败。
# 查询引擎不依赖 @prisma/engines 的下载脚本 —— 运行用的是下面从 build 阶段
# 拷进 node_modules/.prisma 的那份。
# ---------------------------------------------------------------------------
FROM base AS prod-deps
ARG NPM_REGISTRY
WORKDIR /app
# auto-install-peers=false：不加这行，pnpm 会把 workspace 里其它包（后台的
# antd/react 等）当作 peer 一并装进来 —— 服务端镜像里出现 antd 就是这么来的。
RUN printf 'registry=%s\nverify-deps-before-run=false\nauto-install-peers=false\nfetch-timeout=600000\nfetch-retries=5\nfetch-retry-maxtimeout=120000\n' "${NPM_REGISTRY}" > /app/.npmrc
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
RUN --mount=type=cache,target=/pnpm-store,id=story-pnpm-store \
    pnpm install --prod --ignore-scripts \
      --config.node-linker=hoisted \
      --config.store-dir=/pnpm-store \
      --filter @story/server \
 && test -d /app/node_modules/@prisma/client \
 && echo "prod-deps OK: @prisma/client present"

# 运行期不需要的构建期工具（prisma CLI / tsc / vitest 依赖树）。
# 实测这些合计约 120MB，且没有任何一条运行路径会 require 它们：
# 迁移由 scripts/migrate.mjs 在宿主/CI 上跑，查询引擎在下面单独 COPY 进来。
RUN rm -rf \
      /app/node_modules/prisma \
      /app/node_modules/@prisma/engines \
      /app/node_modules/@prisma/fetch-engine \
      /app/node_modules/@prisma/get-platform \
      /app/node_modules/typescript \
      /app/node_modules/effect \
      /app/node_modules/fast-check \
      /app/node_modules/jiti \
      /app/node_modules/tsx \
      /app/node_modules/vitest \
 && echo "pruned build-only deps"

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# 装上 openssl：apk 默认源可达（见 base 阶段说明），与 base 保持一致，
# 不依赖基础镜像恰好自带 libssl。健康检查用 busybox 自带 wget，不装 curl。
RUN apk add --no-cache openssl

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    AUDIO_CACHE_DIR=/data/audio-cache

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
# 生成的 Prisma Client（含 musl 查询引擎），必须在 @prisma/client 之后覆盖进去。
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/server/dist ./dist
COPY apps/server/package.json ./package.json
COPY apps/server/prisma ./prisma

# 音频缓存目录（MP3 落盘，不进 Postgres）。先建好并 chown 给 node：
# Docker 首次创建**命名卷**时会继承镜像里该目录的属主，所以 node 用户可写。
RUN mkdir -p /data/audio-cache && chown -R node:node /app /data/audio-cache

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

# index.ts 自己处理 SIGINT/SIGTERM，无需 tini。
CMD ["node", "dist/src/index.js"]
