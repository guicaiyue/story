# 小故事铺 2.0 · 开发日志与任务卡实测

> **2026-11-13 读前须知**：本文是**按天的历史日志**，记录当时怎么干、踩了什么坑，
> 内容原样保留（这是踩坑档案的价值所在）。
> 其中提到的路径现在已不存在，读的时候自行折算：
> - `apps/app/**`（Flutter）→ 已移出仓库，源码归档 NAS `backup/src/story-app-0.1.2-src.tar.gz`
> - `docs/design/**`（设计原型与截图）→ 已移出仓库，不在 git 历史里
> - `docker-compose.m4.yml`、`scripts/m4-*.sh`、`scripts/design-shots.*`、`scripts/dev-metrics.mjs` → 已删除
> - 分支 `feat/platform-v2` → 已合并进 `main` 并删除
>
> 想知道**现在**是什么样，看 [docs/README.md](../README.md) 或 [handover.md](../handover.md)。

> 这份日志有两个用途：1) 记录产品开发进展与决策；2) 记录「任务卡系统」在真实开发中的表现，作为插件优化的依据。
> 数据来源：dsh-dev 会话事件（`data/dsh/sessions/.../session.v4.jsonl.zstd`）、任务卡 `cards.json` / `records.json` / `cards.json.journal/`、面板操作记录。

## 1. 环境与角色

| 角色 | 是谁 | 做什么 |
| --- | --- | --- |
| 产品负责人（人） | 我（Lead 代理） | 调研、写产品文档、拍板、验收 |
| 开发团队（agent） | dsh-dev 容器里 `/workspace/story` 会话 | 读文档、写代码、跑测试、汇报 |
| 观察者（agent） | dsh-task-cards 观察者会话 | 每轮结束提炼值得留的事 → 卡 |
| 决策秘书（agent） | dsh-task-cards 决策会话 | 给决策卡出票拟（2–3 方案 + 推荐） |
| 调度者（system） | dsh-task-cards kernel | 批准 → 入队 → 派发回原会话 → 验收 |

## 2. 时间线（2026-11-09）

| 时间 | 事件 | 类型 | 结果 |
| --- | --- | --- | --- |
| 18:34 | 挂载 `/vol1/1000/开发/NAS/story` → `/workspace/story` | 环境 | 容器内可见 |
| 18:44 | 发现 llm.patch.yml 用 `openai-responses`，网关只支持 `/chat/completions` | 环境缺陷 | 首轮 404；改 `openai-completions` 后恢复 |
| 18:50 | 产品负责人首条消息（读三份产品文档 + 回报 M1 理解） | 人工消息 1 | 首轮 404 失败 |
| 18:53 | 重发同一条（缩短） | 人工消息 2 | 成功，回合 2 结束 |
| 18:54 | 观察者建 3 张决策卡（数据库/pREST/鉴权） | 自动 | 3 张，19.3s |
| 18:54 | 决策秘书出票拟（3/3，各 3 方案） | 自动 | 18.6s，推荐均合理 |
| 18:55 | 面板批准「数据库」卡 | 人工点击 1 | 入队→派发→executed→verifying→**unknown** |
| 18:56 | 面板批准「pREST」卡 | 人工点击 2 | 同上；**重复批准导致重复派发一次** |
| 18:57 | 开发 agent 用 `ask_user_question` 问 3 个问题 → 建 1 张问题卡 | 自动 | 卡内 3 个问题被平铺成一个选项列表 |
| 18:57 | 用 API 提交合并答案（①ALTER ②固定验证码 ③授权写文档） | 人工作答 1 | 会话解锁 |
| 18:58 | 面板批准「鉴权」卡 | 人工点击 3 | 入队→派发 |
| 18:59 | 观察者建 1 张权限卡（授权改 02 §3.1）；决策秘书首次超时、重试成功 | 自动 | 60s 超时 → 重试 1 次 |
| 19:02 | 产品负责人回复 3 个决策 + 下 M1 交付口径 | 人工消息 3 | 开发进入 M1 |
| 19:05 | 追加硬约束：开发只用 dev 库，生产库只产出迁移文件 | 人工消息 4（排队） | 待投递 |

## 3. 介入统计（截至 19:06）

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 人工消息 | 3 条（+1 排队） | 全部是产品方向/交付口径；没有一条是「你漏了/你错了」的返工指令 |
| 面板批准 | 3 次 | 批准动作本身 0 输入，文案来自决策秘书票拟 |
| 卡片作答 | 1 次 | 多问题卡被迫合并成一段文字 |
| 原生提问组件作答 | 2 次 | 与卡片重复的第二个入口 |
| 自动派发回会话 | 4 条 | 数据库/pREST×2/鉴权 |
| 观察者 | 2 次成功 | 共建 4 张卡 |
| 决策秘书 | 2 次成功（1 次超时重试） | 出票拟 4 张 |
| 返工/纠偏 | 1 次（生产库风险） | 由人发现，系统未拦截 |

**初步结论**：任务卡系统承担了「决策采集 + 票拟 + 派发」，我的输入从「写清楚每个决定」变成「点批准」；但——
- 批准后的卡状态不闭环（unknown 且仍在待决策），导致重复批准、重复派发；
- 多问题提问被拍平，答案语义错乱；
- 原生提问与任务卡两个入口重复，用户不知道答哪个；
- 观察者是回合结束后才跑，**回合内的不可逆动作无法拦截**（生产库写入风险是我人工叫停的）。

## 4. 任务卡问题清单（待优化）

| # | 问题 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | 决策卡批准后停在 `unknown`，仍在「要我决策」 | 3 张卡 `deliveryState=unknown`、status=open | 用户以为没处理；可重复批准 | decision/permission 卡派发成功即 `confirmed`；approve 做幂等（已批准拒绝） |
| 2 | 多问题 `ask_user_question` 被拍平 | 1 张卡 3 问 7 选项 | 一个答案被塞给所有问题 | 按 item 分组渲染与提交，或只给「去会话回答」 |
| 3 | 同一次待决出现两个入口（原生提问 + 卡） | 19:57 权限卡 + 聊天组件 | 用户困惑、可能双答 | 提问建卡时折叠原生组件，或卡上标注「同源」 |
| 4 | 第二次 `ask_user_question` 没建卡 | 只有第一次有「问题卡」日志 | 重要提问漏记 | 按 callId 去重而不是按会话去重 |
| 5 | 回合内不可逆动作无闸门 | 生产库写入风险 | 可能造成真实损失 | 观察者改为「工具调用时」预检，或对危险工具加 guard |
| 6 | 决策秘书 60s 超时 | 日志「第 1 次失败：观察者会话超时未完成」 | 延迟、浪费一次调用 | 超时提到 120s 或按模型调整 |
| 7 | 重复派发同一张卡 | pREST 卡被批 2 次 | 会话收到重复消息 | 幂等 + 面板禁用 |

