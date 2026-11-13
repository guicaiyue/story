# 交接一页

写于 2026-11-12 夜，**2026-11-13 上午更新为「已上线」**。给三个月后的自己，或任何接手的人：**只需要读这一页，再按图索骥。**

---

## 一句话现状

三端做完、测试全绿、**生产已上线**（`api-story.xirizhi.cn` / `admin-story.xirizhi.cn`，HTTPS healthy）、
0.1.2 APK 已用**正式签名**出包。两处没做到的地方（OpenDesign 出稿、卡片派生新会话）写在下面，不藏着。

## 三分钟上手

```bash
cd /vol1/1000/开发/NAS/story

./scripts/preflight.sh          # 迁移账本 + 三端测试（~80s）
./scripts/preflight.sh --e2e    # 再加端到端 16 步（临时容器 + 副本库）
./scripts/design-shots.sh       # 三份原型 → 17 张 PNG

cd ../dsh-plugins/dsh-task-cards
./scripts/preflight.sh          # pnpm verify + 度量快照
```

生成物：`docs/design/screenshots/{phone,tablet,admin}/`；插件仓那边产出 `docs/metrics/<日期>.json` 与 `docs/metrics/history.md`。

## 已上线（2026-11-13）

| 项 | 结果 |
| --- | --- |
| 生产库迁移 | **5/5**（`story_main=2197`、`categories=15→14`、audio 表 2 张、`account.status`、唯一约束） |
| 库账号 | `story_app`（最小权限，`public` 无 CREATE，实测登录通过） |
| 生产账号 | 1 个 admin（`acc_prod_admin_01`，手机号**占位** `13800138000`，待换真号） |
| 容器 | `story-server-prod` / `story-admin-prod` 均 healthy；域名 HTTPS 200 |
| APK | `releases/storynook-0.1.2.apk`，48.9 MiB，versionCode 3，正式签名 |
| 执行记录 | `docs/product/24-prod-deploy-20261113.md`（含逐条命令、断言、回滚） |

## 还剩什么

| # | 事 | 谁做 | 依据 |
| --- | --- | --- | --- |
| ① | 管理员手机号换真号（一条 UPDATE） | 产品负责人 | `24-…md` §5 |
| ② | TLS 证书到期（北京时间 11-14 02:02） | 产品负责人（已声明在处理） | `24-…md` §9 |
| ③ | APK 真机验收（无 adb 设备） | 产品负责人 | 装机跑：登录→首页→播放→收藏→平板横屏 |
| ④ | 真实短信通道（现用固定码，非 123456） | 上架前 | `24-…md` §9 |
| — | `apps/` 那批文件提交 | 待定 | `16-commit-plan.md`（5 个提交） |

**备份就在改动之前**：`/vol1/1000/story/backup/story-predeploy-20261113.dump`（4.13 MB）。
keystore 备份：`/vol1/1000/story/backup/keystore/`（**丢了就只能换包名重发**，请异地再存一份）。

## 两处没做到的

1. **OpenDesign 出设计稿**：本会话没有它的工具入口，改用「手写 HTML 原型 + 无头浏览器逐屏截图复核」。
   要补：把 OpenDesign 接进会话或用它的界面，以 `docs/design/**` 现有原型为输入重出视觉定稿。
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
| 无头截图四连坑 | EACCES / 找不到 puppeteer / 屏与屏状态串 / 截到半截 | 见 `docs/design/README.md` §坑 |
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
这一步只有真机能验。之后才是提交、发版、换管理员真号、接短信通道。
别在没有备份的情况下动生产；备份与回滚步骤都在 `24-prod-deploy-20261113.md` §10。
