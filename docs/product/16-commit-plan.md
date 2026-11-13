# 16 · 提交方案（**已于 2026-11-13 执行**）

日期：2026-11-12　状态：已执行完毕

> **执行结果**：5 个提交按本方案落地，落在 `feat/platform-v2` 上并以 fast-forward
> 合并进 `main`（`7b9d091..43eaa3c`）。随后按「仓库只保留生产 docker 部署的后端与
> web 端」清理了 `apps/app` 与开发用联调栈。
>
> §5 的 tag 方案选了 **A（删旧重打）**：`v0.1.1` 已重打到 `43eaa3c` 并发布 GitHub Release。
> 注意本 APK 对应的 Flutter 源码（`0.1.1+2`）当时未提交，不在仓库历史中。
背景：`v0.1.1` tag 指向的提交里**没有 App 源码，也没有 APK**（`git ls-tree v0.1.1` 只有 1.0 的静态站：
`index.html` / `css` / `js` / `docker` / `scripts`…）。按现状发 GitHub release，线上会出现「有 tag 无内容」。

## 1. 现状盘点（`git status --porcelain -uall`）

| 项 | 数量 / 体积 |
| --- | --- |
| 未跟踪条目 | 13 个（展开后 **218 个文件**） |
| 其中 `apps/` | 143 个（server 27 + admin 26 + app 40 + 配置） |
| 其中 `docs/` | 62 个（产品文档、设计原型、截图） |
| 其中 `scripts/` | 3 个（m4 演练与指标脚本） |
| 其中 `releases/` | 3 个（两个 APK 共 **98MB** + sha256） |
| 已跟踪但被修改 | `.gitignore`（+22）、`README.md`（+183） |
| 被忽略规则挡住、**不会进库** | `node_modules` 1.1G、`apps/app/build` 1.1G、`apps/admin/dist`、`apps/server/dist`、`.m4-rehearsal`、`.shots` |

## 2. 安全检查（已做，结论：可以提交）

| 检查 | 结果 |
| --- | --- |
| 已知生产口令（`postgres` 超级用户，值不入档） | **0 处**（源码里的硬编码回退已在 11-12 修掉） |
| 泛化密钥扫描（`password/secret/token/api_key = …`） | 命中 10 个文件，逐条看过，全是占位符或测试值：`.env.example`=`change-me-…`、`.env.prod.example`=`CHANGE_ME_…`、`*.test.ts` 里的 `test-secret-value-at-least-16` |
| 唯一需要你知道的 | `apps/server/README.md` 里有 `POSTGRES_PASSWORD=storydev_local_only` —— 这是**联调库**口令，与 dev compose 一致；要更干净可以改成 `CHANGE_ME` |
| `.env` / `.env.prod` | 被 `.gitignore` 挡住，不会进库 |

## 3. 建议：APK 不进 git，走 release 附件

`releases/*.apk` 共 98MB，进 git 会永久留在历史里且每次 clone 都要拉。建议：

- **不进 git**：在 `.gitignore` 加一行 `releases/*.apk`；
- 发布时作为 GitHub release 的**附件**上传（网页操作，本来就要你点）；
- 仓库里只保留 `releases/*.sha256` 与 `release-notes`，可追溯、可校验。

## 4. 提交拆分（5 个，按顺序，每个都能单独回滚）

```
① chore(repo): 忽略生产环境变量与构建产物，README 补 2.0 说明
   .gitignore  README.md

② feat(server): M1 API（内容/播放/用户/音频/后台）+ 迁移与测试
   apps/server  pnpm-workspace.yaml  pnpm-lock.yaml
   ⚠️ 提交前确认 apps/server/.env 不在列表里（已被忽略）

③ feat(admin): 运营后台（登录/故事/审核/家庭/分析/系统）
   apps/admin

④ feat(app): Flutter 客户端 0.1.1（含平板适配）+ 构建说明
   apps/app（build/ 已忽略）

⑤ docs: 产品文档、设计原型与上线 runbook；脚本入库
   docs/  scripts/  docker-compose.m4.yml  docker-compose.prod.yml
   docker/nginx  .env.example  .env.prod.example  releases/*.sha256
```

对应的命令（**等你说「提交」我再跑**）：

```bash
cd /vol1/1000/开发/NAS/story
printf 'releases/*.apk\n' >> .gitignore
# 然后逐条 add/commit（每批只加自己那部分，避免一把全加）
```

## 5. tag 怎么处理（这个也要你定）

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A（推荐） | 提交完成后再打 **`v0.1.1`（删旧重打）**，指向新提交；再发 release | 旧 tag 未推送，删除无影响 |
| B | 保留旧 `v0.1.1`，另发 `v0.1.2` | 版本号跳号，但历史不动 |
| C | 不动 tag，release notes 里写明「源码见 main」 | 最简单，但 tag 与内容不一致这件事没解决 |

## 6. 为什么现在只给方案不动手

提交会改写仓库历史（新提交、可能重打 tag），属于**不可逆**动作；而且它会决定
「GitHub 上别人能看到什么」。按既定约束，这类动作要你明确同意后我才执行。