## 5. 产品开发进展

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| 调研 | 完成 | `00-research.md`（竞品 App Store 数据 + 2197 条内容盘点） |
| 产品 brief | 完成 | `01-product-brief.md` |
| 信息架构/数据模型 | 完成 | `02-architecture.md` |
| 决策记录 | 进行中 | `03-decisions.md`（开发 agent 维护） |
| Web 后台设计 | 进行中 | OpenDesign 项目 `story-admin-web` |
| 安卓 App 设计 | 规划完成，待出图 | OpenDesign 项目 `story-android-app` |
| M1 服务端 | 进行中 | 开发 agent 回合 7 执行中 |

## 6. 首轮交付结果（2026-11-09 19:50）

### 6.1 设计（OpenDesign）

| 端 | 项目 | 产物 | 验收 |
| --- | --- | --- | --- |
| Web 后台 | `story-admin-web` | `docs/design/admin-web/`（index.html + assets，9 个页面） | 浏览器打开：登录 → 看板（2197 篇/128 待审/214 缺封面）、故事列表、审核队列、运营、用户、数据中心、系统 |
| 安卓 App | `story-android-app` | `docs/design/android-app/`（9 屏、hash 路由、可交互） | 浏览器打开：首页/分类/播放器/家长门/家长中心/夜间模式可点 |

首次生成各踩到一次坑：后台首轮只输出计划不写文件（第二次明确「必须产出文件」后成功）；安卓首轮缺 `assets/js/app.js`（补跑一次后 9 屏可交互）。

### 6.2 服务端 M1（dsh-dev 开发会话交付）

| 验收项 | 结果 |
| --- | --- |
| `pnpm test` | 44 passed（content 19 / play 13 / auth 12） |
| `/api/health` | 200，`{"status":"ok","db":"up","latencyMs":45}` |
| `/api/stories` | 返回真实数据（2197 条，来自 dev 库副本） |
| `/api/categories` | 15 个分类，带 storyCount |
| dev 库隔离 | `story-dev-postgres` 容器 + `story_dev`/`story_test`，生产库不再写入（D7） |

### 6.3 任务卡系统本轮表现

- 观察者 3 次成功（回合 2/6/7），共 8 张卡；
- 决策秘书 3 次成功，出票拟 5 张，自动执行 1 张（read-only 排查）；
- 批准→入队→派发→验收 闭环跑通 1 次（修复后 `case:confirmed`），旧卡仍为 unknown；
- 修复 4 项：决策卡验收收口、批准幂等、面板已批准态、confirmed 后移出待决策车道；
- 未修：多问题逐题作答、提问建卡幂等、回合内危险动作前置闸门、超时调优。

### 6.4 风险与待办

1. 生产库已有 6 项既成写入（9 列 + 2197 行回填 + app schema + 权限），已决定「只撤未获批的权限项，其余冻结」；
2. 内容分级是启发式回填：聊斋志异 293 篇被标 3-6，需要人工/规则复核（M2 内容审核流程）；
3. 开发会话单轮过长（70+ 分钟、270 步），观察者只能回合后介入，需要「中途闸门」。

## 7. 第二轮（2026-11-09 20:00）

- 处理生产库遗留决策：撤销脚本并入整包等批；公网写方法选定「先换受限账号、出方案不动库」；一条信息卡确认后归档。
- 任务卡修复生效验证：批准→入队→派发→`case:confirmed`，卡移出待决策车道。
- 已把 M2（Web 后台 MVP）目标与验收口径排进开发会话队列（设计稿作为视觉与交互规格）。
- 新增长期开发基座文档 `06-working-baseline.md`（环境/角色/每轮动作/验收/介入指标/红线）。

## 8. M2 交付（2026-11-09 20:20）

| 验收项 | 结果 |
| --- | --- |
| 后台测试 | 46 passed（6 个测试文件） |
| 服务端测试 | 66 passed（含睡前时段时区回归用例） |
| 真机登录 | `13900000001` / `123456` 登录成功 |
| 看板真实数据 | 近 24h 播放 163 次（`app.play_event`）、已上架 2,181、待审 9、家庭/儿童 3/4 |
| 睡前时段 | 修掉 UTC 分桶 bug，6.2% → 66.1%，20:00–22:00 峰值可见 |
| 生产库 | 全程未写 |

**刻意未完成（因 M1 服务端缺接口，界面已标注）**：
1. 故事正文只读（缺写回接口）；2. 数据中心无排行榜/趋势下钻；3. 推荐位不能新增删除；4. 无新建管理员。

这 4 项已作为 M2.1 backlog 记录，和 M3 一起排期。

截图：`docs/design/screenshots/m2-dashboard.png`（真实后台，非设计稿）。

## 9. M3 交付（2026-11-09 21:10）

| 验收项 | 结果（我自己跑的） |
| --- | --- |
| `flutter analyze` | **No issues found** |
| `flutter test` | **58 passed**（含 test_live 5 个） |
| 代码结构 | `lib/` 16 个文件：theme/models/services/api_client/player_service/state/widgets + 9 屏 |
| 真实接口 | 首页/分类/详情/播放进度/收藏/播放事件全部接 `/api/*` |
| 包名 | `com.storynook.app` |
| 生产库 | 未触碰 |
| Web 预览 | `flutter build web --no-web-resources-cdn` 后可在手机尺寸渲染；未登录时显示「网络连接失败/重试」错误态（D6 游客注册未接，正是当晚被拍板的卡） |

agent 自己发现并修了 5 个缺陷：InkWell 缺 Material、dispose 查 Provider、15 秒图标与行为不符等。

**当晚 5 张卡的处置**：
1. 交付 M3 → 验收归档；
2. 重复分类「睡前故事」（id=1 有 194 篇、id=2 为 0）→ 数据侧清理，先 dev 库，生产只出脚本；
3. 家长设置持久化 → 同意在 M4 加 `app.setting` 读写端点；
4. 音频链路 → 选**服务端 TTS 实时合成 + 缓存**（edge-tts 引擎，先 3 条验证再批量回填 duration_sec）；
5. D6 游客注册时机 → 选**启动即注册**（失败静默重试 + 写入 401 兜底）。

## 10. 音频链路落地（2026-11-09 21:45）

按卡 c-mw99xnkq-2ehou 的决定实现「服务端 TTS 实时合成 + 缓存」：

