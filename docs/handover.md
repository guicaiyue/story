# 交接一页

写于 2026-11-12 夜，2026-11-13 更新为「已上线」，**2026-11-14 更新：1.0 静态站已退役**。
给三个月后的自己，或任何接手的人：**只需要读这一页，再按图索骥。**

---

## 一句话现状

2.0 服务端/运营后台在生产跑着（`api-story.xirizhi.cn` / `admin-story.xirizhi.cn`，HTTPS healthy，
证书到 **2027-02-09**）。**1.0 静态站已于 2026-11-14 彻底删除**（决策 D9）：容器、镜像、
部署目录、Traefik 路由都已清理，**仓库里的源码、根 Dockerfile、.dockerignore 和四个契约测试也删了**，
`story.xirizhi.cn` / `story-api.xirizhi.cn` 已下线。

**2026-11-23 更新（部署方式与 APK 链路都变了，旧的先忘掉）**：

- 服务端/后台 **0.1.2**；安卓客户端 **0.1.4+5**（tag `v0.1.4`）。
- **部署机不再放源码**。`/vol1/1000/docker/story/` 只有 `docker-compose.yaml` + `.env`，
  镜像从 Docker Hub 拉（`xirizhi/story-*:<commit sha>`）。
- **推 main 就是发布**：CI `check → image → deploy`，然后中台规则「小故事铺：自动上线」
  让 NAS 上的 dsh 执行 `pull → run --rm migrate → up -d → 验收`。
  回滚 = 改 `.env` 的 `STORY_TAG` 回上一个 sha。
- **APK 出包在 CI**（`.github/workflows/android.yml`），本机不需要 Flutter / Android SDK。
  签名材料唯一副本 `~/Documents/story-keystore/`（进 restic 日备）+ 4 个 GitHub secrets。
  旧 keystore 已丢失，2026-11-23 换新，从 0.1.3 起可持续升级。
- ⚠️ NAS 的 `/vol1/1000/story` 备份区（含 1.0 归档、旧 keystore、APK）**已不存在**。

## 三分钟上手

```bash
cd ~/Projects/story

./scripts/prod-deploy.sh status   # 只读：生产库 / 容器 / 域名

# 服务端/后台测试（要 pnpm + 能解析 story-dev-postgres）
docker start story-dev-postgres
./scripts/preflight.sh            # 迁移账本 + 服务端/后台测试
./scripts/preflight.sh --e2e      # 再加端到端 16 步（临时容器 + 副本库）
```

`preflight.sh` 自己会检测 `/.dockerenv`，不在容器里就早退并提示。
**它是开发期门禁，连的是开发库 `story-dev-postgres`，与 NAS 生产环境无关。**
（`story-preflight.timer` 从来没被创建过，别以为它在 NAS 上定时跑。）

## 已上线（2026-11-13）

| 项 | 结果 |
| --- | --- |
| 生产库迁移 | **5/5**（`story_main=2197`、`categories=14`、audio 表 2 张、`account.status`、唯一约束） |
| 库账号 | `story_app`（最小权限，`public` 无 CREATE，实测登录通过） |
| 生产账号 | 1 个 admin（`acc_prod_admin_01`，手机号**占位** `13800138000`，待换真号） |
| 容器 | `story-server-prod` / `story-admin-prod` 均 healthy，镜像 tag = commit sha（`xirizhi/story-*:<sha>`） |
| 版本 | 服务端/后台 **0.1.2**；客户端 **0.1.4+5**（tag `v0.1.4`，CI 出包，正式签名） |
| 执行记录 | `docs/product/24-prod-deploy-20261113.md`（首次上线）、`12-prod-deploy-runbook.md` §0（2026-11-23 起的镜像形态） |

## 还剩什么

| # | 事 | 谁做 | 依据 |
| --- | --- | --- | --- |
| ① | 管理员手机号换真号（一条 UPDATE） | 产品负责人 | `24-…md` §5 |
| ② | APK 真机验收（waydroid 已验过三 tab，真机未验） | 产品负责人 | 装机跑：登录→首页→播放→收藏→平板横屏 |
| ③ | 真实短信通道（现用固定码，非 123456） | 上架前 | `24-…md` §9 |

