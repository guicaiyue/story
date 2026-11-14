# apps/admin 前端深度分析报告（技术方案决策用）

> 审计对象：`apps/admin`（React 18 + Vite 5 + TS + antd 5 + react-router 6，nginx 托管静态产物）
> 方法：只读源码 + git 历史 + 服务端相邻代码交叉核对；未执行 install/build/docker。
> 约定：**【事实】**= 可从代码直接验证；**【建议】**= 主观判断；**【暂缺】**= 证据不足。
> 仓库：main @ `7d698d1`（2026-11-14）；admin 首次提交 `edc0dd7`（2026-11-13）。

## 0. 结论速览

架构是「单文件 API 客户端 + 自研 hook + 9 个静态导入页面」，体量小、契约清楚、测试密度高（63 用例），作为 0.1 内测后台合格。三条结构性问题影响下一步方案（详见 §2）：

1. **鉴权**：token 存 localStorage，服务端 JWT 未设 `exp`（`app.ts:36`、`auth-routes.ts:23/30/67`），前端无刷新、401 只清 localStorage 不清 React 状态（`client.ts:98-101` ↔ `auth.tsx:20,35`），用户停在「看着像登录、每接口都报错」的中间态。
2. **审计断链**：故事元数据 PATCH 与分类改名都不写 `audit_log`（`admin-routes.ts:141-162`、`236-243`），而前端 `SystemPage.tsx:20` 预置了 `category.update` 标签——审计表永远不会出现这两类操作，界面却暗示存在。
3. **无 RBAC 门控**：`App.tsx:55-73` 只有 `isAuthed`，editor 能打开「管理员与日志」看到「新增管理员」按钮（`SystemPage.tsx:271`），点了才吃 403；且 editor 可经 PATCH `status=published` 直接上架（`admin-routes.ts:26` + `StoriesPage.tsx:257-262`），绕过审核流。

## 1. 架构地图

### 1.1 路由与鉴权
【事实】`main.tsx:7-12` 用 `BrowserRouter`（依赖 nginx `try_files … /index.html`，`nginx.conf:70-72` 已实现）；`App.tsx:55-73` 两组路由：`/login` 与受 `RequireAuth` 保护的 8 个业务路由，`*` 兜底重定向；`RequireAuth` 是纯函数守卫（`App.tsx:45-49`），无 role 参数。

【事实】token 存 `localStorage['story_admin_token']`、账号存 `localStorage['story_admin_account']`（`api/client.ts:11-12,30-33`）；`client.ts:81-82` 每次请求读 `getToken()` 拼 `Authorization: Bearer`。无 httpOnly cookie、无 BFF、无刷新令牌。

【事实】401 处理：`client.ts:98-101` 清 session 后抛 `ApiError('UNAUTHORIZED')`，**不触发路由跳转**；`auth.tsx:30-32` 只有 `logout()` 同步清 React 状态。【建议】收敛到一处，`AuthProvider` 监听后清状态：

```ts
// client.ts
if (res.status === 401) {
  clearSession();
  sessionExpired.emit();          // 新增：通知 AuthProvider 跳 /login
  throw new ApiError('UNAUTHORIZED', '登录已过期，请重新登录', 401);
}
```

【事实】XSS 面：token 在 localStorage，任何 XSS 都能直接偷走；页面无 `dangerouslySetInnerHTML`（grep 无命中），内容字段全走 React 文本渲染，攻击面主要在「token 存储 + 无 CSP」（`nginx.conf` 无安全头，见 §3）。

### 1.2 状态管理
【事实】无 TanStack Query / Zustand / Redux；数据获取靠自研 `useAsync`（`useAsync.ts:17-49`）：`data/loading/error/reload` + `nonce` 重取 + `alive` 防卸载后 setState。页面级混用三种模式：`useAsync`（Dashboard/Analytics）、自写 `load()` + `useEffect`（Stories/Review/Families/Ops/System）、直接 `useEffect`（StoryEdit）。能力边界：无缓存/去重/失效、无默认 `AbortSignal`（`client.ts:57,88` 仅透传）、reload 置 `loading=true` 即**清空已显示数据**（`useAsync.ts:27`）、`fn` 不在依赖数组（`useAsync.ts:46-47`，闭包陈旧风险靠调用方自觉）。