| 验收项 | 我实测的结果 |
| --- | --- |
| `GET /api/stories/8/audio` | **200**，`audio/mpeg`，1,604,016 字节 |
| 音频缓存 | `.audio-cache/stories/<shard>/<id>.mp3`，已缓存 142 条（101 MB） |
| 时长回填 | `story_main.id=8` → `duration_sec=267`、`audio_url=/api/stories/8/audio` |
| 实现要点 | `msedge-tts` + `music-metadata` 量真实时长（不用字数估算）；先写临时文件再 rename；支持 `Range` 供播放器 seek |
| 磁盘 | 单条约 0.7 MB，全量 2197 条约 1.5 GB（dev 库可接受，生产需清理策略） |

`.audio-cache/` 已加入 `.gitignore`。

## 11. 第 4 轮验收（2026-11-09 22:06）

| 项 | 结果 |
| --- | --- |
| 服务端测试 | **85 passed**（5 个文件，比上轮 +19，含 TTS/Range） |
| 安卓 App 测试 | **64 passed**（比上轮 +6，含播放器拉流超时降级/模拟播放） |
| TTS 真机 | `GET /api/stories/8/audio` → 200 / audio/mpeg / 1.60 MB；`duration_sec` 回填 267 |
| 批量回填 | 后台任务进行中：246 / 2197 已回填（受 edge-tts 速率限制，不阻塞本轮收口） |
| 磁盘 | `.audio-cache` 约 0.7 MB/条，全量约 1.5 GB（已 gitignore） |

本轮学到的教训：**长故事分块合成会截断**，agent 自己定位到「所有失败都 >2875 字」并加了分块+重试；这类问题观察者抓不到，只能靠开发 agent 自检。

## 12. 第 5 轮（2026-11-09 22:20）

| 项 | 结果 |
| --- | --- |
| 插件修复 | 记录持久化回退（HMR 双实例缓存覆盖）→ `readFresh` + 回归用例，`pnpm verify` 全绿 |
| 插件发现 | 70 分钟的长回合（turn 15）**没有触发观察者**，人无法介入；已记入 05 复盘 |
| 表单数据 | TTS 回填推进到 274+；音频缓存约 0.7 MB/条 |
| 安卓设置持久化 | `RemoteSettings` + `getSettings/putSettings` + `AppState.loadSettings/saveSettings` 落地 |
| 验收 | `flutter analyze` 0 issue，`flutter test` 75 passed |
| M4 方案 | 新增 `07-m4-plan.md`（拓扑/打包/迁移/安全/灰度/上线顺序） |

过程中模型出过一次工具调用格式损坏（输出了 DSML 标记而不是真调用），回合提前结束；重发短指令后恢复。这类问题需要「回合结束但没做事」的检测。

## 13. M4 打包与联调验收（2026-11-10 09:25）

| 验收项 | 结果（我亲自跑的） |
| --- | --- |
| 镜像 | `story-server:m4` 568 MB（健康检查通过）、`story-admin:m4` 64.1 MB |
| 起栈 | `docker compose -f docker-compose.m4.yml up -d` 成功（server 13300、admin 18082） |
| smoke | **8/8 通过**：health 200 / 登录拿到 JWT / admin stories total=2197 / 公开列表 2181 / 音频 206 audio-mpeg cache=hit duration=267s / 后台页面 200 / nginx 反代 /api 200 / 反代音频 206 |
| 后台可视化 | 容器化后台登录成功，看板显示 2197 篇、2181 上架、9 待审、TTS 剩 16 条 |
| 红线 | 全程 dev 库，生产库未写 |

截图：`docs/design/screenshots/m4-admin-container.png`。
下一步：迁移演练脚本验收 + 上线方案评审（域名/窗口/APK 分发）。

## 14. 内容分级与分类清理（产品负责人直接处理 dev 库，2026-11-10 09:50）

按 `00-research.md`「儿童内容安全」口径，在 dev 库重排年龄分级并清掉重复分类：

| 动作 | 结果 |
| --- | --- |
| 删除空重复分类「睡前故事」id=2 | 只剩 id=1（194 篇） |
| 3-6 岁 | 721 篇（睡前故事/儿童故事/格林童话/益智故事） |
| 6-9 岁 | 1176 篇（寓言/成语/民间/经典/历史/童话作文） |
| 9+ | 300 篇（聊斋志异 293/恐怖 3/怪谈 3/推理 1） |

发现并已退回开发会话的 bug：`/api/home` 的 tonight/featured **不按 ageBand 过滤**，把 9+ 的聊斋《细柳》当成了儿童首页「今晚听什么」。要求：home 接 `ageBand`（默认 3-6）、兜底也不越龄、App 传孩子年龄档、补测试。
生产库同样只出脚本等批准，dev 先落地。

## 15. M4 验收完成（2026-11-10 10:05）

| 验收项 | 结果（我亲自跑） |
| --- | --- |
| 镜像 | server 568 MB（重建后 healthy）、admin 64.1 MB |
| 冒烟 `m4-smoke.sh` | **8/8**，连跑两次都过 |
| 迁移演练 `m4-migrate-rehearsal.sh` | **25/25**，连跑两次都过（首次 20/21 是因为脚本硬编码「分类 15」，产品侧删了重复分类后改为 14，并要求改成与快照比对） |
| 年龄过滤 | `?ageBand=3-6` → 睡前故事《智慧的老公公》；`6-9` → 童话作文《糖果兔》；`9+` → 聊斋《细柳》；默认 3-6 |
| 分类 | 14 个，无重复；迁移里包含「删重复空分类」步骤（可回滚） |
| 生产库 | 零写入（脚本自带红线校验） |

**仍待人工拍板/执行**：域名与证书、生产迁移窗口、APK 构建（需 Android SDK）、老站是否保留为预览入口（见 07-m4-plan §8）。

## 16. 业务闭环 E2E 验收 + 闸门第二次 E2E 失败（2026-11-10 11:00）

**业务闭环（真接口，M4 栈）**：draft `2198` → `POST /admin/stories/2198/submit` → `review` → `POST .../review {action:approve}` → `published` → 公开 `GET /api/stories/2198` 返回 9+ 内容；`GET /api/home?ageBand=3-6` 仍是《智慧的老公公》，**9+ 内容没有越龄进首页**。

**任务卡闸门（P0-1）真机 E2E 两次失败**：
- 第一次：日志「tools.guard 已接管」但执行 `rm -rf /tmp/dtc-gate-probe-*` 直接放行，`闸门命中` 计数 0；
- 第二次（修复后）：自检行出现但顺序反了（自检在 inject 之前，报 `guard=false`）；`闸门回调`/`闸门命中`/`已挂到 agent` 三项计数**全为 0**——插件注册的 listener 根本收不到 `tools/pre-execute`。
- 参考实现已找到：宿主自带 `@deepseek-ai/dsh-experimental-auto-review/lib/index.js:461` 用 `ctx.effect(function*(){ yield ctx.on("tools/pre-execute", h, {prepend:true}) })`，且 handler 首行判 `exec.agent === undefined → next()`，说明事件是 agent 作用域投递的。
- 已要求优化员：修自检顺序、照参考写法注册、agent 作用域挂载改用已生效的 `agent/status` 拿 agent；**做不到就诚实降级为 observe-only + 建卡 + 明确文案，不许显示「已接管」**。

