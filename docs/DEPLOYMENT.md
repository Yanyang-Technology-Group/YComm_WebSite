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