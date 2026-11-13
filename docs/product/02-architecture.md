# 小故事铺 2.0 · 信息架构与数据模型

> 给开发会话的实现依据。原则：**契约先行**——先定表结构与 API，再写界面；三端共用同一份契约。

## 1. 仓库结构

```
story/
├── apps/
│   ├── server/          # Node 22 + TS + Fastify + Prisma
│   ├── admin/           # React 18 + Vite + TS + Ant Design 5
│   └── app/             # Flutter 3
├── packages/
│   └── contract/        # 共享类型与 OpenAPI 生成（可选，先由 server 导出）
├── docs/product/        # 产品文档（本目录）
├── legacy/              # 现有静态站迁入（保留可运行）
└── docker/              # compose / nginx
```

迁移原则：现有 `index.html`、`js/`、`css/`、`img/` 先原地不动，M4 再迁入 `legacy/`，避免一上来打断线上。

## 2. 信息架构

### 2.1 后台（Web）

```
登录
└─ 数据看板
内容
├─ 故事列表（筛选/搜索/批量）
├─ 故事编辑（正文/分类/年龄档/标签/封面/音频/状态）
└─ 审核队列
运营
├─ 分类管理（排序/合并/停用）
├─ 推荐位（首页 banner / 精选 / 场景歌单）
└─ 每日推荐
用户
├─ 家庭列表
├─ 儿童档案
└─ 播放记录（只读）
数据
├─ 播放趋势
├─ 内容排行
└─ 分类/时段分布
系统
├─ 管理员与角色
├─ 操作日志
└─ TTS 任务
```

### 2.2 安卓 App

```
启动
├─ 首次：选择孩子年龄 → 进入
└─ 老用户：首页
首页
├─ 今晚听什么（大卡片，一键播放）
├─ 继续听
├─ 场景：哄睡 / 叫早 / 出行
├─ 分类入口
└─ 我的（底部 tab）
播放器（全屏）
├─ 封面 / 标题 / 年龄档
├─ 播放控制 / 进度 / 15 秒
├─ 定时（15/30/45/听完）
├─ 收藏
└─ 自动下一集
我的
├─ 儿童档案
├─ 继续听 / 收藏 / 历史
├─ 家长中心（家长门后）
└─ 设置
```

## 3. 数据模型（PostgreSQL / Prisma）

### 3.1 内容

> 本节已按生产库实测结构修正（2026-11-09，见 03-decisions.md §1）。原文假设 `Story`
> 是含 `content` 的单表，与实际不符：正文在独立的 `story_content` 表，且 legacy
> 表没有 `slug`/`tags`/`status`/`coverUrl`/`audioUrl`/`ageBand` 等列。
> M1 决策（D1/D3）：与 pREST **共库同名表直读**，新列通过 `ALTER TABLE` 追加。

`Category`（`public.story_category`）：

```prisma
model Category {
  id      Int     @id @default(autoincrement())
  name    String
  sortId  Int?    @default(0) @map("sort_id")   // 无 slug、无 status
  stories Story[]
  @@map("story_category")
  @@schema("public")
}
```

`Story`（`public.story_main`）—— 元数据；`[]` 标注为 M1 新增列：

```prisma
model Story {
  id           Int       @id @default(autoincrement())
  title        String
  excerpt      String?
  categoryId   Int?      @map("category_id")     // 可为空，生产库无 NOT NULL
  categoryName String?   @map("category_name")   // 冗余列，读取以 category.name 为准
  length       Int?      // ⚠️ 正文字数，不是播放时长
  createdAt    DateTime? @default(now()) @map("created_at")

  ageBand     String    @default("3-6")   @map("age_band")     // [M1 新增]
  tags        String[]  @default([])                            // [M1 新增]
  status      String    @default("published")                   // [M1 新增] 回填 published
  durationSec Int       @default(0)       @map("duration_sec")  // [M1 新增] 真时长
  coverUrl    String?                     @map("cover_url")     // [M1 新增]
  audioUrl    String?                     @map("audio_url")     // [M1 新增]
  featured    Boolean   @default(false)                          // [M1 新增]
  publishedAt DateTime?                   @map("published_at")  // [M1 新增]
  updatedAt   DateTime  @default(now())   @updatedAt @map("updated_at") // [M1 新增]

  category   Category?      @relation(fields: [categoryId], references: [id])
  content    StoryContent?
  progresses Progress[]
  favorites  Favorite[]
  plays      PlayEvent[]
  @@index([status, ageBand])
  @@index([categoryId])
  @@map("story_main")
  @@schema("public")
}
```

`StoryContent`（`public.story_content`）—— 正文，与 `Story` 1:1：

```prisma
model StoryContent {
  id      Int     @id @default(autoincrement())
  storyId Int?    @unique @map("story_id")
  content String?
  story   Story?  @relation(fields: [storyId], references: [id])
  @@map("story_content")
  @@schema("public")
}
```

老站前端读 `story_main.length` 显示「N 字」，并已按 `voice_content || content`
前向兼容（`js/app.js:977`）；`voice_content` 列当前不存在，属预留。


### 3.2 用户

