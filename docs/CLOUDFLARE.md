# Cloudflare 域名重定向指南：c.yanyn.cn / comm.yanyn.cn → community.yanyn.cn

真实（canonical）域名：`https://community.yanyn.cn`
旧别名子域：`c.yanyn.cn`、`comm.yanyn.cn`（全部 301 永久重定向过去）

> ⚠️ 尽快把 GitHub Secrets 里的 `SITE_URL` 设为 `https://community.yanyn.cn`，
> 否则邮件里的验证/找回链接会指向错误地址。

## 方案 A（推荐）：Cloudflare 规则引擎，零额外容器

两个子域**不需要**出现在 cloudflared ingress 里——规则引擎在边缘先于回源执行。

1. 云面板：`your domain: yanyn.cn → Rules → Redirect Rules → Create rule`
2. 规则名随意（如 `aliases-to-canonical`）
3. **When incoming requests match**（表达式）：
   ```
   (http.host eq "c.yanyn.cn") or (http.host eq "comm.yanyn.cn")
   ```
4. **Then**：
   - Type：`Dynamic`
   - Expression：`concat("https://community.yanyn.cn", http.request.uri.path)`
   - Status code：`301`（永久重定向）
5. Deploy。

> 想让重定向带上查询串，可用：
> `concat("https://community.yanyn.cn", http.request.uri.path, http.request.uri.query ne "" ? concat("?", http.request.uri.query) : "")`

DNS 侧：这两个子域只要在 Cloudflare 上保持**代理（橙色云）**即可，规则即生效；
若它们目前是隧道里的 public hostname，保留也不影响（请求在边缘就被转走了）。

## 方案 B：cloudflared 隧道内自给（自带重定向容器）

如果偏好隧道完全自洽（不依赖规则引擎）：

1. 在服务器上起一个只负责 301 的 nginx 容器（配置已入库）：

   ```bash
   mkdir -p /opt/ycomm/redirect
   cp docker/redirect/nginx.conf /opt/ycomm/redirect/
   docker run -d --name ycomm-redirect --restart unless-stopped \
     -p 127.0.0.1:8082:80 \
     -v /opt/ycomm/redirect/nginx.conf:/etc/nginx/conf.d/site.conf:ro \
     nginx:alpine
   ```

2. cloudflared 的 config.yml ingress 加两行并把 canonical 指到应用：

   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /etc/cloudflared/<tunnel-id>.json
   ingress:
     - hostname: c.yanyn.cn
       service: http://127.0.0.1:8082
     - hostname: comm.yanyn.cn
       service: http://127.0.0.1:8082
     - hostname: community.yanyn.cn
       service: http://127.0.0.1:3000
     - service: http_status:404
   ```

3. 重启隧道：

   ```bash
   # 用 token 方式（当前部署方式）
   docker restart cloudflared
   # 或用 config.yml 方式
   cloudflared tunnel --config /etc/cloudflared/config.yml run <tunnel-id>
   ```

> 403/连接无效时先看请求是否经过了 edge 规则/ingress 兜底；`TRUST_PROXY_HEADERS=true`
> 已保证限流与封禁取到真实 IP，不受重定向影响。

## 验证

```bash
curl -sI https://c.yanyn.cn/forum | head -1     # 期望 HTTP/2 301
curl -sI https://comm.yanyn.cn/api/healthz | head -1  # 期望 301（保留路径）
curl -s https://community.yanyn.cn/api/healthz  # 期望 {"ok":true,...,"db":"up"}
```