## 17. 闸门 E2E 通过 + 一个「批准后仍拦」的 bug（2026-11-10 11:15）

**拦截验证（在 story 工作区的 M4 会话里，真机）**：
```
闸门回调（pre-execute #2..4）：bash
闸门命中：rule:rm-outside:/tmp/dtc-gate-probe-m4
闸门建卡：c-mwa436jj-1g90w（destructive）
```
agent 原话：「**被拒绝了。命令没有执行**」，拒绝文案含卡 id 与判定依据。

**新 bug（已派修）**：批准后 `闸门发券：→ bash（10 分钟内一次）`，但 agent 重试仍被拦并新建卡 `c-mwa46l5w-5g6hd`。对比元数据：
- 旧卡 `target='rm -rf /tmp/dtc-gate-probe-m4'` `argHash=5fbdd4a5…`
- 新卡 `target` 相同 `argHash=5f665ddd…`
→ 券 key 用**原始参数哈希**，agent 重试时 `description` 等字段变化导致对不上。修法：改用语义 key（`session+tool+effect+target`）+ 卡去重 + 语义 key 的放行/再拦测试。

**覆盖范围澄清**：lead 会话（plugins 工作区）实测不拦——闸门只对「插件观察到并挂载了 agent 作用域」的会话生效。要在 contracts/面板写清，别让人以为全局生效。

**额外收获**：M4 会话的观察者自己发现了「闸门放行未生效」，主动建卡上报（`c-mwa46yg4`）——这正是任务卡系统应有的自我发现能力。

## 18. 闸门验收：四轮迭代记录（2026-11-10 12:30）

| 轮次 | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 「已接管」但完全不拦 | 插件注册的 listener 收不到事件（根 ctx 被作用域过滤） | 照宿主 `auto-review` 写法注册 + agent 作用域挂载 |
| 2 | 能拦，但批准后重试仍被拦、多建卡 | 券 key 用整参数哈希，重试时 `description` 变 → key 变 | 改语义身份 `session+tool+effect+target` |
| 3 | 语义 key 后仍出现多个不同 hash、21ms 内多张卡 | HMR 留下多代 listener 同时生效（旧实例无登记，新代码无法 dispose） | 重启 dsh-dev + 单实例 hooks 注册（globalThis 记录当前注册者） |
| 4 | 券已消费（`闸门放行` 出现），同一毫秒又被判一次 → 仍 deny + 建卡 | 宿主顺序是 waterfall → allow → guard；同一次执行被判两遍 | 加「每 callId 只判一次」缓存；若对象不同源则改券的宽限期（修中） |

产品教训：**「日志说成功」不能当验收**。四轮里每一轮都有绿色日志，但真机行为只有 E2E（deny → 批准 → 放行且真执行 → 第三次再拦）才能证伪。

## 19. ✅ 闸门 E2E 最终通过（2026-11-10 12:38，第五轮）

| 步骤 | 期望 | 实际 |
| --- | --- | --- |
| 第 1 次执行 `rm -rf /tmp/dtc-gate-probe-m11` | 拦 + 1 张卡 | ✅ 拦，建卡 `c-mwa74zhd-1ojqe` |
| 面板批准 | 发一次性券 | ✅ `闸门发券 … key=session-…` |
| 第 2 次执行（同命令） | 放行且真执行 | ✅ `闸门放行（一次性券）`，无新卡，agent 报「成功放行」 |
| 第 3 次执行（券已用尽，>5s） | 再拦 + 第 2 张卡 | ✅ 拦，建卡 `c-mwa78pgw-75g7g` |

根因链（共五轮）：① listener 收不到事件 → 换注册方式 + agent 作用域；② 券 key 用整参数哈希 → 改语义身份；③ HMR 多代 listener 并存 → 重启 + 单实例注册；④ 同一次调用被 waterfall 和 guard 各判一遍 → 按 callId 复用判定；⑤ 两条路径 exec 不同源 → 券加 5s 宽限。

实测数据（同一 tool callId 下 pre-execute 被回调 4 次，判定复用生效，只建 1 张卡）。

## 20. 任务卡 P0-4 完成 + M2.1 开工（2026-11-10 12:50）

**插件 P0-4（台账自证收口）**：`/evidence` 不再执行任意命令（传 cmd/checks 即 403 PLAN_BOUND）；证据只能按批准时冻结的 `acceptance[]` + `planId` 收集，带 `level(E1–E4)` 与 `sourceRef`；`/todo` 绑定 planId、executor 不能自证完成/冻结；验收强制「≥E2 机器证据才 confirmed」。`pnpm verify` **389 passed + 1 skipped**、bundle 126.0 KB、host entry 455.1 KB。已让审计员做对抗性复核（重点：任意命令是否真的执行不了）。

**产品 M2.1 开工**（补齐 M2 四个刻意未完成项）：
1. 故事正文写回 `PUT /api/admin/stories/:id/content`；
2. 数据中心排行/趋势（播放 Top20、14 天趋势、分类分布）；
3. 推荐位增删改（banners POST/DELETE/PATCH）；
4. 管理员管理（新增/停用/role 变更）。
验收口径：服务端+后台测试全绿、只打 dev 库、我在 18082 后台亲自操作复验。

## 21. 两个 P0 发现（2026-11-10 13:15）

**① 闸门被复合命令绕过**（用分类器直接验证，非猜测）：
```
rm -rf /tmp/probe-a          → 拦 ✅
true && rm -rf /tmp/probe-b  → 漏判 ❌
echo hi; rm -rf /tmp/probe-c → 漏判 ❌
cd /tmp && rm -rf probe-d    → 漏判 ❌（相对路径 + cd 换目录）
```
要求改「按 shell 分段（&&/||/;/|/换行）逐段判定 + 跟踪 cd + `bash -c` 递归」。

**② 面板令牌端点自己不设防**：`POST /presence` 无鉴权直接发令牌，同容器 agent curl 一下就能拿到合法令牌去 approve。我实际验证：用 presence 拿到 token 后成功 deny 了一张卡。真实结论是「同宿主 root agent 无法被同一个 HTTP 接口真正挡住」，目标降级为「挡误触发 + 让伪装可见」（Origin 强制、令牌签发指纹、audit_log、非浏览器来源告警）。

