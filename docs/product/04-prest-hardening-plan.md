# 公网 story-api 超级用户连库 — 整改方案

> 状态：**方案待批，未改任何生产配置、未改生产库。**
> 依据：03-decisions §7（只读探测结论）、本轮 dev 环境实测。
> 目标：从**根因**堵住公网写方法 —— 不再依赖可被伪造的 UA 检查。

## 1. 根因（已定位到文件行）

`story-prest` 的连库账号由 compose 环境变量写死为超级用户：

**文件**：`/vol1/1000/docker/story/docker-compose.yaml`（宿主机）

```yaml
  prest:
    image: local/prest-multidb:9070bda
    container_name: story-prest
    environment:
      DATABASE_ALIAS_1: story
      DATABASE_URL_1: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/story?sslmode=disable
      #               ^^^^^^^^^^^^^^^^^^^^^^^^^^^ 根因：postgres 是超级用户
```

**配置**：`/vol1/1000/docker/story/prest.toml`（只读挂载进容器）

```toml
[auth]
enabled = false        # 完全不鉴权
[access]
restrict = false       # 不限制表/方法 → 任意表、任意方法都放行
```

两者叠加 = 公网可对**任意表执行任意写方法**，且因超级用户**绕过所有 GRANT**。
`.env` 中 `POSTGRES_PASSWORD` 即超级用户口令。

## 2. 为什么单独换账号还不够

只把账号换成受限角色、但 `restrict=false`，攻击面缩小到该角色的 GRANT 范围；
而按 03-decisions §8，`prest_story` 目前在**方案 C 恢复后仍是读写**。
因此**换账号必须与收权、`restrict` 三者同批**，否则只是换个可写身份。

## 3. 已实测的整改方案（全部在 dev 验证，未碰生产）

在 dev 容器内用同一镜像 `local/prest-multidb:9070bda` + dev 库做了 A/B 对照。

### 3.1 dev 实测结论

| 配置 | 读 | POST/PUT/PATCH/DELETE | 未列出的表 | `app` schema |
| --- | --- | --- | --- | --- |
| `restrict = false`（= 现状） | ✅ | ❌ **成功执行**（实测插入成功，返回 id 2200） | ✅ 可读 | ✅ 可读 |
| `restrict = true` + `permissions` + `fields` | ✅ | ✅ **401 authorization required** | ✅ **401** | ✅ **401** |

**关键发现（踩坑记录）**：`restrict = true` 时**只写 `permissions = ["read"]` 会连读一起失败**，
报 `you don't have permission for this action, please check the permitted fields for this table`。
**必须同时给出 `fields` 白名单**，读取才正常。这条是我在 dev 上试出来的，
若不先在 dev 验证，直接上生产会导致**公网读接口整体 400**（老站白屏）。

### 3.2 验证用的 `prest.toml`（dev 实测通过）

```toml
[access]
restrict = true

[[access.tables]]
name = "story_main"
permissions = ["read"]
fields = ["id", "title", "excerpt", "category_id", "category_name", "age_band",
          "tags", "duration_sec", "cover_url", "audio_url", "featured",
          "length", "created_at", "status", "published_at", "updated_at"]

[[access.tables]]
name = "story_content"
permissions = ["read"]
fields = ["id", "story_id", "content"]

[[access.tables]]
name = "story_category"
permissions = ["read"]
fields = ["id", "name", "sort_id"]
```

未列出的表 / schema **一律 401**，因此 `_m1_migrations` 与 `app.*` 自动被挡在门外
—— `app` schema 的儿童个人信息不依赖 GRANT 即被隔离。

## 4. 建议的整改步骤（分批，每步可回滚）

**改动 1 · 数据库侧（先做，可独立回滚）**
在**生产库**执行 `production-grant-tightening.sql`（已含 `_m1_migrations`），
把 `prest_story` 收为 SELECT-only，并封闭 `app` schema。
→ 对老站无影响（读路径权限保留）。

**改动 2 · 账号替换（核心）**
改 `/vol1/1000/docker/story/docker-compose.yaml`：

```yaml
DATABASE_URL_1: postgres://prest_story:${PREST_STORY_DB_PASSWORD}@postgres:5432/story?sslmode=disable
```

⚠️ **口令陷阱（实测）**：`prest-multidb` 的 deploy `.env` 里有**两个相似变量**：

| 变量 | 实测结果 |
| --- | --- |
| `PREST_STORY_DB_PASSWORD` | ✅ 可用（成功连库，super=false） |
| `PREST_STORY_PASSWORD` | ❌ 认证失败 |

复用时**必须用 `PREST_STORY_DB_PASSWORD`**，并用 `chmod 600` 保护 `.env`。

**改动 3 · pREST 应用层收口（按 §3.2 配置）**
把 `restrict = false` 改为 `true` 并加表/字段白名单。
→ 这是**唯一对公网直接生效**的一层：即使账号仍是超级用户，写方法也会被 401 挡掉。

**改动 4 · WAF 方法白名单（纵深，可选）**
雷池对 `story-api` 仅放行 GET/OPTIONS。**可被绕过，不能替代 2、3。**

## 5. 生效与回滚

- **生效**：`docker compose up -d prest`（在 `/vol1/1000/docker/story/`）。
  该容器**无 watchtower 标签**（已核对），不会自动回滚配置。
- **回滚**：
  - 改动 2：还原 compose 的 `DATABASE_URL_1` 并 `up -d`。
  - 改动 3：还原 `prest.toml` 并 `up -d`（该文件只读挂载，改后需重启容器）。
  - 改动 1：执行 `production-grant-tightening.sql` 文件末尾的 Rollback 段。

## 6. 上线顺序与风险

1. **先改动 1**（纯数据库、老站无感）→ 2. **再改动 3**（应用层，风险最高）→ 3. **最后改动 2**。

**改动 3 是唯一会改变公网读行为的变更**，必须在窗口期做并**当场验证**：

```bash
# 期望 200 + 正常数据
curl -sS -o /dev/null -w '%{http_code}\n' \
  -A "Mozilla/5.0" "https://story-api.xirizhi.cn/story/public/story_main?_page_size=1"
# 期望 401
curl -sS -X DELETE -A "Mozilla/5.0" \
  "https://story-api.xirizhi.cn/story/public/story_main?id=eq.1"
```

**兜底**：若读接口异常，立即还原 `prest.toml` 并 `up -d`（分钟级恢复）。

## 7. 仍需你确认

1. 是否按「改动 1 → 3 → 2」的顺序执行；
2. `fields` 白名单是否要剔除老站不用的列（如 `status`/`published_at`）以进一步最小化；
3. 改动 3 的窗口期由谁在旁验证（我可提供命令与预期输出，但不擅自改生产配置）。
