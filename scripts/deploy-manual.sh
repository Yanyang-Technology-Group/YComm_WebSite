#!/usr/bin/env bash
# 手动构建 + 部署 YComm 到服务器（不依赖 GitHub Actions）
#
# 用法（在你的开发机上，需 docker + ssh 可用；Windows 可用 git-bash/WSL 跑）：
#   YCOMM_SSH_KEY=~/.ssh/ycomm_deploy \
#   DB_PASSWORD='...' DB_HOST='...' SESSION_SECRET='...' \
#   SITE_URL=https://community.yanyn.cn SITE_NAME=YComm \
#   ./scripts/deploy-manual.sh
#
# 环境变量：
#   必填：DB_PASSWORD  DB_HOST  SESSION_SECRET  SITE_URL  SITE_NAME
#   可选（默认值如下）：YCOMM_SERVER_HOST=103.40.14.91  YCOMM_SSH_USER=root
#        YCOMM_SSH_PORT=31140  YCOMM_SSH_KEY=$HOME/.ssh/ycomm_deploy  YCOMM_TAG=v<今天日期>
#   可选（首次启动时在 entrypoint 自动创建站长，幂等）：YCOMM_OWNER_USERNAME/EMAIL/PASSWORD
#
# 前置：服务器的 authorized_keys 已包含本脚本所用私钥对应的公钥；
#   Dockerfile 基础镜像走 DaoCloud 镜像加速（docker.m.daocloud.io），国内构建不卡。

set -euo pipefail

: "${YCOMM_SERVER_HOST:=103.40.14.91}"
: "${YCOMM_SSH_USER:=root}"
: "${YCOMM_SSH_PORT:=31140}"
: "${YCOMM_SSH_KEY:=$HOME/.ssh/ycomm_deploy}"
: "${YCOMM_TAG:=v$(date +%Y.%m.%d)}"

for v in DB_PASSWORD DB_HOST SESSION_SECRET SITE_URL SITE_NAME; do
  if [ -z "${!v:-}" ]; then
    echo "缺少环境变量 $v —— 请按脚本头部说明设置后重试" >&2
    exit 1
  fi
done
if [ ! -f "$YCOMM_SSH_KEY" ]; then
  echo "找不到 SSH 私钥: $YCOMM_SSH_KEY（注意：OpenSSH 密钥文件须以换行结尾）" >&2
  exit 1
fi

SSH="ssh -i $YCOMM_SSH_KEY -p $YCOMM_SSH_PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

echo "==> 1/4 构建镜像 ycomm-web:$YCOMM_TAG"
docker build -t "ycomm-web:$YCOMM_TAG" .

echo "==> 2/4 传输镜像到 $YCOMM_SERVER_HOST (docker save | ssh | docker load)"
docker save "ycomm-web:$YCOMM_TAG" | gzip | $SSH "$YCOMM_SSH_USER@$YCOMM_SERVER_HOST" 'gunzip | docker load'

echo "==> 3/4 启动容器（--network coolify，绑定 127.0.0.1:3000）"
DATABASE_URL="postgres://ycomm:${DB_PASSWORD}@${DB_HOST}:5432/ycomm"
OWNER_ENV=()
[ -n "${YCOMM_OWNER_USERNAME:-}" ] && OWNER_ENV+=(-e "YCOMM_OWNER_USERNAME=$YCOMM_OWNER_USERNAME")
[ -n "${YCOMM_OWNER_EMAIL:-}" ] && OWNER_ENV+=(-e "YCOMM_OWNER_EMAIL=$YCOMM_OWNER_EMAIL")
[ -n "${YCOMM_OWNER_PASSWORD:-}" ] && OWNER_ENV+=(-e "YCOMM_OWNER_PASSWORD=$YCOMM_OWNER_PASSWORD")
$SSH "$YCOMM_SSH_USER@$YCOMM_SERVER_HOST" "docker rm -f ycomm >/dev/null 2>&1 || true; docker run -d --name ycomm --restart unless-stopped --network coolify -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='${DATABASE_URL}' \
  -e SESSION_SECRET='${SESSION_SECRET}' \
  -e SITE_URL='${SITE_URL}' \
  -e SITE_NAME='${SITE_NAME}' \
  -e TRUST_PROXY_HEADERS=true \
  ${OWNER_ENV[@]+"${OWNER_ENV[@]}"} \
  ycomm-web:${YCOMM_TAG}"

echo "==> 4/4 等待健康（最多 5 分钟）"
for i in $(seq 1 60); do
  state=$($SSH "$YCOMM_SSH_USER@$YCOMM_SERVER_HOST" "docker inspect --format '{{.State.Health.Status}}' ycomm 2>/dev/null || echo starting")
  echo "[$i] health=$state"
  if [ "$state" = "healthy" ]; then
    echo "DEPLOY OK: http://127.0.0.1:3000 on $YCOMM_SERVER_HOST（Cloudflare Tunnel 域名 = $SITE_URL）"
    exit 0
  fi
  sleep 5
done
echo "超时：容器未达到 healthy —— 登录服务器执行 docker logs ycomm 排查（常见：迁移失败 / DB 不可达 / SESSION_SECRET 缺失）" >&2
exit 1