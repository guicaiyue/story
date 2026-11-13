# AGENTS.md — 小故事铺（story）

面向儿童与家庭的在线故事阅读平台。**本文件只写下次 Agent 不看到就会犯错的事**；
怎么用、怎么运维看 [README.md](README.md) 和 [docs/README.md](docs/README.md)。

## 一句话定位

单库 monorepo，只有 **服务端与运营后台**（`apps/`）。1.0 静态站**已于 2026-11-14 彻底删除**（决策 D9），
源码、根 Dockerfile、.dockerignore、四个契约测试全没了。Flutter 客户端早已移出仓库。

## 怎么跑

```bash
# 服务端/后台测试 —— 必须在开发容器里跑（CI 也跑不了服务端测试：要 Postgres）
docker exec dsh-dev bash -lc 'cd /workspace/story && ./scripts/preflight.sh'

# 生产状态（只读）
./scripts/prod-deploy.sh status
```

## 技术栈

| 层 | 栈 | 生产入口 |
| --- | --- | --- |
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

1. **两个 app 各自用 `Dockerfile.dockerignore`，不是根 `.dockerignore`**。构建上下文是仓库根，
   `apps/server/` 与 `apps/admin/` 下各有一份白名单，只放行自身构建必需的路径。
   2.0 构建时根 `.dockerignore` 已被删除，不要再造一个——它当年是给 1.0 的 `COPY .` 用的。
2. **`js/` 与 `index.html` 已不存在**。如果你在找它们，说明在看旧文档或旧分支；1.0 源码在
   NAS `backup/retire-1.0-20261114-000508/story-1.0-source-*.tar.gz` 和 git 历史里。
3. **镜像构建只能用 alpine 基础镜像 + 官方 `registry.npmjs.org`**。
   本机 registry 源不给 Debian tag；npmmirror 从构建容器不可达。详见 README「构建期的四个坑」。
4. **生产库 `story` 只读**。写操作走 runbook 里标注「需批准」的步骤；开发一律用 `story-dev-postgres`。
5. **推 `main` 只跑 CI 静态检查（类型检查 + 后台单测），不发布任何东西**。
   2.0 上线必须手动跑 `./scripts/prod-deploy.sh`。反过来说：别再以为「推上去就等于上线了」，
   改完 `apps/` 不跑 prod-deploy，生产还是旧代码。服务端有 136 个测试但 CI 跑不了（要 Postgres），
   真正的门禁是 NAS 上那个 `story-preflight.timer`（每 6 小时）。

## 当前状态（2026-11-14）

- 唯一分支 `main`，唯一版本 **0.1.2**，唯一 tag `v0.1.2`，唯一 GitHub Release。
- 生产在跑：**服务端 / 后台两个**域名 200，容器 `story-server-prod` / `story-admin-prod` healthy，
  TLS 到 2027-02-09。1.0 已彻底删除（D9），`story.xirizhi.cn` 返回 404 是正常的。
- 待办：管理员手机号换真号、APK 真机验收、接真实短信通道。
- 已知遗留：`story-dev-postgres` 上只剩 `story_dev` / `story_test` / `story_e2e_seed` 三个库，演练库已清完
  （`story_e2e_seed` 是 `preflight --e2e` 的种子库，**别删**）。
