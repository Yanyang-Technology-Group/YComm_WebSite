# YComm 架构设计

> 本文档是 P0~P5 的设计依据，与代码保持同步。改动架构前先改这里。

## 1. 分层与依赖方向

模块化单体，单仓库、单容器、单进程，内部强制分层：

```
apps/web                  UI 层：页面、组件、表单（SSR）
   │  只通过 @ycomm/api（进程内 app.request() 或 HTTP）通信
   ▼
apps/api                  HTTP 层：Hono 路由、鉴权中间件、入参校验、DTO 序列化
   │  薄，只做编排，不写业务规则
   ▼
packages/identity         账号、会话、密码、OAuth、邮箱验证      ← “你是谁”
packages/access           ★ 权限点、角色、策略引擎、守卫          ← “你能做什么”
packages/forum            版块、主题、回帖
packages/downloads        资源、版本、外链、文件
packages/moderation       审核队列、举报、警告、禁言、封禁
packages/notify           邮件与站内通知
packages/jobs             DB 任务表与处理器
   │
packages/kernel           环境配置、AppError、日志、ID（最底层）
packages/db               Drizzle schema + 迁移 + 双驱动客户端（唯一能碰库的包）
```

**用 ESLint 强制的纪律（违反即 CI 失败）：**

1. 依赖方向单向：`web → api → 领域包 → kernel/db`。
2. 只有 `@ycomm/db` 能碰数据库；`apps/web` 从结构上拿不到 db client。
3. `packages/*` 与 `config/` 禁止 import `next` / `hono`（领域层与框架解耦）。
4. 禁止深层 import——只从各包 `package.json` 的 `exports` 入口导入。

**进程内通信**：Server Component 不发起外部 HTTP，而是 `app.request(...)`（Hono
进程内 fetch），保留 HTTP 边界、零网络开销；表单走 Server Actions，同样转成一次
`api.request()`。业务入口只有一个。

**运行形态**：`DATABASE_DRIVER=pglite`（本地开发/测试，零安装）与
`postgres`（生产）共用同一套 schema 与迁移文件。

> ⚠️ **PGlite 数据目录是单进程资源**：不要同时让多个进程（dev server 与 CLI）
> 打开同一个 `PGLITE_DATA_DIR`，第二个进程的写入对第一个不可见甚至可能损坏
> 数据目录。正确姿势：先跑完 CLI 操作（migrate/seed/owner:*）再启动 dev
> server。生产是 Postgres（连接池），天然多进程安全；容器 entrypoint 也是
> 先迁移后启动，不存在此问题。

## 2. 权限体系（四个互不混淆的概念）

| 概念 | 回答的问题 | 存哪 | 谁改 |
|---|---|---|---|
| 角色 Role | 你能做什么（member/admin/owner） | 代码定义 + 用户记录 | 站长授予 |
| 等级 Level | 你够不够门槛（Lv0~Lv4） | 派生值 | 系统按活动自动算 |
| 状态 State | 你现在能不能做事 | 用户记录 | 管理员/系统 |
| 策略 Policy | 这个资源对谁能见 | 资源记录 jsonb | 管理员 |

**判定链（所有请求必经）：**

```
① 状态闸门   banned→403 全拒；unverified→只放行验证相关；muted→写操作 403
② 资源策略   该版块/资源的可见性（public / login / minLevel / requireInvite）
③ 权限点     role → permission 集合，权限点形如 forum.topic.create
④ 限流风控   IP（CF-Connecting-IP）+ 账号 双维度
⑤ 放行       写审计日志；下载类额外签发短时效链接（外链不落 HTML）
```

**关键设计决定：**

- 邀请码是**挂在版块/资源上的策略**（`access_grants` 表），不是注册开关——同一机制
  既能守版块也能守下载文件。
- **Admin 不能授予任何角色**（`canAssignRole`），只有 Owner 能授予 Admin；操作
  他人账号要求严格更高等级（`canActOnUser`）。防管理员自提权。
- Admin 上传下载资源 → 需 Owner 审核；Owner 直接发布。改文案不触发重审，改
  文件/外链才回到审核队列。
- 等级是派生值：`computeLevel({ postCount, likeReceivedCount, accountAgeDays })`，
  由 config/policy.ts 的阈值表驱动，事件触发重算 + 每日兜底。
- 外链 URL 与提取码**绝不出现在 DTO 里**——`ResourcePublicDTO` 结构上就没有这两个
  字段，并有专门的安全回归测试断言响应体中不含外链。