```prisma
model Account {
  id        String   @id @default(cuid())
  phone     String?  @unique
  nickname  String   @default("")
  role      String   @default("parent") // parent | admin | editor
  createdAt DateTime @default(now())
  family    Family?
  children  Child[]
  @@map("account")
}

model Family {
  id        String   @id @default(cuid())
  accountId String   @unique
  account   Account  @relation(fields: [accountId], references: [id])
  name      String   @default("我的家")
  createdAt DateTime @default(now())
  @@map("family")
}

model Child {
  id        String   @id @default(cuid())
  accountId String
  account   Account  @relation(fields: [accountId], references: [id])
  nickname  String
  birthday  DateTime?
  ageBand   String   @default("3-6")
  avatar    String?
  createdAt DateTime @default(now())
  @@map("child")
}
```

### 3.3 播放与行为

```prisma
model Progress {
  id        String   @id @default(cuid())
  accountId String
  storyId   Int
  positionSec Int    @default(0)
  updatedAt DateTime @updatedAt
  @@unique([accountId, storyId])
  @@map("progress")
}

model Favorite {
  id        String   @id @default(cuid())
  accountId String
  storyId   Int
  createdAt DateTime @default(now())
  @@unique([accountId, storyId])
  @@map("favorite")
}

model PlayEvent {
  id        String   @id @default(cuid())
  accountId String?
  childId   String?
  storyId   Int
  event     String   // start | pause | complete | stop
  positionSec Int    @default(0)
  at        DateTime @default(now())
  @@index([at])
  @@map("play_event")
}

model Setting {
  id        String   @id @default(cuid())
  accountId String   @unique
  dailyLimitMin Int  @default(0)     // 0 = 不限
  sleepTimerMin Int  @default(30)
  ageFilter String   @default("3-6")
  parentGate Boolean @default(true)
  @@map("setting")
}
```

### 3.4 运营与审计

```prisma
model Banner {
  id        Int      @id @default(autoincrement())
  title     String
  imageUrl  String
  targetType String  @default("story") // story | category | url
  targetId  String?
  sort      Int      @default(0)
  status    String   @default("active")
  @@map("banner")
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String
  action    String   // story.publish / story.reject / login ...
  target    String
  detail    Json?
  at        DateTime @default(now())
  @@index([at])
  @@map("audit_log")
}
```

## 4. API 契约（MVP）

统一前缀 `/api`，返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。

### 4.1 公开端（App / 老站）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stories` | 分页、`categoryId` `ageBand` `status=published` `q` `featured` |
| GET | `/api/stories/:id` | 详情（含正文） |
| GET | `/api/categories` | 分类列表（含故事数） |
| GET | `/api/home` | 首页聚合：今晚推荐、场景歌单、继续听（需登录） |
| POST | `/api/auth/guest` | 游客登录，返回 token |
| POST | `/api/auth/login` | 手机号 + 验证码（MVP 用固定验证码） |
| GET/PUT | `/api/me` | 账号信息 |
| GET/POST/PATCH | `/api/children` | 儿童档案 |
| PUT | `/api/progress/:storyId` | 上报进度 |
| POST/DELETE | `/api/favorites/:storyId` | 收藏 |
| POST | `/api/plays` | 播放事件 |

### 4.2 管理端（需 admin/editor）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/auth/login` | 管理员登录 |
| GET | `/api/admin/dashboard` | 看板聚合 |
| GET | `/api/admin/stories` | 管理列表（含 draft） |
| POST/PATCH/DELETE | `/api/admin/stories/:id` | 内容 CRUD |
| POST | `/api/admin/stories/:id/submit` | 提交审核 |
| POST | `/api/admin/stories/:id/review` | 通过/驳回 |
| GET/PATCH | `/api/admin/categories` | 分类管理 |
| GET/PATCH | `/api/admin/banners` | 推荐位 |
| GET | `/api/admin/accounts` | 家庭/账号 |
| GET | `/api/admin/analytics/overview` | 趋势聚合 |
| GET | `/api/admin/audit` | 操作日志 |

## 5. 鉴权与权限

- JWT（`Authorization: Bearer`），`sub=accountId`，`role`。
- 公开接口允许匿名读取 published 内容；写操作必须登录。
- 管理端接口要求 `role in (admin, editor)`；发布/删除仅 `admin`。
- 游客账号可升级为手机号账号（保留数据）。

## 6. 关键实现约束

1. **分层**：route → service → repository；route 不写 SQL，service 不碰 HTTP。
2. **校验**：所有入口 zod 校验；错误码统一。
3. **迁移**：Prisma migration 必须可回滚；种子脚本幂等。
4. **测试**：service 单测 + 接口集成测试（supertest）；每个 PR 至少覆盖新增接口。
5. **前端**：后台用 Ant Design 组件，不手搓表格/表单；App 用统一 Design Token。
6. **可观测**：结构化日志（pino）、慢查询、错误上报（先写文件）。

## 7. 与老站的关系

- 老站继续用 pREST 读 `story_main` / `story_content` / `story_category`；新服务端读同一库，逐步接管。
- 数据迁移脚本：把老表数据导入新 `Story`（保留 legacyId），`category_name` 映射到 `Category`。
- 迁移完成后老站可改为调用新 API（M4）。
