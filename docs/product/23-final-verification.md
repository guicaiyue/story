# 23 · 收尾全量验证（2026-11-12 22:50）

用途：一次跑完全部自检，给出一份可复查的证据。所有数字都是当场跑出来的，不是回忆。

---

## 1. 产品仓（`/vol1/1000/开发/NAS/story`）

```
./scripts/preflight.sh --e2e
```

```
PASS   迁移状态（story_m12_rehearsal） 全部已应用（5 个）
PASS   服务端测试              Tests  136 passed
PASS   后台测试                 Tests  63 passed
PASS   App 静态检查             No issues found
PASS   App 测试                   +94: All tests passed
PASS   端到端冒烟              合计 16 项，失败 0

结论：可以进入下一步（有人工批准项时仍需逐项确认）
```

端到端 16 步覆盖：注册设备 → 首页 → 分类 → 故事列表 → 故事详情 → 播放上报 → 进度读写 → 收藏 → 我的 → 音频；后台：登录 → 仪表盘 → 故事列表 → 分析概览。

## 2. 设计稿（`docs/design`）

```
./scripts/design-shots.sh
```

```
完成：17 张 → /out     （手机 9 + 平板 1 + 后台 7）
```

## 3. 插件仓（`/vol1/1000/开发/NAS/dsh-plugins/dsh-task-cards`）

```
./scripts/preflight.sh
```

```
ABI 检查通过 · kernel-only-writes · single-composition-root
cross-module-imports（冻结 10 处，当前 10 处）· 代码预算通过

度量快照
2026-11-12 ｜ 卡 86（open 0） ｜ 人出手 24 ｜ zeroAction 0.721
           ｜ ask 6（人 0 / 默认 6，autoRate 1） ｜ 静默 0

结论：可以提交
```

测试总量：**515 passed | 5 skipped（520）**（连跑三次一致；此前有一次 `Failed Tests 1` 的偶发，未能复现）。

## 4. 生产库：**全程未被写入**

```
migrations=1     story_main=2197     accounts=0
```

生产容器 `story-server-prod` / `story-admin-prod`：**不存在**（未批准，未创建）。

对照第 12 轮记录的基线（`migrations=1`、`story_main=2197`）——**一字未变**。

## 5. 备份现状

| 项 | 值 |
| --- | --- |
| 文件 | `/vol1/1000/story/backup/story-20261112-2121.dump` |
| 大小 | 4.2 MB（custom 格式） |
| 可恢复性 | 已恢复到临时库校验：`story_main=2197`、`categories=15`、`app` 表 9 张，与生产一致 |

## 6. 汇总

| 端 | 测试 | 状态 |
| --- | --- | --- |
| 服务端 | 136 | ✅ |
| 后台 | 63 | ✅ |
| App | 94（含平板 10、今晚列表 6） | ✅ |
| 端到端 | 16 | ✅ |
| 插件 | 515（+5 skip） | ✅ |
| 设计稿 | 17 张 | ✅ |

上线仍卡在四个生产写操作，逐条见 `20-approval-sheet.md`。