### 1.3 API 客户端
【事实】`api/client.ts:77-110` 手写 fetch 封装：`buildUrl` 丢空值（`60-69`）、封套 `{ok:true,data}|{ok:false,error}`（`:9`）、`ApiError` 带 `code/status`（`:41-50`）、非 JSON 抛 `INTERNAL`（`:103-105`）；接口集中在 `api` 对象（`:220-297`）。

【事实】类型是**手写镜像**，不是从 zod 生成：`client.ts:113-214` 注释「对齐 apps/server 的 admin-routes.ts」，但服务端 `contract.ts` 已有 zod schema + `z.infer`；`pnpm-workspace.yaml:1-6` 声明 `packages/*`，仓库里**不存在 `packages/` 目录**。类型漂移只能靠人眼和测试兜（admin 单测全部 mock JSON，不校验 schema）。【建议】见 §5-2。

### 1.4 表单
【事实】`StoryEditPage.tsx:188-278` 用 antd `Form` + 受控字段，加载后 `setFieldsValue` 回填（`:50-61`）。校验只有两条：标题必填（`:191`）、正文非空 validator（`:262-269`）。【事实】服务端约束远更严（`admin-routes.ts:14-48,79-93`）：title ≤200、excerpt ≤1000、tags ≤20 且每项 ≤30、URL ≤500、正文 ≤50000、`ageBand` 枚举；前端在 `:207-231,215-217,271` 全无规则，错误要等 PATCH/PUT 落地后由服务端 400 返回，用户改完一轮才看到。

【事实】正文走独立「保存正文」按钮（`:243-276`）但**无二次确认**，且 `updateStoryContent` 是整篇替换语义（`client.ts:258`），无 `If-Match`/`updatedAt` 并发保护——两人同改一篇，后写者覆盖前写者。

## 2. 缺陷与风险清单（按严重度）

