---
name: story-release
description: 给小故事铺发一版：推 main → 核 CI 三段 → 核线上。中台把「小故事铺：发布」派过来、收到 story.publish 时使用；用户说「上线小故事铺」「发一版」「推上去」时也用。
---

# 小故事铺：发布

**第一步先加载 `pipeline-release`**：发之前先确认、一次推、核产物、坏了怎么办都在那边。这一份只写**本项目跟母本不一样的地方**。

## 本项目的发布形状（跟母本默认不一样，按这里）

- **没有 tag 发布，也没有 `npm version`**：推 `main` 就是发布。`ci.yml` 三段：
  `check`（两端类型检查 + 后台单测）→ `image`（推 `xirizhi/story-server:<sha>`、`xirizhi/story-admin:<sha>`）→
  `deploy`（发 `story.deploy`，等 NAS 回话）。
- **上线事件由 CI 的 `deploy` job 自己发**（`story.deploy:<repo>:<sha>`）。你在回执里**不要再发一条**：
  同 id 会被中台吞掉，不同 id 会让 NAS 装两次。发布轮只核，不重发。
- **bump 只在两种情况下做**：① 改了 `apps/app/**` → `apps/app/pubspec.yaml` 的 `version:`（APK 出包与 Release 附件由 `android.yml` 按 versionName 做）；
  ② 真要改服务端/后台的语义版本 → 连 `apps/server/package.json`、`/api/health` 的期望与 `tests/content.test.ts` 一起改。
  其余情况版本号不动，也别造一个「chore: release」空提交。

## 发之前

1. 这一轮来自 `story.publish`，检查的 summary 里该有五问证据。没有就 `ask`，别替它点头。
2. `git status --short` 必须空；`git fetch && git log --oneline origin/main..main` 只该有这一批提交。
3. **自己再跑一遍** `./scripts/gate.sh`（不看别人的数字）。服务端 136 用例的完整门禁是 `./scripts/preflight.sh`（开发容器里跑）——
   这一版动到迁移或服务端逻辑时，preflight 必须先过；没跑就写清为什么不用跑。
4. 推之前问一句：这一批里有没有 `apps/app/**`？有就要先把 `pubspec.yaml` 的版本号定下来，否则 APK 会用旧版本名重发。

## 一次推

```bash
git push origin main          # 不要 --tags：这个仓库没有版本 tag 的发布链路
```

## 核产物三条（不看绿勾，核这三条）

1. `ci.yml` 的 `deploy` job 结束时摘要必须是「**上线了…**」或「**没事可做…**」——脚本只认这两个前缀，
   其余（含空、含「没上线：…」）直接红。**CI 绿但摘要是别的，等于没上线。**
2. Docker Hub 上 `xirizhi/story-server:<sha>` 与 `xirizhi/story-admin:<sha>` 都在（sha 用完整 40 位，别用短 sha 猜 tag）。
3. 线上：`https://api-story.xirizhi.cn/api/health` 200 且 `data.version` 等于 `apps/server/package.json` 的 version；
   `https://admin-story.xirizhi.cn/` 200；容器 `story-server-prod` / `story-admin-prod` 都 healthy。

`./scripts/prod-deploy.sh status` 是**只读**的，本机就能跑，它一次打印生产库计数、两个容器状态和两个域名状态码。

## 改了 `apps/app/**` 时另加一步

等 `android.yml` 的 Release 出来：tag 形如 `v<versionName>`，附件是签过名的 APK。
签名材料唯一副本在 `~/Documents/story-keystore/`，CI 从 4 个 `ANDROID_*` secrets 取——**不要在本机重签**。

## 交棒

- `resolve` 掉检查那张卡（reason 写「已发布 <sha 前 7 位>」）；自己不再另发卡，`tell: always` 会把结论发成通知。
- 装失败不归你：NAS 侧失败走 `ops.failed`，由「运维：ops 失败检修（NAS）」查根因。
- 回滚 = 改 NAS `.env` 的 `STORY_TAG` 回上一个 sha 再 `pull` + `up -d`；不是删镜像、也不是重推。

## 高危，先问人

改 `ci.yml` / `Dockerfile*` / `.env.prod` / `docker-compose.prod.yml`、动生产库、动签名材料：先 `ask`。
