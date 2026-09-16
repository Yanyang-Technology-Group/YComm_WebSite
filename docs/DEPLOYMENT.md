# 部署与运维

> 本文面向部署与维护 YComm 的人。**不做自动部署**，部署由本地一个私有脚本手动触发。

## 部署模型

- **GitHub 只负责构建 + 发布镜像**：push 到 `master` 后，GitHub Actions 自动构建镜像并推送到
  GHCR（`ghcr.io/<org>/ycomm-web`），打 tag、发 Release。**不会碰服务器。**
- **部署靠本地脚本**：在你本机跑一个私有脚本 `deploy.sh`（已 `.gitignore`，含服务器/数据库
  机密，不进仓库），脚本 SSH 到服务器，让服务器从国内镜像源 `docker pull` 后本地 `docker run`
  （出站下载，无需入站）。

## GitHub 上要做的事

1. **推送代码**：`git push origin master`。
2. **GHCR 包设为 Public**（一次性）：镜像源只能拉公共镜像。GitHub 仓库 → Packages →
   `ycomm-web` → Package settings → Change visibility → **Public**。

## 本地部署脚本

在仓库根目录创建 `deploy.sh`（已 gitignore，不会提交），模板：

```bash
#!/bin/bash
set -euo pipefail

SERVER_HOST="<服务器 SSH 地址>"
SERVER_USER="root"
SERVER_PORT="22"
SSH_KEY="$HOME/.ssh/id_ed25519"

IMAGE="ghcr.io/<org>/ycomm-web"
MIRROR="ghcr.nju.edu.cn"            # 镜像源，不通就换
TAG="${1:-latest}"                  # 不传用 latest；回滚传旧 tag

DB_HOST="<Coolify 中 Postgres 内部地址>"
DB_USER="ycomm"
DB_PASSWORD="<密码>"
DB_NAME="ycomm"
SESSION_SECRET="<openssl rand -base64 48>"
SITE_URL="https://<你的域名>"
SITE_NAME="YComm"

MIRROR_IMAGE=$(printf '%s' "$IMAGE" | sed "s|^ghcr.io/|${MIRROR}/|")
FULL_IMAGE="$MIRROR_IMAGE:$TAG"
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/${DB_NAME}"
SSH="ssh -i $SSH_KEY -p $SERVER_PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30"
REMOTE="$SERVER_USER@$SERVER_HOST"

$SSH "$REMOTE" "docker pull '$FULL_IMAGE'"
$SSH "$REMOTE" "docker rm -f ycomm >/dev/null 2>&1 || true; docker run -d --name ycomm --restart unless-stopped --network coolify -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production -e DATABASE_DRIVER=postgres -e DATABASE_URL='$DATABASE_URL' \
  -e SESSION_SECRET='$SESSION_SECRET' -e SITE_URL='$SITE_URL' -e SITE_NAME='$SITE_NAME' \
  -e TRUST_PROXY_HEADERS=true '$FULL_IMAGE'"
```

运行（Git Bash / WSL / Linux）：

```bash
bash deploy.sh              # 部署最新
bash deploy.sh v2026.xx.xx  # 部署指定版本 / 回滚
```

## 前置条件（一次性）

1. 服务器能访问镜像源：`docker pull ghcr.nju.edu.cn/<org>/ycomm-web:latest` 能通；不通就换
   `MIRROR`（填裸主机名，不带 `https://` 或路径）。
2. 服务器装好 Docker，且能访问 `coolify` 网络（Coolify 托管的 Postgres）。
3. 本地能 SSH 到服务器（私钥放好、公钥在服务器 `authorized_keys`）。

## 手动部署 / 回滚（服务器上直接跑）

```bash
docker pull ghcr.nju.edu.cn/<org>/ycomm-web:<tag>
docker rm -f ycomm || true
docker run -d --name ycomm --restart unless-stopped --network coolify -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='postgres://ycomm:<DB_PASSWORD>@<DB_HOST>:5432/ycomm' \
  -e SESSION_SECRET='<SESSION_SECRET>' \
  -e SITE_URL='https://<你的域名>' \
  -e TRUST_PROXY_HEADERS=true \
  ghcr.nju.edu.cn/<org>/ycomm-web:<tag>
```

## 备份

```bash
DATABASE_URL=postgres://... BACKUP_TARGET=/mnt/backups/ycomm ./scripts/backup.sh
```

脚本通过 `pg_dump` 导出数据库，uploads 目录做硬链轮转并保留最近若干份。**请每月验证一次恢复路径。**

## Cloudflare Tunnel 注意事项

