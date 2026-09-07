# 小故事铺

“小故事铺”是面向儿童与家庭的在线故事阅读平台，提供分类浏览、搜索、分页与正文阅读。

## 架构

- 前端：Nginx 托管的静态 HTML/CSS/JavaScript。
- 数据 API：独立、无鉴权的 pREST 服务；当前网页客户端仅执行 Story PostgreSQL 查询。
- API 基址：`https://story-api.xirizhi.cn/story/public`。
- 前端适配器：`js/prest-client.js`，将页面查询转换为 pREST 的筛选、模糊搜索、排序与分页参数。

## 环境

| 环境 | Compose 文件 | 用途 |
| --- | --- | --- |
| 开发 | `compose.dev.yaml` | 本地构建当前源码，静态站点映射至 `http://127.0.0.1:18080`。默认仍调用生产 API。 |
| 生产 | `compose.prod.yaml` | 只使用已发布镜像；包含静态前端、pREST、Traefik 标签与外部网络。不会在生产主机从源码构建。 |

### 开发

```bash
docker compose -f compose.dev.yaml up --build
```

停止开发服务：

```bash
docker compose -f compose.dev.yaml down
```

### 生产

生产镜像由 GitHub Actions 生成。复制 `.env.example` 为生产环境的 `.env`，设置数据库密码，并将 `STORY_IMAGE` 固定为要部署的 SHA 标签，例如 `xirizhi/story:<commit-sha>`：

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

生产部署目录可独立于源码仓；本仓库不执行本地生产镜像升级。

## 测试

```bash
node test-prest-client.js
docker compose -f compose.dev.yaml config -q
docker compose -f compose.prod.yaml config -q
```

其余 `test-*.js` 为前端契约测试。生产发布前还应对真实 pREST 服务验证分类、列表、正文、筛选、模糊查询与分页。

## CI 镜像发布

推送到 `main` 后，GitHub Actions 工作流 [`.github/workflows/build-image.yml`](.github/workflows/build-image.yml) 会：

1. 运行前端契约测试；
2. 构建 Docker 镜像；
3. 推送到 Docker Hub：
   - `${DOCKERHUB_USERNAME}/story:<github.sha>`
   - `${DOCKERHUB_USERNAME}/story:latest`

仓库 Secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。CI 只发布镜像，不连接或升级任何本地生产容器。