~~TLS 证书到期~~：已续期，现证书 `notAfter=2027-02-09`（三个域名同一张 `CN=xirizhi.cn`）。

**备份**：⚠️ NAS `/vol1/1000/story` 整个备份区**已不存在**（2026-11-23 实测），
`story-predeploy-20261113.dump`、旧 keystore、APK 归档、1.0 退役归档全都没了。
现在的 keystore 是 2026-11-23 新生成的，唯一副本 `~/Documents/story-keystore/`
（进 restic 日备 → C970 + NAS 两层），CI 另存 4 个 secrets。
**要恢复 1.0 源码只能从 git `499f138` 取。**

## 两处没做到的

1. **OpenDesign 出设计稿**：当时会话没有它的工具入口，改用「手写 HTML 原型 + 无头浏览器逐屏截图复核」。
   设计原型与截图已移出工作树，但**历史里还在**：`git archive c87b39f docs/design` 可取回 66 个文件，
   或解压 NAS `/vol1/1000/story/backup/src/design-assets.tar.gz`。
2. **用卡片指挥一个全新开发会话**：插件的执行层只把答复投回**提问的那个会话**
   （插件仓 `src/host/execution/session.ts`），没有「从卡片派生新会话」的能力。
   要补：加一个 `spawn` 适配器。这不是文案问题，是缺一块能力。

## 六个已经修掉的真缺陷（都有回归测试）

1. 一次工具调用问人两遍 → `Ask.key` 去重
2. blocking 提问在会话死后永不结束 → 6h 过期 + `ask:expired`
3. 账本原样存生产口令 → 落盘前脱敏
4. destructive 动作默认答案是「继续」→ 按 `effect` 推导默认
5. 拒绝后可能静默 → 零静默账本 + `/stats.silence`
6. （度量线，不是产品缺陷）测试污染真实账本 → `gateStats()` 在测试环境落 `os.tmpdir()`

## 最有用的一个数字

`noise.asks.autoRate = 1.0`：闸门六次判断「要不要问人」，**人一次都没答**，全部按默认收尾。
这就是「把提问时机从工具调用挪到回合末」这条设计的全部依据。

## 别再踩的坑

| 坑 | 表现 | 怎么办 |
| --- | --- | --- |
| 彩排库 ≠ 冒烟库 | `--e2e` 用彩排库时后台 4 步必然 403（那里没有管理员） | 用 `E2E_DB=story_e2e_seed` |
| 命令里 `pnpm` 找不到 | `docker exec ... sh -c 'pnpm'` 报 command not found | 用 `bash -lc` |
| 无头截图四连坑 | EACCES / 找不到 puppeteer / 屏与屏状态串 / 截到半截 | 出图脚本与原型已随 `docs/design/` 移出仓库，重做时从头搭 |
| 面板 API 401 | 少登录 cookie | `docker logs dsh-dev \| grep token=` 取 URL 换 cookie，见插件仓 `dsh-plugins/dsh-task-cards/docs/commands.md` |
| 度量被测试污染 | 数字莫名其妙涨 | 计数器写盘前先隔离测试环境（Horon 122） |

## 文档入口

- **总索引**：`docs/README.md`
- 目标对账（含未达成项）：`docs/product/22-objective-audit.md`
- 收尾验证（当场数字）：`docs/product/23-final-verification.md`
- 上线记录（已执行）：`docs/product/24-prod-deploy-20261113.md`
- 上线清单（历史）：`docs/product/20-approval-sheet.md`
- 进度与介入记录：`docs/product/18-progress-log.md`
- 长期记忆（Horon）：节点 121 项目 / 122 度量隔离 / 123 截图验收
- 插件仓文档：`dsh-plugins/dsh-task-cards/docs/` 下的 `commands.md`（怎么用 CLI 看面板/拍快照）、`contracts.md`（契约）、`reviews/`（复盘）

## 交接时的一句话建议

**域名现在真的打得开了**——先装 0.1.2 的 APK 上真机走一遍（登录→听故事→收藏→平板横屏），
这一步只有真机能验。之后才是换管理员真号、接短信通道。
别在没有备份的情况下动生产；备份与回滚步骤都在 `24-prod-deploy-20261113.md` §10。
提交与发版这两件事 2026-11-13 已经做完，不用再排进计划。