## 22. M2.1 验收通过（2026-11-10 13:30）

四项全部落地并由我在真环境复验：

| 项 | 证据 |
| --- | --- |
| 故事正文写回 | `PUT /admin/stories/8/content` → 200，写入后 `story_content` 生效（测试后已从快照恢复原文） |
| 数据中心排行/趋势 | `/analytics/overview|top|trend|categories` 全部 200 且有真实聚合；页面渲染：累计播放 2362、**睡前时段占比 66.1%**（目标 ≥50%）、14 天完播率 62.6%、高峰 20:00 |
| 推荐位增删 | `POST /admin/banners` → id5；`DELETE /admin/banners/5` → deleted |
| 管理员管理 | `GET /admin/accounts` 3 个管理员；页面含角色权限说明与停用语义 |
| 测试 | 服务端 **136/136**、管理端 **63/63** |
| 冒烟 | 重建镜像后 8/8 全过 |

截图：`docs/design/screenshots/m21-analytics.png`、`m21-banners.png`。

教训：**验收时不要拿真实故事当写回测试对象**——我覆盖了 story 8 的正文，最后从 `.m4-rehearsal` 快照恢复并核对长度（1242→恢复后 1257 字节一致）。后续写回测试应新建草稿或用专门的测试故事。

## 23. 产品化恢复第 1 项：APK 用真实 API 地址重建（2026-11-11）

按 `08-launch-plan.md` §8（Q1–Q7 已拍板）执行恢复后的**第 1 项**：产出可用的发布候选 APK。
本轮**只做这一项**，未碰生产库、未碰 Vercel/Cloudflare、未 push main。

### 23.1 改了什么

| 文件 | 改动 | 为什么 |
| --- | --- | --- |
| `apps/app/lib/config/app_config.dart` | **新增**：基址唯一来源 | 见 23.2 —— 0.1.0 的事故根因是「默认值把 127.0.0.1 编进了发布包」 |
| `apps/app/lib/services/api_client.dart` | 删掉自带的 `kApiBaseUrl` 常量，改为 re-export 配置模块；构造时统一 `normalizeApiBaseUrl()` | 基址只允许一处定义，避免再散落 |
| `apps/app/android/app/src/main/AndroidManifest.xml` | **加 `android.permission.INTERNET`** | release 构建缺联网权限（见 23.3） |
| `apps/app/pubspec.yaml` | `version: 1.0.0+1` → `0.1.1+2` | 版本号与产物名统一（08 §1.9 R9） |
| `apps/app/README.md` | 更新 baseUrl 表与发版校验步骤 | 原文写的还是「默认 127.0.0.1:3000」 |

### 23.2 基址不再有「默认回落本机」

旧代码：

```dart
const String kApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL', defaultValue: 'http://127.0.0.1:3000');   // ← 静默进发布包
```

`String.fromEnvironment` 的 `defaultValue` 是**常量**，不传 `--dart-define` 时
就直接编进去。这就是 0.1.0 的 APK 里出现 `http://127.0.0.1:3000` 的机制。
现在改成：默认值 = 正式域名；本机地址必须显式开 `ALLOW_LOCAL_API_FALLBACK=true`。

### 23.3 新发现：release 包根本没有联网权限（0.1.0 的第二个缺陷）

`08 §1.9` 只记了「基址是 127.0.0.1」，本轮还查出一个更硬的缺陷 ——
**Flutter 模板只在 `src/debug` / `src/profile` 声明 INTERNET**（那是给 hot reload 用的），
release 不合并。实测 0.1.0 的产物：

```
$ aapt2 dump permissions releases/storynook-0.1.0.apk
uses-permission: name='android.permission.ACCESS_NETWORK_STATE'      # 只有这个
```

即 **0.1.0 就算基址填对也连不上**：没有 INTERNET 权限，socket 直接被系统拒。
已在 `src/main/AndroidManifest.xml` 补上，并在 README 写明发版必验。

### 23.4 编译与产物

```bash
flutter analyze                    # No issues found!
flutter test                       # 78 passed（0.1.0 时期为 58，本轮工具链下为 78）
flutter build apk --release --dart-define=API_BASE_URL=https://api-story.xirizhi.cn
```

| 项 | 值 |
| --- | --- |
| 产物 | `releases/storynook-0.1.1.apk` |
| 大小 | 51,201,583 字节（约 48.8 MiB） |
| sha256 | `1f36695a6251e39f165e3f0f201a7adc0f6ddf049566699702c424a5ada5e720` |
| versionName / versionCode | `0.1.1` / `2` |
| 架构 | arm64-v8a、armeabi-v7a、x86_64 |

**产物级验证**（不是看构建日志，是拆开 APK 验）：

```
$ aapt2 dump permissions releases/storynook-0.1.1.apk | grep INTERNET
uses-permission: name='android.permission.INTERNET'          # ✅ 0.1.0 没有

lib/arm64-v8a/libapp.so    | api-story.xirizhi.cn ✅ | http://127.0.0.1 ❌(不存在)
lib/armeabi-v7a/libapp.so  | api-story.xirizhi.cn ✅ | http://127.0.0.1 ❌(不存在)
```

> 注：`libapp.so` 里仍有一处**裸** `127.0.0.1` 字符串，是 Flutter 引擎自带的
> 符号数据（`...KeepAliveParentDataMixin.127.0.0.1.AudioBassBoostUp.blackMountainView...`），
> 0.1.0 与 0.1.1 里逐字节相同，与配置无关。**判据要用 `http://127.0.0.1`（带 scheme）
> 的出现次数**：0.1.0 = 1（还带 `:3000`），0.1.1 = 0。

### 23.5 验证：本地 dev server 时首页能拉到数据

无 KVM（`/dev/kvm` 不存在），装不了 Android 模拟器，所以没用模拟器截图，而是
**用同一份 Dart 源码编译为 web，指向本地 dev API**，由真实浏览器渲染后截图
（与 `m3-app/` 既有截图的取证方式一致）。dev 栈：`story-server`（dev 库，2197 条）
+ `story-dev-postgres`。

实测网络（全部 200）：

```
200 /api/settings    200 /api/home?ageBand=3-6    200 /api/categories
200 /api/stories?page=1&pageSize=20&ageBand=3-6   200 /api/progress   200 /api/favorites
```

页面渲染值与该接口响应**逐项对齐**（证明不是假数据）：

| 位置 | 截图显示 | `/api/home` 实际返回 |
| --- | --- | --- |
| 今晚听什么 | 智慧的老公公 · 睡前故事 · 3-6 岁 · **8 分 52 秒** | title 智慧的老公公 / ageBand 3-6 / durationSec **532** |
| 推荐分类 | 睡前故事 194 / 格林童话 126 / 历史故事 196 … | 194 / 126 / 196 … 全部一致 |