| # | 严重度 | 证据（文件:行） | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | 高 | JWT 无 `exp`：`app.ts:36`、`auth-routes.ts:23/30/67`；前端无刷新：`auth.tsx:14-17`、`client.ts:98-101` | token 永不过期 + localStorage = 长期凭证，泄露即永久接管 | 短期设 `expiresIn`（1h）+ 401 联动；中期 httpOnly cookie + BFF（§5-4） |
| 2 | 高 | 401 只清 localStorage、不清 React 状态：`client.ts:98-101` ↔ `auth.tsx:20,35` | 过期后留在后台，每页报错，只能手动登出 | 事件驱动登出（§5-1） |
| 3 | 高 | editor 可直接上架：`admin-routes.ts:26`（`status` 可选）+ `:141-143`（`anyRole`）；按钮 `StoriesPage.tsx:257-262` | 审核流被绕过，未审内容直进儿童端 | 服务端把 `status→published` 收口 admin-only |
| 4 | 高 | 故事 PATCH 无 audit：`admin-routes.ts:141-162`（8 处 `auditLog.create` 中无此项）；分类 PATCH 无 audit：`:236-243` | 改标题/年龄档/分类/上下架全无痕，无法追责 | 补写 `audit_log`（§5-12） |
| 5 | 高 | 前端无 RBAC：`App.tsx:45-73` 只有 `isAuthed`；`SystemPage.tsx:271` 按钮对 editor 可见 | 越权入口前置暴露，靠服务端 403 兜底 | 路由级 role 守卫（§5-8） |
| 6 | 中 | Dockerfile `COPY apps/admin/public`：`Dockerfile:54`、`Dockerfile.dockerignore:12`；仓库与全 git 历史均无该目录 | 干净 clone 后构建在该层失败；CI 不跑 build（`ci.yml:49-53`）故未暴露 | 删掉该行；CI 加 build（§5-11） |
| 7 | 中 | 硬编码假数据：`AppLayout.tsx:105`（`内容 {2197} 篇`）、`LoginPage.tsx:56-68`（2,197/15/0）；`README.md:78` 却声明无任何假数据 | 数据失真误导运营，发版后文案永不更新 | 从 `api.dashboard()` 取，或标注「截至 M1」 |
| 8 | 中 | 登录页暴露 dev 账号与验证码约定：`LoginPage.tsx:99-102`（`13900000001/2`、`FIXED_SMS_CODE`）；生产已改随机 8 位（`12-prod-deploy-runbook.md:297`） | 生产提示错误且泄露 dev 账号形态 | 按构建期 flag 区分文案 |
| 9 | 中 | 无错误边界：grep `ErrorBoundary/componentDidCatch` 无命中；`ui.tsx:53-91` 只处理加载/失败 | 任一渲染异常 = 白屏，违反自家「失败不能白屏」约束（`ui.tsx:50-52`） | React Error Boundary（§5-7） |
| 10 | 中 | 正文并发覆盖：`client.ts:258` 全量替换，无 `updatedAt` 前置条件；无未保存守卫 | 误导航/双编辑丢正文（单篇数万字） | 脏检查 + `If-Match`（§5-8） |
| 11 | 中 | 缓存覆盖不全：`nginx.conf:62-64` 只对 `= /index.html` 设 no-cache，`/` 走 `location /`（`:70-72`）无指令 | 用户常访问 `/`，启发式缓存可能拿到旧 `index.html`，发版不生效 | 对 `location = /` 与 `/index.html` 统一 no-cache（§5-9） |
| 12 | 低 | 无安全响应头（`nginx.conf` 仅 gzip/cache）；`app.ts:35` `cors({origin:true})` 回显任意源 | 公网域名缺纵深防御 | §5-9 |
| 13 | 低 | `AppLayout.tsx:32-41` 每次 `location.pathname` 变化都调 `api.dashboard()`；`DashboardPage.tsx:28` 同端点再拉一次 | 每次导航 +1 请求，两处重复 | 合并到 query 层（§5-1） |
| 14 | 低 | 无代码分割：`App.tsx:7-15` 静态导入 9 页；无 `manualChunks`/`build.target` | 首屏包 = 全站 | §5-3 |
| 15 | 低 | `tsconfig.json:18` `types:["vitest/globals"]` 使测试全局 API 泄漏进应用类型空间；`tsconfig.tsbuildinfo` 被提交进仓库 | 构建缓存与类型噪声 | 拆 `tsconfig.test.json`；gitignore |
| 16 | 低 | 无 a11y：grep `aria-label/skip` 无命中；无路由焦点复位；`SystemPage.tsx:231` 直接 `JSON.stringify(d)` | 键盘/读屏不可用，审计「详情」列不可读 | §5-10 |

## 3. 性能与工程化

【事实】缓存头：`/assets/` → `expires 30d` + `Cache-Control: public, immutable`（`nginx.conf:55-59`，配合 Vite 内容哈希文件名，正确）；`= /index.html` → `no-cache, no-store, must-revalidate`（`:62-64`）；**`/` 无指令**（见 §2-11）。压缩：`gzip on` + `gzip_types text/css application/javascript application/json image/svg+xml`（`:66-67`），未配 `gzip_vary`/brotli（nginx:alpine 默认不含 brotli 模块）。SPA fallback：`try_files $uri $uri/ /index.html`（`:70-72`）正确；`/api/` 走变量 + resolver（`:28-32`）规避启动顺序问题，音频 `proxy_read_timeout 120s` + `proxy_buffering off`（`:43-48`）合理。
【事实】包体积：`package.json:17` `antd ^5.22.5`，lockfile 解析 `5.29.3`；全部页面 `import { Button } from 'antd'`，v5 cssinjs 天然按需，**但**没有分包策略；`@ant-design/icons` 逐图标导入（`AppLayout.tsx:3-13`）是对的。【暂缺】首屏体积与 gzip 后大小（dist 不入库、未构建）。
【事实】工程化：`package.json:8-14` 有 dev/build/preview/typecheck/test；CI 只跑 typecheck + test（`ci.yml:46-53`），不跑 build、不跑镜像构建、无 coverage 工具（devDeps 无 `@vitest/coverage-v8`，`vite.config.ts:20-29` 无 coverage 配置）。

