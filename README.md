# YComm

> 自托管的社区平台 —— **账号系统 · 论坛 · 下载区**，一个容器跑起来。

YComm 是一款面向自托管的社区型站点：经典论坛 + 资源下载站的形态，用现代技术栈（Next.js · Hono · PostgreSQL）实现。本地开发零安装、生产部署一条命令，开箱即用。

## 功能特色

- 👤 **账号系统** — 注册 / 邮箱验证 / 登录 / 找回密码，`owner` 引导建站。
- 💬 **论坛** — 版块、主题、回帖、点赞、编辑历史、新成员审核、搜索。
- 📦 **下载区** — 资源状态机、外链白名单门禁、两级审核、举报、每日配额。
- 🔐 **统一权限内核** — 角色（Owner / Admin / Member / Guest）+ 等级 + 访问策略（公开 / 需登录 / 邀请码）走同一判定链。
- 🚫 **违禁词拦截** — 后台维护词库，命中即拦。
- 🎨 **个性化主题** — 蔚蓝（默认）/ 粉 / 清新绿 / 浅色 / 深色，按用户选择、仅对自己生效。
- ⚡ **零安装开发** — 本地用 PGlite（嵌入式 Postgres），不用装数据库；生产用 Postgres 16，同一套 schema 与迁移。
- 📜 **开源合规** — AGPL-3.0-or-later，CI 强制依赖许可兼容 + DCO 签名。

## 技术架构

模块化单体（Modular Monolith），依赖方向单向强制：

```
web → api → 领域包 → kernel / db
```

- `apps/web`：Next.js 页面层，只调用 `@ycomm/api`，禁止直接接触数据库。
- `apps/api`：Hono HTTP 层，负责校验、鉴权与 DTO 编排。
- 领域包：`identity`（账号）、`access`（权限判定链）、`forum`（论坛）、`downloads`（下载区）、`moderation`（审核）、`notify`（邮件）、`jobs`（任务）、`audit`（审计）。
- 底座：`packages/db`（Drizzle schema + 迁移 + pglite/postgres 双驱动）、`packages/kernel`（env 校验、错误、日志、限流）。

依赖方向由 ESLint 在 CI 中强制校验，防止架构腐化。

## 快速开始

### 生产部署（Docker + Postgres）

```bash
cp .env.example .env
# 填上 DB_PASSWORD 和 SESSION_SECRET（openssl rand -base64 48）
docker compose up -d --build
```

应用只绑定 `127.0.0.1:3000`，对外通过 Cloudflare Tunnel 或你自己的反向代理暴露。完整部署与运维说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

### 本地开发（零安装）

```bash
npm install
npm run db:migrate          # 首次迁移（写入 .data/pglite）
npm run db:seed             # 种子：版块 / 下载分类 / 站点设置
npm run owner:create -- --username owner --email you@example.com --password <secret>
npm run dev                 # http://localhost:3000
```

首次进入站点：注册 → 邮箱验证（未配置邮件服务时控制台打印验证链接）→ 登录。
完整校验：`npm run verify`（lint + typecheck + test + license 检查）。

## 角色与权限

四种角色，权限矩阵统一由 `config/roles.ts` 定义：

| 角色 | 说明 | 如何获得 |
|---|---|---|
| `owner`（站长） | 全部权限，唯一，负责资源审核、角色授予、站点维护 | 建站时 `npm run owner:create`（或容器 `YCOMM_OWNER_*` 引导）；**全站仅一个** |
| `admin`（管理员） | 论坛/下载内容管理、用户管理、站点设置 | 站长在后台授予 |
| `member`（会员） | 发帖、上传资源、下载 | 注册并通过邮箱验证后默认 |
| `guest`（访客） | 只读公开内容 | 未登录 |

**把某个用户设为管理员：** 站长登录 → 顶栏「管理」→「用户」→ 找到该用户 → 授予 `admin` 角色。

- 只有站长能授予/撤销角色（`USER_ROLE_ASSIGN`），防止管理员自行提权；管理员之间也不能互相操作。
- 站长身份不可通过角色授予产生，只能由现任站长走「转移站长身份」（`SYSTEM_OWNER_TRANSFER`）流程移交。
- 站长密码丢失：用 `npm run owner:recover -- --password <新密码>` 在服务器控制台重置（无需邮件、无需 Web 会话），同时撤销其全部会话。详见 [docs/DATABASE.md](docs/DATABASE.md)。

## 文档

- 部署与运维：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- 数据库命令（迁移/种子/站长引导/救急重置）：[docs/DATABASE.md](docs/DATABASE.md)
- 贡献指南（DCO 与提交规范）：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全政策：[SECURITY.md](SECURITY.md)

## License

[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.txt) — 详见 [LICENSE](LICENSE)。