截图：`docs/design/screenshots/apk-0.1.1-home-real-api.png`

### 23.6 未做 / 需注意

1. **工作区无手机，未做真机安装验证** —— 产物级证据已足（域名 + 权限 + 版本号），
   但「装到真机点一遍」属于发布前建议补的最后一道，需人工或真机。
2. `api-story.xirizhi.cn` 当前**无任何服务在监听**（`curl` 超时、traefik 无该 router）。
   即该 APK 现在装上也连不上 —— 它依赖**第 2 项「生产 docker 部署」**把服务起起来
   并挂上反代。这是恢复顺序里的下一项，不是本项缺陷。
3. `test_live/` 有 **2 个用例失败**，属**既有数据漂移**、与本轮改动无关：
   - `categories` 断言 15，dev 库实际 **14**（迁移会删重复空分类 id=2，08 §2.2）；
   - `total > 1000` 断言，3-6 档已发布实际 **716**（分级修正后 3-6 为 721 量级）。
   建议随第 2 项一并更新断言，不在本轮擅自改测试口径。
4. 遗留容器 `story-shot-nginx-1`（截取用，`--network container:chromium`，
   无宿主端口）本想停掉，被任务卡闸门判为 destructive 而留下，可随时 `docker rm -f`。
5. 全程**未提交**：分支仍是 `feat/platform-v2`，未 push、未打 tag。

## 24. 产品化恢复第 2 项：生产 docker 部署方案（2026-11-11）

按 08 §8 恢复顺序第 2 项，**只出方案 + 本地 dry-run，未启动任何容器、未碰生产库**。

### 24.1 落盘文件

| 文件 | 作用 |
| --- | --- |
| `docker-compose.prod.yml` | 生产编排（server + admin + 可选 nginx 反代） |
| `.env.prod.example` | 环境变量模板（无真实密钥，要提交） |
| `docker/nginx/story-prod.conf` | 可选 nginx 反代样例（profile `nginx-front`，默认不启用） |
| `docs/product/12-prod-deploy-runbook.md` | runbook（启动/健康检查/回滚/批准标注） |
| `.gitignore` | 加 `.env.prod` / `.env.prod.*` |

**为什么不沿用 08 §A3 的「覆盖 m4 文件」**：m4 写死 `container_name: story-server` /
`story-admin`（与联调栈冲突）、发布 0.0.0.0:13300/18082 调试端口、DATABASE_URL 指 dev 库
（覆盖漏改就连错库）。故改为独立文件 + 独立容器名（`-prod` 后缀）+ 独立卷，回滚 = 删新东西。

### 24.2 本轮只读盘点查出的三个新问题

1. 🔴 **生产库缺 `app.audio_cache` / `app.audio_job`** → `tts-service.ts:125`
   直接 `db.audioCache.findUnique`，**音频接口会 500**，而播放是 App 主功能。
2. 🔴 **生产 `app.account` 缺 `status` 列** → `admin-routes.ts:376` 明确
   `select { status: true }`，**后台「管理员管理」现在就是坏的**（08 未写明）。
3. ⏰ **证书 `cert_1` 2026-11-13 18:02:55 GMT 到期**（距今约 2 天），
   SAN `*.xirizhi.cn` 覆盖新域名，但到期后所有 `*.xirizhi.cn` 一起失效。续期属平台侧。

### 24.3 「只读连接串」这个要求必须修正

任务原文要求生产用「只读连接串」。**照做会让新站完全不可用**，从代码读出：

| 时机 | 写操作 | 位置 |
| --- | --- | --- |
| App 每次冷启动 | `account.create`（游客注册） | `auth-service.ts:34` |
| 读设置 | `setting.upsert`（含写） | `user-service.ts:57` |
| 进度 / 收藏 / 埋点 | `progress.upsert` 等 | `play-service.ts:13` |
| 首次播放音频 | `audioCache.upsert` + 回填 `duration_sec` | `tts-service.ts:171` |

`GET /api/health` 只 `SELECT 1`，**只读账号也能过** → 健康检查绿灯**不能**证明可用。
runbook §3 给了 A（专用最小权限账号，推荐）/ B（暂用 postgres 超级用户，应急）两个口径待拍板。

### 24.4 dry-run 结果

```bash
docker compose -f docker-compose.prod.yml config --quiet
# → exit 1，报 PROD_DATABASE_URL 未设置（fail-fast 生效，符合 env.ts 口径）

docker compose --env-file .env.prod.example -f docker-compose.prod.yml config --quiet
# → exit 0
```

解析结果核对：2 个服务、**0 个发布宿主端口**、external 网络
（`postgres-shared` / `traefik-public`）、4 条 traefik Host 规则
（`api-story` + `admin-story` 各 https/http）、容器名 `story-server-prod` /
`story-admin-prod`；`--profile nginx-front` 时多出 `story-nginx-prod`。
另用 `nginx -t` 校验了 `story-prod.conf` 语法（syntax is ok）。

### 24.5 生产未被触碰（只读复核）

`app` 仍 9 表、`story_main` 仍 2197、`story_category` 仍 15；`audio_cache` 与
`account.status` 仍不存在；未创建 `story_app` 角色；无任何 `story-*-prod` 容器/卷/网络。

### 24.6 教训：docker run 的 -v 会**在宿主上创建**缺失路径

我用 `-v /workspace/story/...` 跑 `nginx -t` 时，docker 守护进程在**宿主**上
创建了 `/workspace/story/docker/nginx/story-prod.conf/`（空目录树）—— 因为容器内
`/workspace` 与宿主 `/workspace` 不是同一个东西（真实宿主路径是
`/vol1/1000/开发/NAS/story`）。已用 `rmdir`（只删空目录）清理干净，
`/workspace/screenshots` 早于本次操作、非我创建，未动。
**教训**：`docker run -v` 的路径按宿主解析，挂文件前先确认宿主路径存在。

## 25. 生产库账号方案 A：story_app 最小权限（2026-11-11，**SQL 待审，未执行**）

产品负责人选定 **方案 A：专用最小权限账号**（不用 postgres 裸连），并要求**先给 SQL 过目**。

### 25.1 产出

`docs/product/13-prod-story-app-grants.sql` —— 生产 `story` 库的建角色 + 授权全文，
**尚未执行任何一条**。

权限矩阵不是照抄 schema，而是逐条 grep `apps/server/src` 的调用点得出：

