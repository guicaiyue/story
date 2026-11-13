# 小故事铺 2.0 · 服务端（M1）

给中国家庭的「睡前 20 分钟」——孩子自己会听，妈妈放心去忙。

本目录是 **M1 服务端骨架**：内容 / 用户 / 播放 / 运营四域的 API，读取
**dev 库中从生产复制来的 2197 条真实内容**。产品依据见 [`docs/product/`](../../docs/product/)，
技术决策见 [`03-decisions.md`](../../docs/product/03-decisions.md)。

> ⚠️ **生产库只读（03-decisions D7）**：生产 `story` 库正在为 storynook.cn 提供内容，
> **禁止任何写操作**（ALTER/INSERT/CREATE/DROP）。开发一律使用独立 dev 库；
> 迁移文件是唯一交付物，**不在生产执行**。

## 快速开始

```bash
# 1. 建 dev 库（一次性；容器 + 数据）
cd apps/server
docker run -d --name story-dev-postgres \
  --network dsh-dev_default \
  -e POSTGRES_USER=storydev \
  -e POSTGRES_PASSWORD=storydev_local_only \
  -e POSTGRES_DB=story_dev \
  -v story-dev-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine

# 2. 从生产库「只读」导出内容并重建 dev 库（2197 条真实数据）
./scripts/dev-db.sh dump      # 仅 SELECT/COPY TO STDOUT，不写生产
./scripts/dev-db.sh restore   # 建 legacy 结构 + 灌入内容

# 3. 环境变量（本目录）
cp ../../.env.example .env
#    默认值已指向 story-dev-postgres，只需把 CHANGE_ME 换成 storydev_local_only

# 4. 安装依赖（从仓库根目录执行，monorepo workspace）
cd ../.. && pnpm install && cd apps/server

# 5. 应用数据库迁移到 dev 库（幂等，可重复执行）
pnpm db:migrate

# 6. 启动开发服务（热重载）
pnpm dev
```

启动后验证：

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true,"data":{"status":"ok","db":"up","latencyMs":3,...}}
```

`/api/health` 返回 200 且 `db: "up"` 即代表服务与数据库连通。

### dev 库是什么

| 项 | 值 |
| --- | --- |
| 容器 | `story-dev-postgres`（`postgres:16-alpine`，网络 `dsh-dev_default`） |
| 库 | `story_dev`（联调） / `story_test`（测试） |
| 角色 | `storydev`（**非**超级用户，因此迁移必须在任意角色下可运行） |
| 数据 | 生产 legacy 三列的真实拷贝，2197 / 2197 / 15 行 |

`scripts/dev-db.sh` 子命令：`dump`（生产只读导出）、`restore`（重建 dev 库）、`reset`（仅清空）。
导出仅使用 `COPY (SELECT ...) TO STDOUT`，**不会修改生产库**。

创建测试库（`restore` 不建它）：

```bash
docker exec story-dev-postgres psql -U storydev -d story_dev \
  -c "CREATE DATABASE story_test OWNER storydev;"