## 4. 测试体系（63 个用例）

【事实】63 个 `it` 分布在 6 个文件（`DashboardPage.test.tsx:5`、`LoginPage.test.tsx:4`、`OtherPages.test.tsx:26`、`ReviewPage.test.tsx:7`、`StoriesPage.test.tsx:11`、`StoryEditPage.test.tsx:10`）；栈 = vitest 2 + jsdom + Testing Library 16 + user-event 14（`package.json:24-34`）；setup 补 `matchMedia`/`ResizeObserver`（`test/setup.ts:6-28`）；`testTimeout: 20000`（`vite.config.ts:28`）。

覆盖：登录校验与 403、看板真实数字/错误重试/Authorization 头、列表分页-筛选-搜索-批量-空态、编辑页回填与 PATCH/PUT 语义分离（含「正文保存不得顺带 PATCH」反向断言，`StoryEditPage.test.tsx:159-164`）、审核通过/驳回与 403、分类与推荐位增删改排序、家庭档案脱敏、数据中心四端点、管理员增改停用与审计动作码翻译。**断言无快照**，主要靠 `data-testid` + 文案。

脆弱点（实现细节耦合）：
- 依赖 antd 在两字中文按钮里插空格：`OtherPages.test.tsx:112`（`'创 建'`）、`:137`（`'删 除'`）、`:476`（`'确 定'`）——升级 antd 或改 locale 即破。
- `StoriesPage.test.tsx:36-40` 用 `mockReturnValueOnce` 按顺序铺响应，而 `helpers.tsx:50-59` 注释明说「并发请求到达顺序不保证」，两者策略自相矛盾，靠「列表先发、分类后发」的细节侥幸通过。
- 选择器探进 antd 内部：`StoriesPage.test.tsx:73` `.ant-select-selector`、`:75` `.ant-select-item-option[title=…]`。
- 弱断言：`DashboardPage.test.tsx:32` `getAllByText('12').length > 0`、`OtherPages.test.tsx:415` `getAllByText(/超级管理员/)`。

关键缺失覆盖（grep 无命中）：`App.tsx` 路由/守卫/兜底、`auth.tsx` 登出与 401 联动、`api/client.ts`（封套错误、401 清理、query 编码、非 JSON）、`useAsync`（卸载竞态、reload）、nginx/Dockerfile、可访问性。**「401 后是否跳登录」这个最该测的行为恰恰没人测**，而它正是 §2-2 缺陷的来源。

## 5. 优化与重构方案

1. **TanStack Query 替代 useAsync（含 401 联动）**
现状 `useAsync.ts:17-49` 无缓存/失效，reload 清数据。改法：`@tanstack/react-query`，`queryKey` 分层 + `staleTime` 30s，登出/401 统一 `queryClient.clear()` 并通知 `AuthProvider` 跳 `/login`，删掉 4 个页面手写的 `load()` 样板。代价：+1 依赖（约 15KB gzip）。收益：徽标与看板共用缓存（消掉 §2-13）、消灭卸载竞态、401 有统一出口。

2. **Zod 作为契约单一来源**
现状 `client.ts:113-214` 手写类型；服务端 `contract.ts` 已有 zod + `z.infer`；`pnpm-workspace.yaml:4` 声明了不存在的 `packages/*`。改法：新建 `packages/contract` 导出 schema，服务端 `import`，前端取 `z.infer` + 在 `client.ts:93` 处 `parse`。代价：一次跨包重构。收益：类型漂移从「人眼对齐」变编译期错误，`client.ts` 里 100 行手写类型归零。

