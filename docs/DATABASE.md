# 数据库命令

本文列出 YComm 所有与数据库相关的命令。所有命令都通过根目录的 `npm run` 转发到 `@ycomm/db` 工作区，需在仓库根目录执行。

## 命令总览

| 命令 | 用途 | 何时用 |
|---|---|---|
| `npm run db:generate` | 根据 schema 变更生成迁移 SQL | 开发时改了 `packages/db/src/schema/*` 之后 |
| `npm run db:migrate` | 应用未执行的迁移 | 首次部署、升级后 |
| `npm run db:seed` | 写入种子数据（版块/下载分类/站点设置） | 首次部署 |
| `npm run owner:create` | 创建唯一的站长（owner）账号 | 首次部署 |
| `npm run owner:recover` | 重置 owner 密码（救急通道） | 站长密码丢失、无法登录时 |

## 环境变量

数据库命令依赖以下环境变量（有安全默认值）：

| 变量 | 说明 |
|---|---|
| `DATABASE_DRIVER` | `pglite`（默认，嵌入式 Postgres，零安装开发）或 `postgres`（生产） |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db`，**仅 `DATABASE_DRIVER=postgres` 时必填** |
| `PGLITE_DATA_DIR` | PGlite 数据目录，默认 `./.data/pglite`（已在 `.gitignore`） |
| `YCOMM_OWNER_USERNAME` / `YCOMM_OWNER_EMAIL` / `YCOMM_OWNER_PASSWORD` | `owner:create` / `owner:recover` 的参数备选（命令行参数优先） |

## 命令详解

### `npm run db:migrate`

应用 `packages/db/migrations/` 下尚未执行的迁移，幂等（可重复跑）。

```bash
npm run db:migrate
```

- 本地（pglite）写入 `.data/pglite`；生产（postgres）写入 `DATABASE_URL` 指向的库。
- **Docker 容器启动时会自动执行**（见 `docker/entrypoint.sh`），无需手动跑。

### `npm run db:seed`

写入首次安装自带的种子数据：版块、下载分类、站点设置（feature 开关）。幂等——已存在的行不会被覆盖，删掉 `config/` 里的种子也不会删除库里已有数据。

```bash
npm run db:seed
```

### `npm run db:generate`（仅开发）

改了 `packages/db/src/schema/*` 里的表结构后，用它生成新的迁移 SQL（`drizzle-kit` 对比快照自动产出）。

```bash
npm run db:generate
```

- 产出：`packages/db/migrations/<序号>_<名字>.sql` + 更新 `meta/` 快照与 `_journal.json`。
- **这是开发期命令，运行时不需要**；生成后把新迁移一起提交。

### `npm run owner:create`

创建**唯一**的站长账号（owner）。一个站点没有 owner 时，注册会被拒绝（`NOT_INITIALIZED`）——避免「先注册者得天下」。

```bash
npm run owner:create -- --username owner --email you@example.com --password <secret>
```

或用环境变量：

```bash
YCOMM_OWNER_USERNAME=owner YCOMM_OWNER_EMAIL=you@example.com YCOMM_OWNER_PASSWORD=<secret> npm run owner:create
```

- 用户名需匹配注册规则，密码至少 10 位。
- 若已存在 owner，会拒绝再次创建。
- **Docker 部署可跳过手动执行**：在 Coolify/容器环境设好 `YCOMM_OWNER_USERNAME` / `YCOMM_OWNER_EMAIL` / `YCOMM_OWNER_PASSWORD`，entrypoint 首次启动会自动引导 owner（幂等，之后每次启动都是 no-op），用完记得清掉这三个变量。

### `npm run owner:recover`

站长密码丢失时的**救急通道**：从服务器控制台直接重置 owner 密码，不依赖 Web 会话、也不依赖邮件（邮件坏掉也能救）。

```bash
npm run owner:recover -- --password <new-secret>
npm run owner:recover -- --email owner@example.com --password <new-secret>   # 多个 owner 时指定
```

- 会撤销 owner 的所有活跃会话，并写入审计日志。

## 生产 vs 开发

| 场景 | 驱动 | 说明 |
|---|---|---|
| 本地开发 | `pglite`（默认） | 零安装，数据在 `.data/pglite` |
| 生产 | `postgres` | 需设 `DATABASE_URL`；容器 entrypoint 启动时自动 `db:migrate` + `db:seed` |

## 顺序建议

首次部署（生产）按顺序执行：

```bash
cp .env.example .env                # 填 DATABASE_URL、SESSION_SECRET 等
docker compose up -d --build        # entrypoint 自动 migrate + seed
npm run owner:create -- --username owner --email you@example.com --password <secret>
```

> 本地开发顺序：`npm install` → `npm run db:migrate` → `npm run db:seed` → `npm run owner:create` → `npm run dev`。
