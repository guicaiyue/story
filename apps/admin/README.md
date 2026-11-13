# 小故事铺 2.0 · Web 后台管理（M2）

给内容团队用的运营后台：选品、审核、上架、看数据。

技术栈：**React 18 + Vite + TypeScript + Ant Design 5**。
视觉规格来自 [`docs/design/admin-web/`](../../docs/design/admin-web/)（纸感后台）。

> ⚠️ **生产库只读（03-decisions D7）**：本后台联调的是 **dev 库**（`story-dev-postgres`），
> 不碰生产库、不碰生产配置。

## 快速开始

前置：M1 服务端已在 `:3000` 跑起来，且指向 dev 库。

```bash
# 1. 准备 dev 库与数据（在 apps/server 下，只需一次）
cd ../server
docker run -d --name story-dev-postgres --network dsh-dev_default \
  -e POSTGRES_USER=storydev -e POSTGRES_PASSWORD=storydev_local_only \
  -e POSTGRES_DB=story_dev -v story-dev-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
./scripts/dev-db.sh dump && ./scripts/dev-db.sh restore   # 2197 条真实内容
pnpm db:migrate
docker exec story-dev-postgres psql -U storydev -d story_dev -c "CREATE DATABASE story_test OWNER storydev;"

# 2. 灌入后台所需数据（管理员账号 / 审核队列 / 播放事件 / 推荐位）
node scripts/seed-dev-admin.mjs

# 3. 启动 M1 服务端（:3000）
pnpm dev

# 4. 另开终端启动后台（:5173，/api 代理到 :3000）
cd ../admin
pnpm install
pnpm dev
```

打开 <http://localhost:5173>。

### 登录账号（dev）

| 角色 | 手机号 | 验证码 |
| --- | --- | --- |
| 超级管理员 | `13900000001` | `FIXED_SMS_CODE`（默认 `123456`） |
| 编辑 | `13900000002` | 同上 |

M1 使用固定验证码，**不发真实短信**（03-decisions D4）。
普通家长账号（如 `13800000001`）登录后台会得到 **403 该账号无管理权限**。

## 测试

```bash
pnpm test        # 46 个用例（vitest + testing-library）
pnpm typecheck   # tsc
pnpm build       # 产出 dist/
```

服务端另有 66 个用例（含后台接口与一个时区回归用例）：

```bash
cd ../server && pnpm test
```

## 页面与接口对应

| 页面 | 路由 | 主要接口 |
| --- | --- | --- |
| 登录 | `/login` | `POST /api/admin/auth/login` |
| 数据看板 | `/dashboard` | `GET /api/admin/dashboard`、`/api/admin/analytics/overview` |
| 故事列表 | `/stories` | `GET /api/admin/stories`（分页/筛选/搜索） |
| 故事编辑 | `/stories/:id` | `GET /api/admin/stories/:id`、`PATCH`、`POST /submit` |
| 审核队列 | `/review` | `GET /api/admin/stories?status=review`、`POST /review` |
| 分类与推荐位 | `/ops` | `GET/PATCH /api/admin/categories`、`GET/PATCH /api/admin/banners` |
| 家庭与儿童档案 | `/families` | `GET /api/admin/accounts` |
| 数据中心 | `/analytics` | `GET /api/admin/analytics/overview`、`/api/admin/stories` |
| 管理员与日志 | `/system` | `GET /api/admin/audit`、`GET /api/me` |

**没有任何写死的假数据**：所有表格与指标都来自上面的真实接口。接口不可用时展示
错误文案 + 重试按钮（不白屏）。

## 视觉

token 与设计稿一致（[`src/theme.ts`](src/theme.ts)）：

| 用途 | 值 |
| --- | --- |
| 暖米白底 | `#FBF7F0` |
| 暖橙主色 | `#D98E5A` |
| 暖黑文字 | `#3A3330` |
| 深青辅助 | `#3F5B57` |
| 圆角 | 卡片 16px / 控件 10–12px |

字体 MiSans（沿用站点），阴影为纸张层叠（不做玻璃/霓虹）。
信息密度参考 Ant Design；表格用 `size="small"`。

## 目录结构

```
apps/admin/
├── src/
│   ├── api/client.ts        # 统一请求封套解析 + 全部接口封装
│   ├── auth.tsx             # 登录态（localStorage JWT）
│   ├── theme.ts             # 设计 token
│   ├── useAsync.ts          # 单请求数据获取
│   ├── components/          # AppLayout（侧栏/顶栏）+ 纸卡/异步包装
│   ├── pages/               # 9 个页面，每个都有 *.test.tsx
│   └── test/                # 测试 setup 与 helper
└── vite.config.ts           # :5173 + /api 代理到 :3000
```

## 已修复的真实缺陷

**睡前时段占比算错时区（严重）**：`app.play_event.at` 是 `timestamptz`，
服务端会话跑在 UTC，而产品的「睡前时段 20:00–23:00」是中国本地时间。
原实现按 `EXTRACT(HOUR FROM at)` 分组，把所有播放**提前 8 小时**归桶，
导致这个核心指标被低估一个数量级（实测 **6.2% vs 真实 66.1%**）。

修复：按 `at AT TIME ZONE 'Asia/Shanghai'` 分组，把口径钉死而不依赖会话时区
（[`apps/server/src/services/admin-service.ts`](../server/src/services/admin-service.ts)），
并补了一个回归用例（`apps/server/tests/admin.test.ts`）。

## 未完成项（M2 范围外，均已在界面上明确标注）

1. **正文编辑**：故事编辑页的正文是只读的。写回 `public.story_content`
   需要服务端新增接口，属 M2 之后范围 —— 界面上已注明，不做假的可编辑框。
2. **排行/趋势/分类分布**：`/api/admin/analytics/overview` 目前只提供按小时聚合，
   因此数据中心**只展示可核验的数字**，没有虚构「内容 Top」「播放趋势」。
   需要服务端补聚合端点。
3. **新建/删除推荐位**：M1 只提供 `PATCH /api/admin/banners/:id`，
   所以「分类与推荐位」页只支持状态切换与排序，没有新增/删除按钮。
4. **新建管理员账号**：「管理员与日志」只展示当前登录账号与操作日志，
   M1 未提供管理员列表与创建接口。
5. **故事列表排序**：服务端固定按 `id DESC`，未提供按播放量/更新时间排序的参数。

以上 1–5 都是**为了避免假交互刻意留空**，而不是遗漏。