| 表 | 授权 | 依据 |
| --- | --- | --- |
| `public.story_main` | SELECT, **UPDATE**（无 INSERT/DELETE） | PATCH 故事 / 正文写回 / TTS 回填时长；服务端从不 INSERT/DELETE |
| `public.story_content` | INSERT, SELECT, UPDATE | 正文写回（create 或 update） |
| `public.story_category` | INSERT, SELECT, UPDATE | PATCH 分类 |
| `app.family` | **SELECT only** | 全仓只有 `db.family.count()` |
| `app.account/child/setting/progress/play_event/audit_log` | INSERT, SELECT, UPDATE | 游客注册、孩子档案、设置 upsert、进度 upsert、埋点、审计 |
| `app.favorite/banner` | + DELETE | 取消收藏、推荐位增删改 |
| `app.audio_cache/audio_job` | + DELETE | TTS 缓存 upsert/delete、批量回填 |
| `public._m1_migrations` | **零授权** | 迁移账本必须用高权账号，防止误跑 DDL |

序列只给 `banner_id_seq` 与 `story_content_id_seq`（其余服务端不 INSERT）。

### 25.2 演练（在 dev 库真跑，非推断）

把角色名/库名/owner 替换后在 `story_dev` 完整执行 → exit 0；并逐项核对：

- 表级权限与设计**逐表一致**，`_m1_migrations` 授权数 = 0；
- **DDL 不可能**：`has_schema_privilege(CREATE)` 在 public 与 app 均为 `false`，
  `owns_any_table=false`、`rolsuper=false`、`rolcreatedb=false`；
- **业务写路径真的通**：以该角色实跑 account/setting/progress/favorite/play_event/
  child/audit_log 的 INSERT 与三张 public 表的 UPDATE，全部成功，同事务 ROLLBACK、残留 0；
- **幂等**：同一脚本连跑两次都是 exit 0（DO 块 + 条件授权）；
- 演练角色已全部 DROP，dev 库无 `story_app*` 残留。

**演练踩到并已修正的两个坑**（已写进 SQL 注释）：
1. `docker exec` **不加 `-i`** 时 heredoc 不会送进 psql —— 退出码 0、无输出，
   看起来像成功其实什么都没跑（我第一次就被这个骗了，及时用输出核对才发现）。
2. 原 §5.2/§5.3 核对 SQL 写错：`GROUP BY 1,2` 报 "aggregate functions are not
   allowed in GROUP BY"；序列权限视图列名是 `object_schema/object_name`。

### 25.3 两个顺带发现

1. **`app.setting` / `app.progress` 的 `id` 列没有默认值**，由应用侧显式生成
   （Prisma cuid）。手工 SQL 插入必须自带 id（演练时踩到 not-null 报错）。
2. `GRANT ... ON app.audio_cache` 在**生产当前会直接报错** —— 生产还没这两张表
   （迁移 1 未应用）。故 §3.5 改成 `to_regclass()` 条件授权：迁移前后跑都不报错，
   迁移后自动生效（§4 的 `ALTER DEFAULT PRIVILEGES` 是双保险）。

### 25.4 生产未被触碰（只读复核）

`story_app*` 角色数 = 0；`app` 仍 9 张表；`story_main` 仍 2197。

## 26. 生产环境变量模板改回惯例路径 `.env.prod.example`（2026-11-11）

上一轮我把模板放在 `docker/prod-env.example`，因为写入 `.env*` 路径被任务卡闸门的
secret-path 规则拦下（合理：防密钥类文件落仓库）。该拦截已获批准（卡 `c-mwbrm58b-mjgto`），
因此把模板**归位到惯例路径**，避免两个名字并存。

| 项 | 变化 |
| --- | --- |
| `.env.prod.example` | **新增**（模板，**要提交**） |
| `docker/prod-env.example` | **删除**（与上面内容重复，只保留一个来源） |
| `docker-compose.prod.yml` | 报错文案改指 `.env.prod.example` |
| `docs/product/12-prod-deploy-runbook.md` | 5 处路径引用更新 |
| 本文件 §24/§25 | 2 处路径引用更新 |

`.gitignore` 早先已写好的 `!.env.prod.example` 取反规则现在**有了实际作用**
（之前模板不在这个路径，那条规则是空转的）：

```bash
$ git check-ignore --no-index -q .env.prod.example   # exit 1 → 可提交 ✅
$ git check-ignore -q .env.prod                       # exit 0 → 仍被忽略 ✅
$ git status --short .env.prod.example
?? .env.prod.example                                  # 确实被 git 看见
```

### 复验（改路径后重跑 dry-run，确认没有回归）

```bash
$ docker compose -f docker-compose.prod.yml config --quiet          # exit 1
error while interpolating ...DATABASE_URL: required variable PROD_DATABASE_URL
  is missing a value: ...（见 .env.prod.example）                    # fail-fast 仍生效 ✅
$ docker compose --env-file .env.prod.example -f docker-compose.prod.yml config --quiet
exit 0                                                              # ✅
```

生产未被触碰：`app_tables=9`、`story_main=2197`。分支 `feat/platform-v2`，未提交。

> 遗留待办（上一轮 3-b 报告已提出，仍未决）：`scripts/m4-migrate-rehearsal.sh`
> 有未定义变量（`EXPECT_CATEGORY_AFTER` / `EXPECT_BAND_*`）导致第 [9] 步崩溃；
> 以及克隆库 `story_m4_rehearsal` 与 4 份旧快照待清理。

## 27. 修复演练脚本未定义变量 bug + 3-b 演练通过 24/24（2026-11-11）

按批准「先修演练脚本再迁移」，修 `scripts/m4-migrate-rehearsal.sh` 并跑通，**未进 3-c**。

### 27.1 根因

脚本声明了 8 个变量却**从未赋值**，在 `set -u` 下第 [9] 步一读就崩：

| 变量 | 状态 |
| --- | --- |
| `SNAP_MAIN` / `SNAP_CONTENT` / `SNAP_CATEGORY` / `SNAP_APP_TABLES` | 声明为空串，**无赋值**（`SNAP_METRICS` 同样赋空后没人用） |
| `EXPECT_CATEGORY_AFTER` / `EXPECT_BAND_3_6` / `EXPECT_BAND_6_9` / `EXPECT_BAND_9PLUS` | **从未声明**，第 539/550 行直接引用 → `unbound variable` 中止 |

这是某次「期望值改成从快照派生」的重构**只写了一半**：旧的硬编码期望值删了，新的解析代码没写。第 [6] 步那个 `✘ 基线行数 …（期望 //0）` 误报也是同一根因的第一次现形。

### 27.2 修法（只补机制，不改判定口径）

