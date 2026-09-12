# 手动构建与部署（YComm）

> 服务器在北京、GitHub Actions 的海外 runner 直连服务器 SSH 不稳，因此**部署不走
> GitHub Actions**，改为在你自己的机器上构建好镜像再推到服务器。全程只需
> `docker` + `ssh`。

## 一、一键脚本（推荐）

在你本机（Windows 用 git-bash / WSL，Linux/macOS 直接跑）：

```bash
YCOMM_SSH_KEY=~/.ssh/ycomm_deploy \
DB_PASSWORD='你的数据库密码' \
DB_HOST='<coolify postgres 内部主机名>' \
SESSION_SECRET='$(openssl rand -base64 48)' \
SITE_URL=https://community.yanyn.cn \
SITE_NAME=YComm \
./scripts/deploy-manual.sh
```

脚本做 4 件事：

1. `docker build`（基础镜像走 DaoCloud 加速，国内秒拉）
2. `docker save | gzip | ssh 'gunzip | docker load'` 传镜像
3. `docker run`：`--network coolify -p 127.0.0.1:3000:3000`，环境变量全量传入
   （entrypoint 会自动 `db:migrate` → `db:seed` → 若给 `YCOMM_OWNER_*` 则建站长）
4. 轮询 `docker inspect` 健康状态，`healthy` 即成功

## 二、分步手动（想看清每一步时）

```bash
# 1. 构建（版本号自定，如 v2026.09.12）
docker build -t ycomm-web:v2026.09.12 .

# 2. 传镜像（等价于先 docker save | gzip 再 scp/ssh）
docker save ycomm-web:v2026.09.12 \
  | gzip \
  | ssh -i ~/.ssh/ycomm_deploy -p 31140 root@103.40.14.91 'gunzip | docker load'

# 3. 起容器（同名替换旧容器）
ssh -i ~/.ssh/ycomm_deploy -p 31140 root@103.40.14.91 \
  "docker rm -f ycomm >/dev/null 2>&1 || true; docker run -d --name ycomm --restart unless-stopped \
     --network coolify -p 127.0.0.1:3000:3000 \
     -e NODE_ENV=production \
     -e DATABASE_DRIVER=postgres \
     -e DATABASE_URL='postgres://ycomm:你的密码@<db主机>:5432/ycomm' \
     -e SESSION_SECRET='随机48字节base64' \
     -e SITE_URL='https://community.yanyn.cn' \
     -e SITE_NAME='YComm' \
     -e TRUST_PROXY_HEADERS=true \
     ycomm-web:v2026.09.12"

# 4. 等健康（entrypoint 先跑 migrate/seed/owner 再启动，通常 30–90 秒）
ssh -i ~/.ssh/ycomm_deploy -p 31140 root@103.40.14.91 \
  "docker logs -f ycomm"          # 看启动日志
```

## 三、配置取值（本部署）

| 变量 | 值 |
|---|---|
| 服务器 | `103.40.14.91` |
| SSH 端口 | `31140`（非 22；ssh_config 也可 `Host ycomm` + `Port 31140`） |
| SSH 用户 | `root` |
| 容器名 | `ycomm` |
| DB_HOST（Coolify Postgres 内部名） | `oltonymjthm89rxjwmah21u8` |
| DB 用户 / 库 | `ycomm` / `ycomm` |
| 站点地址 | `https://community.yanyn.cn` |
| 对外暴露 | 容器绑定 `127.0.0.1:3000`，由 cloudflared 隧道把 `community.yanyn.cn` 指到该端口；`c/comm.yanyn.cn` 301 由 Coolify 重定向应用或 Cloudflare 规则处理（见 [CLOUDFLARE.md](CLOUDFLARE.md)） |

## 四、SSH 密钥要求

- 服务器用 `~/.ssh/authorized_keys`（root）只认**公钥**；部署机持有**私钥**。
- 私钥必须是 OpenSSH 原生格式（`-----BEGIN OPENSSH PRIVATE KEY-----`），
  Node/openssl 产出的 PKCS#8（`BEGIN PRIVATE KEY`）OpenSSH 加载不了。
- **文件必须以换行结尾**，否则 OpenSSH 报 `invalid format`（粘贴/编辑时易丢）。
- 快速验证：`ssh -i 私钥 -p 31140 root@103.40.14.91 'echo ok'`

## 五、健康检查与验证

```bash
# 服务器本机（经 SSH）：
curl -s http://127.0.0.1:3000/api/healthz   # {"ok":true,...,"db":"up"}
docker inspect --format '{{.State.Health.Status}}' ycomm   # healthy

# 公网（cloudflared 配置好之后）：
curl -s https://community.yanyn.cn/api/healthz
```

## 六、收尾

- GitHub Actions 自动部署已移除（`deploy.yml` 删除）。原 12 个部署 Secrets
  （`SERVER_HOST` / `SERVER_SSH_KEY` / `DB_PASSWORD` 等）**现在都没有用途了**，
  可以在 GitHub 仓库 Settings → Secrets 里删除；`SITE_URL` 等改由上面部署命令传入。
- `release.yml` 保留：push 仍会自动构建 GHCR 镜像并打 `vYYYY.MM.DD.<提交数>` 标签
  发布 GitHub Release（与代码版本无关，不影响服务器）。