3. **路由级懒加载（保持 react-router 6）**
现状 `App.tsx:7-15` 静态导入 9 页。改法：`React.lazy` + `Suspense` + `manualChunks`（`react/react-dom/react-router`、`antd`、`icons` 三块），加载态复用 `ui.tsx` 的 `AsyncBlock`。代价：需补 Suspense 边界。收益：首屏只含登录/看板路径，回站命中 30d 强缓存。【建议】`@tanstack/react-router` 收益不足（仅 9 条路由、无嵌套 data API 需求），保持 RR6 更省。

4. **鉴权：短期保持 Bearer，中期评估 httpOnly cookie + BFF**
现状 localStorage JWT、无刷新、无过期。改法：短期服务端补 `expiresIn`（1h）+ 前端 401 联动；中期刷新令牌不放 localStorage，改 nginx 同源 BFF（`/api` 反代已存在）下发 `Set-Cookie: httpOnly; Secure; SameSite=Lax`。代价：BFF 需 cookie 插件 + CSRF 策略。收益：XSS 面收敛、可主动吊销、CSRF 一并解决。【建议】内测期先做短期两项。

5. **antd 主题 token 归一 + 暗色**
现状 `App.tsx:18-43` 主题是静态字面量，`theme.ts` 与 `styles.css:5-31` 有两份重复 token。改法：`tokens.ts` 转成 ConfigProvider `theme.token` 唯一来源，`styles.css` 只留骨架；暗色用 `darkAlgorithm`；加 visualizer 做体积预算。代价：一次性 token 归一 + 暗色色板设计。收益：单一 token 源、暗色零成本、补齐 §3 的【暂缺】数据。

6. **Vite 5 → 7 / Rolldown 收益评估**
现状 `vite.config.ts` 无 build 调优，`package.json:33` `vite ^5.4.11`。改法：先出 visualizer 基线，再评估 Rolldown 构建耗时与产物差异。代价：Rolldown 与 vitest 2 插件兼容需验证。收益：主要是构建速度。【建议】优先级低于 1/2/3/9。

7. **错误边界 + 统一降级**
现状无任何 ErrorBoundary。改法：`react-error-boundary` 包 `AppLayout` 与各路由，fallback 用纸卡样式 + 重试；`client.ts:103-105` 的非 JSON 响应与 fetch 抛 `TypeError` 统一成 `ApiError`，前端不再显示「Failed to fetch」。代价：+1 依赖 + 定义边界层级。收益：兑现「失败不能白屏」承诺（`ui.tsx:50-52`）。

8. **StoryEdit 校验统一 + 未保存守卫 + 并发保护**
现状仅标题与正文非空。改法：规则与服务端 `admin-routes.ts:14-48,79-93` 对齐（长度/枚举/URL），标签 `Select mode="tags"` 加 max；保存前 `form.isFieldsTouched()` 判定脏值，脏则弹确认；正文保存带 `If-Match: <updatedAt>`，冲突返回 409。代价：服务端加前置条件校验。收益：错误提前到输入期，正文误覆盖可回滚。

9. **安全响应头与缓存修正**
现状 `nginx.conf:62-64` 未覆盖 `/`，无任何安全头。改法：`location = /` 与 `= /index.html` 统一 no-cache；`/assets/` 保留 immutable；补 HSTS、`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: no-referrer`、`Content-Security-Policy`（`script-src 'self'`；antd cssinjs 运行时插 style，需 `style-src 'unsafe-inline'`，否则样式全没）、`server_tokens off`、`gzip_vary on`。代价：CSP 需实测调试（cssinjs 与图标 data-URI）。收益：XSS 后果从「token 直接可偷」降到「执行受限」，发版立即生效。

```nginx
# nginx.conf 建议片段
location = / {
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    try_files /index.html =404;
}
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy no-referrer always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'" always;
```

10. **可访问性**
现状无 `aria-label`、无 skip link、无路由焦点复位。改法：`<nav>`/表格/图标按钮加 `aria-label`，路由切换时 `window.scrollTo(0,0)` + 焦点移入主区；`SystemPage.tsx:231` 的 `JSON.stringify` 改为结构化渲染。代价：一轮 a11y 走查。收益：键盘/读屏可用，审计「详情」列可读。