在克隆恢复后补上解析段：`db_metrics` 输出 `main|content|category|app_tables`
用 `IFS='|' read` 拆进 `SNAP_*`；另从克隆查分级三档得 `SNAP_BAND_*`；
`ADDED_CAT2` 改为**真的探测** id=2 是否存在（原来恒为 0）；八项逐一防空校验。

`EXPECT_*` 一律取快照值（保持「不硬编码」的既定设计）：
`EXPECT_CATEGORY_AFTER=SNAP_CATEGORY`、`EXPECT_BAND_*=SNAP_BAND_*`。

### 27.3 结果：24/24 通过，exit 0

```
[9] 校验迁移结果   ✔×10  行数 2197/2197/14、分级 721/1176/300、
                        聊斋全 9+、app 建表 11、新增列 9、空值 0、孤儿 0
[10] 回滚           ✔×2   从快照重建后行数与快照一致、app 表数 11
[11] 收尾           ✔×3   克隆已删、快照留 3 份、story_dev 全程未变
✔ 迁移演练通过：24 项全部成功
```

**连跑两次都是 24/24**（第 2 次 exit 0），第 [10] 步回滚**首次真正被执行到**。

> ⚠️ **不是 25/25**：实测执行 24 项，另 1 项是**预期 warning**（P3005 —— prisma
> 拒绝在非空 schema 上 deploy，属既有库设计行为，不计通过）。文档里「25/25」
> 是重构前后遗留的陈旧说法，已更新 07/08/12 三处。

### 27.4 反证：这批校验不是「永远通过」

故意把 `EXPECT_BAND_3_6` 改成 `SNAP_BAND_3_6+1` 后重跑：

```
✘ 分级异常：3-6=721 6-9=1176 9+=300（期望 722/1176/300）
✘ 迁移演练失败：23 项成功、1 项失败          exit=1
```

即校验确实在比对真实值（该临时副本已删除，正本 sha256 未变）。

### 27.5 生产 zero-write 复核

`app_tables=9`、`story_main=2197`、`categories=15`、无 `audio_cache`、无 `account.status`。
克隆库已由脚本自行清理；`story_dev` 指纹 `2197|2197|14|11` 未变。

**3-c（生产迁移）与第 4 步（启动生产栈）未执行**，等下一步指令。

## 28. 演练遗留（克隆库 + 快照）登记进 dev 清理清单（2026-11-11）

按批复：**不执行 DROP、不删快照**，只登记，留待收尾合并授权。

### 28.1 登记内容（`11-dev-cleanup.md`）

| 项 | 实测 | 处置 |
| --- | --- | --- |
| `story_m4_rehearsal` 库 | 18 MB，0 连接 | 新增登记为**待删** |
| `.m4-rehearsal/` 下快照 | **3 份**，合计 13 MB | 新增登记为**待删**（建议整目录删） |

同时更新该文档：待删库 3 → 4 个（合计约 88MB）；新增「§3 快照文件清单」；
待执行命令补上克隆库与快照目录；章节号顺延修正（原先新增一节后出现两个「§4」）；
安全性论证补第 6 条（快照可重建）。

### 28.2 与批复描述的一处出入（按实测登记）

批复写「4 份旧快照」，**实际磁盘上是 3 份**（`ls -1 .m4-rehearsal/*.dump | wc -l` = 3）。
原因是脚本第 [11] 步的保留策略（只留最近 3 份）生效过。我按实测值登记为 3，
并在文档里显式标注了这处出入，没有按 4 记。

### 28.3 为什么 `story_m4_rehearsal` 会残留（口径澄清）

它本是脚本自建自删的中间库，正常不该人工登记。本次进清单的原因链：
1. 我按批准的卡做「手工模拟回滚」→ 建出克隆库；
2. 清理用的 DROP（对应卡 `c-mwbt77pw-14w5lm`）被任务卡闸门拦下，我没有升级权限绕过；
3. 批复明确要求不删、只登记。

**不是脚本异常** —— 脚本正常跑通时第 [11] 步会自删（实测两次 24/24 都正常清理）。
故 §27.5 当时写的「克隆库已由脚本自行清理」在那一刻是对的；
本次手工回滚又建了一个，即为本条登记的对象。

### 28.4 本轮未执行任何删除（只读复核）

`story_m4_rehearsal | 18 MB` 仍在；快照 count = 3、`du -sh .m4-rehearsal` = 13M。
生产未触碰（`app_tables=9`、`story_main=2197`、`categories=15`）。

> 小插曲：本轮追加本条日志时，含 DROP / `rm -rf` 字样的 heredoc **被任务卡闸门
> 判为 destructive 而拦下**（卡 `c-mwbt8vdz-154uq4`）—— 即使只是往文档里写文字。
> 改用文件编辑工具写入，未绕过闸门、也未请求扩权。

## 29. 遗留克隆库 story_m4_rehearsal 已删除（2026-11-11）

§28 登记的那个克隆库，其对应卡 `c-mwbt77pw-14w5lm` 随后获批，已执行清理：

```
$ docker exec story-dev-postgres psql -U storydev -d story_dev -tAc \
    "DROP DATABASE IF EXISTS story_m4_rehearsal;"
DROP DATABASE

$ ... "SELECT datname FROM pg_database WHERE datname LIKE 'story%' ORDER BY 1;"
story_dev
story_m21_r1
story_probe_mig
story_rehearsal
story_test
```

`story_m4_rehearsal` 已从库列表消失。

### 29.1 同步更新 `11-dev-cleanup.md`

| 位置 | 改动 |
| --- | --- |
| §2 库清单 | 该行改为「**已删**」，并保留原因链作历史留痕（不再是待办） |
| §1 规模 | 待删临时库 5 → **4** 个，合计 88MB → **70MB** |
| §4 待执行命令 | 从批量命令里移除它（已单独删），加一行注释说明 |
| §5 安全性论证 | 措辞由「本次残留已说明原因」改为「不入本批清单」 |

所以现在**待删仍剩 3 个库**（`story_m21_r1`/`story_probe_mig`/`story_rehearsal`）
与 **3 份快照（13MB）**，都仍按原计划留待合并授权。

### 29.2 复核

- `story_dev` 未受影响：指纹 `2197|2197|14|11`
- **生产未被触碰**：`app_tables=9`、`story_main=2197`、`categories=15`、
  账本仍 1 条（`20261109000000_init`）
- 分支 `feat/platform-v2`，未提交

### 29.3 闸门小插曲（第二次）

本轮用 python heredoc 批量改文档时，因正文含 DROP 字样**再次被判 destructive**
（卡 `c-mwbtrel7-16q3kr`）。同样改用文件编辑工具完成，未绕过闸门。
两轮下来可确认：闸门对**文本里出现 SQL 关键字**也会拦，即使操作对象只是 markdown。

