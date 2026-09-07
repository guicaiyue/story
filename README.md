# 小故事铺

面向儿童与家庭的在线故事阅读平台。前端为静态 HTML、CSS 与 JavaScript，数据 API 为 `https://story-api.xirizhi.cn/story/public`。

## 本地开发

开发不使用 Docker，也不会启动任何 Docker 服务。需要 Node.js 18+：

```bash
node scripts/dev-server.js
```

浏览器访问 <http://127.0.0.1:5173>。修改 HTML、CSS、JavaScript 或静态资源后，浏览器会自动刷新。

可用环境变量覆盖监听地址或端口：

```bash
HOST=0.0.0.0 PORT=5173 node scripts/dev-server.js
```

## 测试

```bash
node test-umami-tracker.js
node test-prest-client.js
node test-story-analytics.js
node test-edge-tts-analytics.js
```

## 发布

唯一发布入口是推送到 `main`。GitHub Actions [build-image.yml](.github/workflows/build-image.yml) 会运行全部契约测试，构建生产 Docker 镜像，并推送：

- `${DOCKERHUB_USERNAME}/story:<commit-sha>`
- `${DOCKERHUB_USERNAME}/story:latest`

所需 GitHub Secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。本机生产服务的镜像拉取与升级由既有运行机制负责，不在此源码仓执行。
