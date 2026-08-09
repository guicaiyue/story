简介：<br>
“小故事铺”是一个专为儿童及家庭设计的故事平台，致力于为孩子们提供多样化、富有教育意义的睡前故事，帮助他们在轻松愉快的环境中提升阅读能力，激发想象力，并且培养良好的品德<br>

📖 多种故事类型<br>
动物故事：通过拟人化的动物角色，讲述智慧与勇气的故事，帮助孩子们了解自然界的奥秘。<br>
童话故事：经典童话重新演绎，带领孩子们进入充满魔法与奇幻的世界，培养他们的创造力与梦想。<br>
历史故事：生动有趣的历史人物与事件介绍，让孩子们在故事中感受历史的魅力，增加知识储备。<br>
益智故事：通过富有趣味性的谜题与故事情节，激发孩子的思维能力和解决问题的能力。<br>

🧸 个性化推荐<br>
根据孩子的年龄与兴趣，平台为家长提供个性化的故事推荐，确保每个孩子都能在适合自己的故事中收获知识与乐趣。<br>

💬 易用界面<br>
“小故事铺”拥有简洁直观的用户界面，家长可以快速浏览、选择和阅读故事。每个故事都附有字数标注，便于家长挑选适合孩子的长度。<br>
🎉 家庭共享
“小故事铺”不仅是孩子们的故事乐园，也为家长提供了与孩子一同成长的机会，享受温馨、愉快的亲子时光。
<img width="1910" height="925" alt="eea8bca58d89e488f9d161dcb84ea900" src="https://github.com/user-attachments/assets/bbb473bc-d8a0-4507-8e7d-0eed2877025f" />
<img width="1910" height="925" alt="99f460b294447ddc46c6007544aac085" src="https://github.com/user-attachments/assets/3f048619-c0b7-4230-b10c-14375365a6f5" />
<img width="1910" height="925" alt="0a4de6175a2d8ba9977b25a87ed821ca" src="https://github.com/user-attachments/assets/bbca5961-b580-4e9c-b22e-b300ee27b176" />
<img width="1910" height="925" alt="f6c8d2fa1de24b389dd877513e2b740e" src="https://github.com/user-attachments/assets/76911536-a632-4503-80e1-9bdb27c04bca" />

---

## Docker 部署

本项目为纯静态站点（Nginx 托管），已内置 Docker 化与 CI 自动构建。

### 构建镜像

```bash
docker build -t xirizhi/story:latest .
# 或使用仓库内 compose
docker compose up -d --build
# 本地访问 http://127.0.0.1:18080
```

### 环境变量（可选）

| 变量 | 说明 |
|------|------|
| `SUPABASE_URL` | Supabase 项目地址，如 `https://<project-ref>.supabase.co` |
| `SUPABASE_KEY` | Supabase 匿名公钥 |

仓库内 `js/supabase-client.js` 默认 `supabaseUrl/supabaseKey` 为空；容器启动时若设置了以上两个变量，会自动注入。

### CI 自动发布

推送到 `main` 分支后，GitHub Actions 自动构建镜像并推送 Docker Hub：
- 镜像：`xirizhi/story:latest`（同时打 `github.sha` 标签）
- 仓库 Secrets 需配置：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`

### 生产部署（Traefik + Watchtower + Homepage）

在宿主机 docker 目录创建 compose（示例）：`/vol1/1000/docker/story/docker-compose.yaml`，拉取镜像并配置 Traefik 域名、Watchtower 自动更新与 Homepage 入口标签（详见部署机 SOP）。