- 免费隧道限制单请求体 100MB —— 这是本地附件上限 50MB、大文件走外链的原因。
- 限流与封禁依赖 `CF-Connecting-IP`，请保持 `TRUST_PROXY_HEADERS=true`。
- App 只绑定 `127.0.0.1:3000`，对外通过隧道或反向代理暴露，不要直接开公网端口。

## 环境变量

完整变量清单见 [`.env.example`](../.env.example)，均有安全默认值；生产环境必须设置
`DB_PASSWORD` 与 `SESSION_SECRET`。
## WebSocket 实时通知

`npm run dev` / `npm run start` 现在启动 `apps/web/server.ts`：自定义 Node server 在同一 **3000** 端口处理 Next HTTP 请求和 `/api/ws` Upgrade。Next App Router → Hono 的 `/api/*` HTTP 转发保持不变，`/api/healthz` 仍是原有数据库健康探针。生产先 `npm run build`，再 `npm run start`；不要改用 `next start`、Next standalone server 或无长连接能力的 Serverless 平台。镜像保留 `tsx` 和工作区源文件作为运行依赖。

生产必须设置 `SITE_URL=https://你的域名`，否则启动时明确报错。外部地址为 `wss://你的域名/api/ws`。TLS 在可信代理/Tunnel 终止，后端端口只暴露给代理；代理必须传递 Cookie、Origin、Upgrade、Connection，并覆盖 `X-Forwarded-Proto: https`。只有 `TRUST_PROXY_HEADERS=true` 时才接受该转发头。**不能让公网客户端直接访问并伪造转发头**；Compose 保持宿主机 `127.0.0.1:3000` 绑定。容器内部监听 `0.0.0.0:3000`，不是公网发布。

Origin 必须等于 `SITE_URL` 的 origin（协议、主机和端口，不含路径），缺失也拒绝。Flutter 原生客户端需要显式发送该 Origin 及 CookieJar 中匹配站点 HTTPS URL 的会话 Cookie。本地未设置 SITE_URL 时仅接受 localhost、127.0.0.1 和 ::1 的 HTTP/HTTPS Origin；设置后严格匹配。已有 Cookie 始终 Secure + HttpOnly，未降低安全属性；原生设备本地联调建议用 HTTPS 开发代理，不能指望 Secure Cookie 自动发送到 ws/http。

Nginx TLS 虚拟主机中的示例（HTTP 和 WS 共用代理）：

```nginx
# http {} 内
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
# server {}（需已有 listen 443 ssl 和证书）内
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 90s;
}
```

Cloudflare Tunnel 的现有 HTTP 服务 `http://localhost:3000` 可以同时代理 WebSocket，无需新增 TCP 服务、路径或端口；站点的 WebSockets 开关应启用。Cloudflare 更新可能断开长连接，客户端必须重连并 REST 补拉。参见 [Tunnel WebSocket 支持](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/) 和 [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)。

服务端每 30 秒 ping，下一周期未 pong 则终止连接；定期及推送前复查会话。每用户最多 8 条连接，总计最多 1000 条，最多 100 个待鉴权握手；握手最长 5 秒。慢消费者受 64 KiB 发送缓冲和 64 个待验证事件限制。SIGTERM/SIGINT 关闭监听、订阅与连接，10 秒退出兜底。客户端事件协议、拒绝及关闭码见 [API 文档](API.md)。

### 单实例范围与验证

进程内通知总线通过进程共享存储跨 Next 服务端打包模块复用，不存储消息，不提供补发、顺序或恰好一次保证。部署期间/离线期间的实时提示会丢失；客户端在 ready、重连、前台恢复时从 REST 拉取通知。标记已读当前只通过 REST 返回权威未读数，不额外广播。

多实例或 PM2 cluster **不能**依赖该总线。需替换 `packages/notify/src/events.ts` 的 `NotificationEventBus.publish/subscribe` 实现，使用 Redis Pub/Sub 或 PostgreSQL LISTEN/NOTIFY，使每个实例收到提示再向自身连接投递；保持 `userId` 定向及轻量协议不变。若需要可靠投递，还需事务 outbox/持久化消费者。不要把通知创建放进未提交事务后就直接发送事件；当前调用点都在独立成功的写入之后发布。

验证命令：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:realtime:smoke
# 可选：同一端到端用例检查开发服务器
npm run test:realtime:smoke -- --dev
```

smoke 使用临时 PGlite 数据库与临时端口，验证登录的 Secure/HttpOnly Cookie、原样 healthz、ready、真实 REST 管理操作产生实时事件以及 REST 未读数，不访问部署数据库。该脚本模拟可信代理的 HTTPS 转发头，公网 TLS/Cloudflare 链路仍应在实际部署后做一次客户端验证。
