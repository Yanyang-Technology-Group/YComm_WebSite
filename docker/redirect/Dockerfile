# 供 Coolify「静态应用」使用的重定向镜像：
#   - Build Pack: Dockerfile
#   - Dockerfile location: /docker/redirect/Dockerfile
#   - Domains: c.yanyn.cn, comm.yanyn.cn
#   - Ports exposes: 80
# Traefik 将两个主机名路由到此容器，nginx 统一 301 到 community.yanyn.cn。

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1