```

## 测试

```bash
pnpm test        # 自动准备测试库后运行全部用例（44 个）
pnpm test:setup  # 只重建测试库（灌入固定 fixture）
```

测试**不会**碰生产库：`TEST_DATABASE_URL` 指向独立的 `story_test`，
`tests/helpers/test-db.ts` 会先建 legacy 表、再跑真实迁移、最后写入少量固定数据，
因此断言可以精确计数（生产库的 2197 条与 fixture 的 4 条互不干扰）。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发模式（tsx watch，热重载） |
| `pnpm build` | 编译到 `dist/` |
| `pnpm typecheck` | 类型检查（不产出文件） |
| `pnpm test` | 准备测试库 + 运行全部用例 |
| `pnpm db:migrate` | 应用 `prisma/migrations/*.sql`（幂等） |
| `pnpm db:studio` | Prisma Studio 可视化查看数据 |

> `prisma migrate dev` **禁止使用**：它会尝试重建已有 2197 条真实内容的表。
> 迁移统一走 `pnpm db:migrate`，已应用的迁移记录在 `public._m1_migrations`。

## 目录结构

```
apps/server/
├── prisma/
│   ├── schema.prisma          # 映射真实库结构（public 老表 + app 新表）
│   ├── legacy-schema.sql      # M1 之前的 legacy 结构（供测试/dev 重建）
│   ├── production-grant-tightening.sql  # 生产授权收紧（未执行，待批准）
│   └── migrations/            # 追加式 SQL 迁移（仅对 dev 执行）
├── scripts/
│   ├── dev-db.sh              # 建/重建 dev 库（从生产只读导出）
│   ├── migrate.mjs            # 幂等迁移执行器
│   └── split-sql.mjs          # SQL 分句（正确处理 DO $$ 块）
├── src/
│   ├── app.ts                 # Fastify 组装 + 统一错误/响应
│   ├── contract.ts            # 响应封套、错误码、共享 zod schema
│   ├── db.ts                  # Prisma 客户端
│   ├── env.ts                 # 环境变量校验（缺失即报错）
│   ├── index.ts               # 启动入口
│   ├── load-env.mjs           # .env 加载（TS/MJS 共用）
│   ├── routes/                # route 层：只做校验与响应
│   └── services/              # service 层：业务逻辑，不碰 HTTP
└── tests/                     # 集成测试 + 测试库 fixture
```

分层约定（02-architecture §6）：route → service → repository，
route 不写 SQL，service 不碰 HTTP。

## API

统一前缀 `/api`，响应恒为 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。

### 公开（无需登录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含数据库连通性） |
| GET | `/api/stories` | 故事列表：`page` `pageSize` `categoryId` `ageBand` `q` `featured` |
| GET | `/api/stories/:id` | 详情，正文来自 `story_content` |
| GET | `/api/stories/:id/audio` | **TTS 合成音频**（MP3，支持 Range，见下） |
| GET | `/api/categories` | 分类列表（含已发布故事数） |
| GET | `/api/home` | 首页聚合：今晚推荐 / 精选 / 分类 / 继续听 |
| POST | `/api/auth/register-device` | 游客登录 |
| POST | `/api/auth/login` | 手机号 + 验证码 |
| POST | `/api/auth/send-code` | 请求验证码（M1 为 no-op adapter） |
| POST | `/api/plays` | 上报播放事件（允许匿名） |

### 音频（TTS 实时合成 + 缓存）

所有者决策 c-mw99xnkq-2ehou：音频由服务端按需合成，不用真实 mp3 文件。

```
GET /api/stories/:id/audio
```

| 行为 | 说明 |
| --- | --- |
| 首次请求 | 调 edge-tts（`msedge-tts`）合成，写盘并记入 `app.audio_cache`，再回填 `story_main.duration_sec` 与 `audio_url` |
| 再次请求 | 直接读缓存文件（响应头 `X-Audio-Cache: hit`） |
| Range | 支持 `bytes=a-b` / `bytes=a-` / `bytes=-N`，返回 `206`；越界返回 `416`。**播放器 seek 依赖它** |
| 音频格式 | MPEG2 Layer3，24kHz / 48kbps / 单声道（约 0.9MB/分钟） |
| 磁盘位置 | `AUDIO_CACHE_DIR`（默认 `apps/server/.audio-cache`），**不进 Postgres** |
| 时长来源 | 由合成出的 MP3 本身量出（`music-metadata`），**不是正文字数估算** |

响应头：`X-Audio-Duration`（秒）、`X-Audio-Voice`、`X-Audio-Cache`（hit/miss）。

相关环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TTS_VOICE` | `zh-CN-YunxiNeural` | edge-tts 音色 |
| `TTS_RATE` | `-10%` | 语速，睡前内容刻意放慢 |
| `AUDIO_CACHE_DIR` | `.audio-cache` | 缓存目录 |

批量回填（先小批量验证，再全量；断点续跑）：

```bash
node scripts/tts-backfill.mjs --limit=5      # 先试 5 条
node scripts/tts-backfill.mjs                # 全量（已缓存的自动跳过）
node scripts/tts-backfill.mjs --retry-failed # 重试失败的
node scripts/tts-backfill.mjs --longest-first # 反过来（默认短到长）
```

默认**从短到长**处理：长故事要分多块合成（块间还要留间隔），
按 id 顺序跑会把它们均匀散布、拖慢「大部分内容多久可用」。
实测从短到长比按 id 顺序快约 7 倍（0.42 条/秒 vs 0.06 条/秒）。

启动时会先对账一次：`app.audio_cache` 与 `story_main` 不一致就补齐，
因此中途被打断、或早期版本漏写 `story_main` 时，重跑一次即可自愈。

脚本会**拒绝在生产库上运行**（03-decisions D7）。

### 需登录

`GET/PUT /api/me`、`GET/POST/PATCH /api/children`、`GET/PUT /api/settings`、
`PUT /api/progress/:storyId`、`GET /api/progress`、
`GET/POST/DELETE /api/favorites[/:storyId]`

### 管理端（需 `admin` / `editor`）

`POST /api/admin/auth/login`、`GET /api/admin/dashboard`、
`GET/PATCH /api/admin/stories[/:id]`、`POST /api/admin/stories/:id/submit|review`、
`GET/PATCH /api/admin/categories[/:id]`、`GET/PATCH /api/admin/banners[/:id]`、
`GET /api/admin/accounts`、`GET /api/admin/analytics/overview`、`GET /api/admin/audit`

> 发布 / 删除仅 `admin` 可操作（02-architecture §5）。

## M1 关键约束

1. **生产库只读（D7）**：`pnpm db:migrate` 只应指向 dev 库。生产库仅接收
   migration 文件，执行需人工批准。生产授权收紧脚本
   `prisma/production-grant-tightening.sql` **已就绪但未执行**。
2. **内容安全默认生效**：公开接口硬编码 `status = published`，调用方无法放宽。
   00-research P1 的 299 条聊斋/怪谈/恐怖内容中，恐怖/怪谈/推理（7 条）已标记
   `age_band = '9+'`，不会进入儿童端默认结果。
3. **鉴权是占位实现**：验证码固定为 `FIXED_SMS_CODE`（默认 `123456`），
   不发真实短信（D4）。真实服务商通过 `SmsAdapter` 接口接入，路由无需改动。
   游客升级规则尚未定稿（D6）。
4. **新表在独立 schema `app`（D8）**：用户/儿童/播放等表不在 `public`，
   不向 pREST 角色授权。
5. **老站并存**：legacy 三表在 dev 库中保持原结构可读；生产库的 pREST 通道不变。

## 已知遗留

- ⚠️ **pREST 公网路径以 postgres 超级用户连接**，绕过所有 GRANT 检查，
  因此授权收紧对这条路径无效。详见
  [03-decisions.md](../../docs/product/03-decisions.md) §7 —— **需优先排查**。
- 音频（`audioUrl`）与封面（`coverUrl`）全部为空，M1 不产出音频资产；
  时长 `durationSec` 默认 0，待 TTS 任务补齐。
- 老站遗留的重复空分类（id=2「睡前故事」）保留未删。
- 管理端 `/api/admin/analytics/overview` 目前只返回按时段分布，
  播放趋势与内容排行待 M2 补。
