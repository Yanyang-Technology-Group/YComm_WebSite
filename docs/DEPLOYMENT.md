# 部署与运维

> 本文面向部署与维护 YComm 的人，包含 CI/CD 流水线、服务器部署、备份与隧道注意事项。

## 自动化流水线（GitHub Actions）

push 到 `master` 后自动执行：

1. **Verify**：lint → typecheck → 单元/集成测试 → AGPL 许可门禁 → DCO 签名检查。
2. **Release**：构建 GHCR 镜像 → 打 `vYYYY.MM.DD.<提交数>` 标签 → 发布 GitHub Release。
3. **Deploy**：发布成功后 SSH 到服务器，从国内镜像源拉取 GHCR 镜像，`docker run` 加入
   `coolify` 网络（Postgres 由 Coolify 托管）。

镜像：`ghcr.io/<org>/ycomm-web`。服务器从国内镜像源拉取（默认 `ghcr.nju.edu.cn`，可用仓库
变量 `GHCR_MIRROR` 覆盖，填**裸主机名**，不要带 `https://` 或路径）。

## 部署所需 Secrets

在仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
|---|---|
| `SERVER_HOST` | 服务器 SSH 地址（IP 或域名） |
| `SERVER_SSH_USER` | SSH 用户名 |
| `SERVER_SSH_KEY` | SSH 私钥（`BEGIN OPENSSH PRIVATE KEY` 格式；公钥加入服务器 `authorized_keys`） |
| `SERVER_PORT` | SSH 端口（默认 22，可省略） |
| `DB_HOST` | Coolify 中 Postgres 的内部地址（容器名/内网主机名） |
| `DB_PASSWORD` | Postgres 密码 |
| `SESSION_SECRET` | 会话密钥，≥32 字符（`openssl rand -base64 48`） |
| `SITE_URL` | 站点对外地址，如 `https://community.yanyn.cn` |
| `SITE_NAME` | 站点名（可选） |
| `YCOMM_OWNER_USERNAME` / `YCOMM_OWNER_EMAIL` / `YCOMM_OWNER_PASSWORD` | 可选；首次启动自动创建站长 |

仓库变量（非机密）：`GHCR_MIRROR`（镜像源主机名，可选）。

## 部署前置条件（一次性）

1. **GHCR 包设为 Public**：镜像源只能拉公共镜像。GitHub 仓库 → Packages → `ycomm-web` →
   Package settings → Change visibility → **Public**。
2. **服务器能访问镜像源**：先手动验证：

   ```bash
   docker pull ghcr.nju.edu.cn/<org>/ycomm-web:latest
   ```

   不通就换源，并设置仓库变量 `GHCR_MIRROR`。
3. **服务器环境**：安装好 Docker；把部署公钥加入部署用户的 `~/.ssh/authorized_keys`。

## 手动部署 / 回滚

```bash
# 拉取（走镜像源）
docker pull ghcr.nju.edu.cn/<org>/ycomm-web:<tag>

# 停旧起新（加入 coolify 网络，Postgres 由 Coolify 托管）
docker rm -f ycomm || true
docker run -d --name ycomm --restart unless-stopped --network coolify -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='postgres://ycomm:<DB_PASSWORD>@<DB_HOST>:5432/ycomm' \
  -e SESSION_SECRET='<SESSION_SECRET>' \
  -e SITE_URL='https://community.yanyn.cn' \
  -e TRUST_PROXY_HEADERS=true \
  ghcr.nju.edu.cn/<org>/ycomm-web:<tag>
```

回滚：用上一个版本的 tag 重跑一遍即可；`docker pull` 失败时旧容器不会被替换。

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