#!/bin/bash
# YComm 服务器侧自动部署（拉取式）
#
# 背景：北京服务器屏蔽外网入站，无法被 GitHub Actions SSH 推送镜像，
# 只能由服务器自己「出站」从国内镜像源拉取镜像后本地部署。
#
# 用法：在服务器上周期性运行本脚本（cron / systemd timer）：
#   1) docker pull <镜像源>/<org>/ycomm-web:latest
#   2) 与当前运行容器对比，镜像没变就跳过（避免每轮都重启）
#   3) 变了才 docker run 重启，并做健康检查
#
# 安装（一次性）：
#   1. mkdir -p /opt/ycomm && cp scripts/deploy-server.sh /opt/ycomm/deploy.sh
#      chmod +x /opt/ycomm/deploy.sh
#   2. 填写 /opt/ycomm/ycomm.env（模板见下方注释）
#   3. 加定时任务（每 5 分钟）：
#      crontab -e 里加一行：
#      */5 * * * * /opt/ycomm/deploy.sh >> /var/log/ycomm-deploy.log 2>&1
#   4. 手动跑一次确认：/opt/ycomm/deploy.sh
#
# 环境变量模板（写入 /opt/ycomm/ycomm.env）：
#   IMAGE=ghcr.io/yanyang-technology-group/ycomm-web
#   MIRROR=ghcr.nju.edu.cn
#   DB_HOST=<Coolify 中 Postgres 的内部地址>
#   DB_USER=ycomm
#   DB_PASSWORD=********
#   DB_NAME=ycomm
#   SESSION_SECRET=********            # >=32 字符，openssl rand -base64 48
#   SITE_URL=https://community.yanyn.cn
#   SITE_NAME=YComm
#   YCOMM_OWNER_USERNAME=              # 可选，首次启动自动创建站长
#   YCOMM_OWNER_EMAIL=
#   YCOMM_OWNER_PASSWORD=
#
# 说明：本脚本不含任何机密，机密都在 /opt/ycomm/ycomm.env 里（勿提交、勿外传）。

set -euo pipefail

ENV_FILE="${YCOMM_ENV_FILE:-/opt/ycomm/ycomm.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "缺少配置文件 $ENV_FILE（请按脚本头注释先填写）" >&2
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

: "${IMAGE:?IMAGE 未设置在 $ENV_FILE}"
MIRROR="${MIRROR:-ghcr.nju.edu.cn}"
CONTAINER="${CONTAINER:-ycomm}"
NETWORK="${NETWORK:-coolify}"
TAG="${TAG:-latest}"

MIRROR_IMAGE=$(printf '%s' "$IMAGE" | sed "s|^ghcr.io/|${MIRROR}/|")
FULL_IMAGE="$MIRROR_IMAGE:$TAG"

echo "==> [$(date '+%F %T')] docker pull $FULL_IMAGE"
docker pull "$FULL_IMAGE"

# 与当前运行容器比对镜像 ID，没变化就跳过，避免无故重启
NEW_ID=$(docker image inspect --format '{{.Id}}' "$FULL_IMAGE")
CUR_ID=$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || echo none)

if [ "$CUR_ID" = "$NEW_ID" ]; then
  echo "==> 已是最新（$(printf '%s' "$NEW_ID" | cut -c1-12)），跳过"
  exit 0
fi

echo "==> 更新 $CONTAINER：$(printf '%s' "$CUR_ID" | cut -c1-12) -> $(printf '%s' "$NEW_ID" | cut -c1-12)"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

if [ -n "${DB_PASSWORD:-}" ] && [ -n "${DB_HOST:-}" ]; then
  DATABASE_URL="postgres://${DB_USER:-ycomm}:${DB_PASSWORD}@${DB_HOST}:5432/${DB_NAME:-ycomm}"
else
  echo "DB_HOST / DB_PASSWORD 未配置，无法生成 DATABASE_URL" >&2
  exit 1
fi

docker run -d --name "$CONTAINER" --restart unless-stopped --network "$NETWORK" -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL="$DATABASE_URL" \
  -e SESSION_SECRET="${SESSION_SECRET:-}" \
  -e SITE_URL="${SITE_URL:-}" \
  -e SITE_NAME="${SITE_NAME:-}" \
  -e TRUST_PROXY_HEADERS=true \
  -e YCOMM_OWNER_USERNAME="${YCOMM_OWNER_USERNAME:-}" \
  -e YCOMM_OWNER_EMAIL="${YCOMM_OWNER_EMAIL:-}" \
  -e YCOMM_OWNER_PASSWORD="${YCOMM_OWNER_PASSWORD:-}" \
  "$FULL_IMAGE"

# 健康检查：最多等 3 分钟
for i in $(seq 1 36); do
  state=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo starting)
  echo "[$i] health=$state"
  if [ "$state" = "healthy" ]; then
    echo "==> DEPLOY OK：http://127.0.0.1:3000"
    exit 0
  fi
  sleep 5
done

echo "部署后未在 180 秒内 healthy，最近的容器日志：" >&2
docker logs --tail 50 "$CONTAINER" 2>&1 || true
exit 1