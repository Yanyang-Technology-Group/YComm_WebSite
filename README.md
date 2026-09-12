# YComm

自托管的社区平台：**账号系统 · 论坛 · 下载区**，一个容器跑起来。

- **模块化单体**：`web → api → 领域包 → kernel/db`，依赖方向由 ESLint 强制单向。
- **统一权限内核**：角色（Owner/Admin/Member/Guest）+ 等级 + 资源访问策略（公开 / 需登录 / 邀请码）走同一个判定链；未登录只能看/发/下「管理员设为公开」的内容，其余全部登录墙。
- **下载区门禁**：外链与提取码不落任何列表/详情 API，通过门禁后短时效跳转；大文件外链、小文件本地；公开内容访客可下。
- **违禁词**：管理员在后台维护，含违禁词的主题/回复直接拦截。
- **个性化主题**：蔚蓝（默认）/ 粉 / 清新绿 / 浅色 / 深色，用户本地选择、仅对自己生效。
- **零安装开发**：本地用 PGlite（嵌入式 Postgres），不需要装数据库；生产用 Postgres 16，同一套 schema 与迁移。
- **许可证**：AGPL-3.0-or-later，CI 强制依赖许可兼容 + DCO 签名。

## 当前进度（P0–P5 全部完成）

| 期 | 内容 | 状态 |
|---|---|---|
| P0 | monorepo、配置体系、schema+迁移、kernel、API/Web 骨架、部署、CI | ✅ |
| P1 | 账号：注册 / 邮箱验证 / 登录 / 找回密码 / `owner:create` / `owner:recover` | ✅ |
| P2 | 权限判定链（状态门→策略门→权限点）+ 统一审核队列 + 管理后台 | ✅ |
| P3 | 论坛：版块 / 主题 / 回帖 / 点赞 / 编辑历史 / 新成员审核 / 搜索 | ✅ |
| P4 | 下载区：资源状态机 / 外链白名单门禁 / 两级审核 / 举报 / 每日配额 | ✅ |
| P5 | 开源就绪：README / NOTICE / 备份脚本 / license 门禁 / DCO | ✅* |

*P5 中唯一待办：把 `LICENSE` 头部换成 AGPL-3.0 全文（见 LICENSE 内 P5 清单，网络可达时从
https://www.gnu.org/licenses/agpl-3.0.txt 粘贴即可）。

## 快速开始（生产，Docker + Postgres）

```bash
cp .env.example .env
# 填上 DB_PASSWORD 和 SESSION_SECRET（openssl rand -base64 48）
docker compose up -d --build
```

App 只绑定 `127.0.0.1:3000`。对外暴露用 **Cloudflare Tunnel**（或你自己的反代）：

```toml
# cloudflared config.yml
tunnel: <tunnel-id>
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: forum.example.com
    service: http://localhost:3000
  - service: http_status:404
```

> Cloudflare 免费隧道限制单请求体 100MB——这是本地附件上限 50MB、大文件走外链的原因。
> 限流与封禁依赖 `CF-Connecting-IP`，请保持 `TRUST_PROXY_HEADERS=true`。

## 本地开发（零安装）

```bash
npm install
npm run dev          # http://localhost:3000
npm run db:migrate   # 第一次跑迁移（写入 .data/pglite，已在 .gitignore）
npm run db:seed      # 种子：版块 / 下载分类 / 站点设置
npm run owner:create -- --username owner --email you@example.com --password <secret>
                    # 首个站长（或：YCOMM_OWNER_* 环境变量）
npm run verify       # lint + typecheck + test + license 检查
```

首次使用流程：`db:migrate` → `db:seed` → `owner:create` 之后，再 `npm run dev`
进入站点；注册 → 邮箱验证（无 SMTP 时控制台会打印验证链接）→ 登录。

## 备份

```bash
DATABASE_URL=postgres://... BACKUP_TARGET=/mnt/backups/ycomm ./scripts/backup.sh
```

详见脚本头部（pg_dump + uploads 硬链轮转 + 保留周期）；**请每月验证一次恢复路径**。

## 目录

```
apps/web        Next.js 页面（只调 @ycomm/api，禁止 import 领域包/数据库）
apps/api        Hono HTTP 层（校验、鉴权中间件、DTO，薄编排）
packages/kernel 基础设施：env 校验、AppError、日志、ID、限流器
config/         类型化配置：站点 / 角色与权限矩阵 / 策略 / 版块与分类种子
packages/db     Drizzle schema + 迁移 + 双驱动客户端（pglite / postgres）
packages/identity      账号、会话、凭据、管理员操作
packages/access        访问判定链（状态门 → 策略门 → 权限点）
packages/forum         版块、主题、回帖、点赞
packages/downloads     资源状态机、外链门禁、本地文件
packages/moderation    统一审核队列
packages/notify        邮件（SMTP/console 回退）
packages/jobs          DB 任务表 + 进程内 worker
packages/audit         审计日志
```

## 文档

- 架构设计（分层、权限判定链、数据模型、安全边界、测试策略、分期）：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 贡献（DCO 与提交规范）：[CONTRIBUTING.md](CONTRIBUTING.md)

## License

[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.txt) — 详见 [LICENSE](LICENSE)。