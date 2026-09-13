# 部署与运维

> 本文面向部署与维护 YComm 的人，包含 CI/CD 流水线、服务器部署、备份与隧道注意事项。

## 部署模型

北京服务器**屏蔽外网入站**（SSH 进不去），因此不采用「GitHub Actions 推送镜像到服务器」的
方式，而是**服务器主动从国内镜像源拉取镜像、本地部署**（出站下载不受影响）：

```
GitHub Actions（构建+推送 GHCR 镜像）
        │
        ▼
ghcr.io ──(国内镜像源缓存)──▶ 北京服务器：docker pull 镜像源/<org>/ycomm-web:latest
                                      │ 镜像有更新才 docker run 重启
                                      ▼
                              coolify 网络（Postgres 由 Coolify 托管）
```

更新延迟取决于服务器的轮询周期（默认每 5 分钟一次）。

## 自动化流水线（GitHub Actions）

push 到 `master` 后自动执行：

1. **Verify**：lint → typecheck → 单元/集成测试 → AGPL 许可门禁 → DCO 签名检查。
2. **Release**：构建 GHCR 镜像（`ghcr.io/<org>/ycomm-web`）→ 打 `vYYYY.MM.DD.<提交数>`
   标签 → 发布 GitHub Release。

流水线**不直接部署**，部署由服务器侧脚本完成（见下）。

## 服务器侧安装（一次性）

在服务器上执行：

```bash
# 1. 目录与脚本
mkdir -p /opt/ycomm
cp scripts/deploy-server.sh /opt/ycomm/deploy.sh
chmod +x /opt/ycomm/deploy.sh

# 2. 填写配置（机密放这里，勿提交/勿外传）
vi /opt/ycomm/ycomm.env
```

`/opt/ycomm/ycomm.env` 模板：

```bash
IMAGE=ghcr.io/yanyang-technology-group/ycomm-web
MIRROR=ghcr.nju.edu.cn                 # 换源时改这里
DB_HOST=<Coolify 中 Postgres 的内部地址>
DB_USER=ycomm
DB_PASSWORD=********
DB_NAME=ycomm
SESSION_SECRET=********                # openssl rand -base64 48
SITE_URL=https://community.yanyn.cn
SITE_NAME=YComm
YCOMM_OWNER_USERNAME=                  # 可选，首次启动自动创建站长
YCOMM_OWNER_EMAIL=
YCOMM_OWNER_PASSWORD=
```

```bash
# 3. 先手动跑一次，确认能拉镜像、容器能起来
/opt/ycomm/deploy.sh

# 4. 再加定时任务，每 5 分钟检查一次更新
crontab -e   # 加一行：
*/5 * * * * /opt/ycomm/deploy.sh >> /var/log/ycomm-deploy.log 2>&1
```

脚本逻辑：`docker pull` → 与当前容器镜像比对，没变就跳过 → 变了才 `docker run`
（`--network coolify`，Postgres 由 Coolify 托管）→ 健康检查（最多等 3 分钟）。
拉取失败时旧容器不会被动。

## 部署前置条件（一次性）

1. **GHCR 包设为 Public**：镜像源只能拉公共镜像。GitHub 仓库 → Packages → `ycomm-web` →
   Package settings → Change visibility → **Public**。
2. **服务器能访问镜像源**：先手动验证：

   ```bash
   docker pull ghcr.nju.edu.cn/yanyang-technology-group/ycomm-web:latest
   ```

   不通就换源，把 `MIRROR` 改成可用的镜像源（填裸主机名，不带 `https://` 或路径）。
3. **服务器环境**：安装好 Docker，且能访问 `coolify` 网络（Coolify 托管的 Postgres）。

## 手动部署 / 回滚

```bash
# 拉取（走镜像源）
docker pull ghcr.nju.edu.cn/yanyang-technology-group/ycomm-web:<tag>

# 停旧起新（加入 coolify 网络）
docker rm -f ycomm || true
docker run -d --name ycomm --restart unless-stopped --network coolify -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_DRIVER=postgres \
  -e DATABASE_URL='postgres://ycomm:<DB_PASSWORD>@<DB_HOST>:5432/ycomm' \
  -e SESSION_SECRET='<SESSION_SECRET>' \
  -e SITE_URL='https://community.yanyn.cn' \
  -e TRUST_PROXY_HEADERS=true \
  ghcr.nju.edu.cn/yanyang-technology-group/ycomm-web:<tag>
```

回滚：用上一个版本的 tag 重跑一遍即可。

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