11. **构建与测试补强**
现状 CI 只有 typecheck + test（`ci.yml:46-53`），Dockerfile 引用不存在的 `apps/admin/public` 因而从未被构建验证。改法：CI 加 build 与一次镜像构建；加 `@vitest/coverage-v8` + 阈值；补 `App.tsx`/`client.ts`/`useAsync` 单测。代价：CI 时长上升。收益：Dockerfile 类缺陷在 PR 即暴露，401 联动有回归网。

12. **审计体验补齐（前端可先行）**
现状 `SystemPage.tsx:202-233` 只有分页、无筛选，操作人显示原始 `actorId`，`detail` 用 `JSON.stringify` 平铺。改法：加「动作/对象/时间区间」筛选，`actorId` 映射昵称，`detail` 结构化渲染。代价：依赖服务端先补 `audit_log`（§2-4）。收益：审计从「不可用」变「可追责」。

## 6. 运营后台产品体验痛点

1. **审核队列没有「看一眼再上」的路径**：`ReviewPage.tsx:103-110` 只有通过/驳回两个按钮，正文数万字的故事只显示一行 excerpt（`:92-96`），通过即上架并写 `publishedAt`（`admin-routes.ts:219`）。编辑要点标题跳编辑页读完再回来，**回来队列已翻页/顺序变化**，等于在两页之间手工对齐。这是审核流最大摩擦。【建议】审核页内嵌正文预览，9+ 内容加二次确认。
2. **危险操作没有二次确认**：删除推荐位（`OpsPage.tsx:254`）与停用账号（`SystemPage.tsx:187-197`）有 Popconfirm，但「批量上架/批量归档」（`StoriesPage.tsx:257-262`）没有，归档还**不统计失败数**（`:102-117` 只报「已更新 N 篇」，`:109-111` 吞掉错误）；「改角色」一行 Select 直接生效（`SystemPage.tsx:148-164`），把人提成超级管理员毫无摩擦。【建议】批量操作与角色变更统一 Modal 确认 + 明细。
3. **审计日志不可用**：只有分页 20 条、无筛选、操作人是裸 `actorId`（`SystemPage.tsx:222-226`）、`detail` 是 JSON 字符串（`:231`），且故事编辑/分类改名根本没有记录（§2-4）。运营出问题时「查是谁干的」这一步直接失败。
4. **信息架构与数据口径不一致**：「家庭与儿童档案」页（`FamiliesPage.tsx:27`）调 `api.accounts({page,pageSize})` **不过滤 role**，管理员和家长混在一张表里，标题却写「儿童个人信息只读」；而「管理员与日志」页又用两次 `role=admin`/`role=editor` 拼表（`SystemPage.tsx:72-76`），两页口径互相打架。【建议】Families 页加 `role=parent`。
5. **假数据与真接口并存 + 批量能力不完整**：登录页与侧栏的 2,197/15/0 是写死的（`LoginPage.tsx:56-68`、`AppLayout.tsx:105`），看板同一批数字来自真实接口（`DashboardPage.tsx:33-63`），运营会怀疑「到底哪个数对」；生产登录页还写着 dev 账号与固定验证码提示（`LoginPage.tsx:99-102`），易诱发误操作。另外 `rowSelection` 未设 `preserveSelectedRowKeys`（`StoriesPage.tsx:274-277`），翻页即丢选择，批量只有提审/上架/归档，缺改年龄档/分类/标签——恰是最高频动作。

## 附：本次未能覆盖（【暂缺】）

- 构建产物体积与 gzip/brotli 收益（未 install/build，dist 不入库）。
- `docker build` 对缺失 `apps/admin/public` 的实际失败行为（未跑 docker）。
- JWT 是否带 `exp` 的运行时验证（本机无服务端运行态，仅据代码推断；锁内 `@fastify/jwt@9.1.0` 有时效性通告，建议升级并显式设 `expiresIn`）。
