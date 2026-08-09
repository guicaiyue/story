FROM nginx:alpine

# 二开增强：容器启动时可通过环境变量注入 Supabase 配置（SUPABASE_URL / SUPABASE_KEY）
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 自定义 nginx 静态服务配置（gzip / 静态资源缓存）
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# 静态站点文件
COPY . /usr/share/nginx/html

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
