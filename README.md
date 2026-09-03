# 小故事铺

“小故事铺”是面向儿童与家庭的在线故事阅读平台，提供分类浏览、搜索、分页与正文阅读。

## 架构

- 前端：Nginx 托管的静态 HTML/CSS/JavaScript。
- 数据 API：独立、无鉴权的 pREST 服务；当前网页客户端仅执行 Story PostgreSQL 查询。
- API 基址：`https://story-api.xirizhi.cn/story/public`。
- 前端适配器：`js/prest-client.js`，将页面查询转换为 pREST 的筛选、模糊搜索、排序与分页参数。
- 不再依赖 Supabase SDK、PostgREST、JWT 或匿名密钥。

## 测试

```bash
node test-prest-client.js
docker compose config -q
docker build -t story:local .
```

`test-prest-client.js` 校验前端到 pREST 的参数映射。部署前还应对真实 pREST 服务验证分类、列表、正文、筛选、模糊查询与分页。

## 本地构建

```bash
docker build -t story:local .
docker run --rm -p 18080:80 story:local
```

访问 `http://127.0.0.1:18080`。默认 API 指向生产 pREST；测试其他端点时，在加载 `prest-client.js` 前设置 `window.STORY_API_URL`。

## Compose 部署

仓库内 `docker-compose.yaml` 同时声明静态前端与 pREST。pREST 通过 `POSTGRES_PASSWORD` 拼接数据库连接，配置文件为 `docker/prest.toml`；服务本身不启用鉴权。

```bash
POSTGRES_PASSWORD='<password>' docker compose up -d --build
```

生产环境由 Traefik 路由：

- `story.xirizhi.cn` → 静态前端
- `story-api.xirizhi.cn` → pREST

## CI 自动发布

推送到 `main` 后，GitHub Actions 构建并推送：

- `xirizhi/story:latest`
- `xirizhi/story:<github.sha>`

仓库 Secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。
