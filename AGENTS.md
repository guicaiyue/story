# AGENTS.md — 小故事铺（story）

面向儿童与家庭的在线故事阅读平台。**本文件只写下次 Agent 不看到就会犯错的事**；
怎么用、怎么运维看 [README.md](README.md) 和 [docs/README.md](docs/README.md)。

## 一句话定位

单库 monorepo，生产只部署 **2.0 服务端与运营后台**（`apps/`）。1.0 静态站（根目录）**已于 2026-11-14 退役**，源码留存可查，不再构建发布。
Flutter 客户端已移出仓库。

## 怎么跑

```bash
# 1.0 静态站本地开发（零依赖，Node 18+；1.0 已退役，仅源码查阅用）
node scripts/dev-server.js                  # → http://127.0.0.1:5173

# 契约测试（CI 同款，四个都要过）
node test-umami-tracker.js && node test-prest-client.js \
  && node test-story-analytics.js && node test-edge-tts-analytics.js

# 服务端/后台测试 —— 必须在开发容器里跑
docker exec dsh-dev bash -lc 'cd /workspace/story && ./scripts/preflight.sh'

# 生产状态（只读）
./scripts/prod-deploy.sh status
```

## 技术栈

| 层 | 栈 | 生产入口 |
| --- | --- | --- |
| 1.0 静态站（**已退役**） | 原生 HTML/CSS/JS + pREST 直连 Postgres | 已下线，不再有生产入口 |
| 服务端 | Node 22 + TS + Fastify 5 + Prisma 6 + zod | `api-story.xirizhi.cn` |
| 运营后台 | React 18 + Vite + TS + Ant Design 5 | `admin-story.xirizhi.cn` |

## 目录与约定

```
apps/server      服务端（136 测试）
apps/admin       运营后台（63 测试，镜像内 nginx）
apps/server/scripts  迁移执行器、开发种子、端到端冒烟
scripts/         宿主侧脚本（preflight 预检、prod-deploy 上线一条龙）
docs/product     产品、决策、上线、发布（档案性质，读前看状态头）
```

## 五条硬约束（踩过坑才写下来）

1. **根 `.dockerignore` 必须是白名单**。根 `Dockerfile` 是 `COPY . /usr/share/nginx/html`，
   一旦放宽，`apps/`、`docs/` 源码会直接发布到公网 web 根目录。
2. **`js/app.js` 曾是 1.0 线上主逻辑**（1.0 已退役，这套 JS 不再部署）。`js/appJs.js` 是未引用的
   并存实现（常量都不同）；真要恢复 1.0 前，先确认改的是哪个文件。
3. **镜像构建只能用 alpine 基础镜像 + 官方 `registry.npmjs.org`**。
   本机 registry 源不给 Debian tag；npmmirror 从构建容器不可达。详见 README「构建期的四个坑」。
4. **生产库 `story` 只读**。写操作走 runbook 里标注「需批准」的步骤；开发一律用 `story-dev-postgres`。
5. **推 `main` 现在只跑契约测试，不发布任何东西**（2026-11-14 1.0 退役后，构建镜像那步已删）。
   2.0 上线必须手动跑 `./scripts/prod-deploy.sh`。反过来说：别再以为「推上去就等于上线了」，
   改完 `apps/` 不跑 prod-deploy，生产还是旧代码。

## 当前状态（2026-11-14）

- 唯一分支 `main`，唯一版本 **0.1.2**，唯一 tag `v0.1.2`，唯一 GitHub Release。
- 生产在跑：**服务端 / 后台两个**域名 200，容器 `story-server-prod` / `story-admin-prod` healthy，
  TLS 到 2027-02-09。1.0 静态站已于 2026-11-14 退役（决策 D9），`story.xirizhi.cn` 返回 404 是正常的。
- 待办：管理员手机号换真号、APK 真机验收、接真实短信通道。
- 已知遗留：`story-dev-postgres` 上只剩 `story_dev` / `story_test` / `story_e2e_seed` 三个库，演练库已清完
  （`story_e2e_seed` 是 `preflight --e2e` 的种子库，**别删**）。