## 3. 数据模型（Postgres，25 张表）

- **身份**：`users`（role/state/level 派生计数）、`sessions`（存哈希）、
  `oauth_accounts`、`email_tokens`、`invite_codes` + `invite_code_uses`
- **准入**：`access_grants`（user × resource_type × resource_id 唯一；granted_via）
- **论坛**：`boards`（jsonb access_policy）、`topics`、`posts`（主楼=position 1）、
  `post_revisions`（编辑留档）、`reactions`（点赞，等级输入）
- **下载**：`download_categories`、`download_resources`（status 状态机）、
  `download_links`（url/extract_code 仅门禁后可见）、`download_reports`、
  `download_logs`（计数/限额/审计三用）
- **治理**：`moderation_items`（统一审核队列）、`moderation_actions`、`user_sanctions`
- **系统**：`settings`（运行时覆盖）、`audit_logs`、`jobs`、`notifications`、
  `email_logs`

资源状态机：`draft → pending_review —(Owner approve)→ published`；可 withdraw /
reject→resubmit；published 改动文件/外链重新转 pending_review；可 archive。

## 4. 配置体系

1. **代码默认值**（`config/*.ts`）：权限矩阵、等级阈值、限流参数、版块/分类种子。
   改动走 git、重启生效。
2. **环境变量**（`packages/kernel/src/config/env.ts`，zod 校验）：secrets、站点品牌、
   部署参数。**config/ 目录禁止出现任何密钥**——整个目录进开源仓库。
3. **运行时覆盖**（`settings` 表）：管理员在后台改，DB 覆盖代码默认；启动时校验
   DB 里的角色名必须存在于 config/roles.ts。

## 5. 安全边界清单

| 面 | 措施 |
|---|---|
| 会话 | `__Host-session` cookie：HttpOnly + Secure + SameSite=Lax，登录轮换，可撤销 |
| CSRF | SameSite=Lax + API 校验 Origin |
| XSS | 只存 Markdown，渲染时白名单清洗；禁止 SVG 内联展示 |
| 越权 | 所有资源访问必经判定链；外链不落 DTO，302 短时效签名 |
| 上传 | 魔数校验 + 大小上限 + 随机文件名 + 不可执行目录 |
| 密码 | argon2id，只设最小长度 |
| 限流 | 登录/注册/找回/发帖/下载/举报独立配额，IP+账号双维度 |
| 枚举 | 注册/找回响应不泄露账号是否存在 |
| 审计 | 全部管理动作 + 登录失败 |
| 备份 | 定时 pg_dump + uploads 增量，且验证可恢复（脚本 P5 落地） |

## 6. 测试策略

- 单元（Vitest）：config 的**权限矩阵表驱动测试**（角色×权限点×策略 → allow/deny，
  防止矩阵悄悄漂移）、computeLevel、env 校验、错误映射。
- 集成（Testcontainers / PGlite in-memory）：仓储、邀请码并发核销、审核状态机。
- E2E（Playwright，P1 起）：注册→验证→发帖；Admin 上传→Owner 审核→Member 下载。
- **安全回归**：未登录/越权必 403；下载详情响应体断言不含外链 URL。
- CI 顺序：lint（含边界）→ typecheck → test → license 门禁 → DCO 检查。

## 7. 分期

| 期 | 内容 | 验收 |
|---|---|---|
| P0 | 地基：monorepo/config/schema/kernel/API+Web 骨架/部署/CI | 迁移+种子可跑、/api/healthz 绿、verify 全过 |
| P1 | 身份：注册/验证/登录/找回/owner:recover | 能登录，会话可撤销，limit 生效 |
| P2 | 权限内核：判定链 + 矩阵测试 + 后台骨架 | 权限矩阵表驱动测试绿 |
| P3 | 论坛 | 能发帖，新成员前 N 帖进审核队列 |
| P4 | 下载区 | 门禁 + 两级审核 + 外链不泄露 |
| P5 | 开源就绪：README/LICENSE 全文/NOTICE/备份脚本 | 别人一条命令跑起来 |

## 8. 部署（单机 Docker + Cloudflare Tunnel）

```
cloudflared (出站隧道) ──> app:3000 (仅绑定 127.0.0.1) ──> db (Postgres 16)
```

容器 entrypoint 自动 `db:migrate` + `db:seed`（幂等），healthcheck 打
`/api/healthz`（真正查询数据库）。备份：宿主机 cron pg_dump + uploads 增量同步。