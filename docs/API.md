# REST API 与客户端接入

本文档以当前 `apps/api/src/routes` 的实现为准。Base URL 为：

```text
<站点地址>/api
```

API 当前没有 `/v1` 版本前缀，属于当前应用契约。除下文标出的文件流、重定向和健康检查外，成功响应均为 `{ "ok": true, "data": ... }`；错误响应均为 `{ "ok": false, "error": { "code": string, "messageKey": string, "meta": object, "message"?: string } }`。内部错误返回 HTTP 500，`error` 为 `{ code: "INTERNAL", message: "Internal server error", traceId }`。不存在的路由返回 HTTP 404。

常见错误码包括 `VALIDATION_FAILED`（400）、`UNAUTHENTICATED` / `ACCESS_LOGIN_REQUIRED`（401）、`FORBIDDEN`、`ACCOUNT_UNVERIFIED`、`ACCOUNT_MUTED`、`ACCOUNT_BANNED`、`ACCESS_LEVEL_TOO_LOW`、`ACCESS_INVITE_REQUIRED`（403）、`NOT_FOUND`（404）、`CONFLICT` / `NOT_INITIALIZED`（409）、`PAYLOAD_TOO_LARGE`（413）、`UNSUPPORTED_MEDIA_TYPE`（415）和 `RATE_LIMITED`（429）。权限受账号状态、角色、等级、邀请码和资源可见性共同约束。

## 会话、Flutter 与传输安全

登录态使用 Cookie Session，**另外支持站长签发的开放 API 密钥**（`Authorization: Bearer <key>`）用于脚本/外部系统；不接受 URL token，也不接受普通用户签发的密钥。Cookie 名由 `SESSION_COOKIE_NAME` 配置，默认 `__Host-ycomm_session`；它带 `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`，无 `Domain`。密码登录传 `rememberMe: true` 时 Cookie 与服务端会话最长 15 天，否则是浏览器会话 Cookie；OAuth 登录使用浏览器会话 Cookie。

### 开放 API 密钥（仅站长）

- 站长在「管理后台 → API 密钥」创建；明文只在创建响应里出现一次，库里只存 `sha256`。
- 请求时带 `Authorization: Bearer ycomm_…`，身份等同**站长本人**（拥有全部权限）；密钥可设为**只读**（只允许 `GET`/`HEAD`，写操作返回 403）并可设置有效期。
- 撤销或过期后立即失效；如果站长身份被转让，旧密钥（归属用户不再是 owner）自动失效。
- 每次使用会更新该密钥的「最近使用时间」（一分钟节流写库）。
- 用密钥调用的请求不需要 CSRF 防护（不依赖 Cookie），也不会被 `SameSite` 影响。

Flutter 原生客户端应使用可持久化的 `CookieJar`，完整保存和回送 `Set-Cookie`，并只通过 HTTPS 访问生产站。`HttpOnly` Cookie 不应由业务代码读取。Flutter Web 与站点同源部署时不需要 CORS；当前 API 没有配置跨域响应头。Flutter 原生请求不受浏览器 CORS 限制。

系统浏览器和 Flutter 原生 HTTP 客户端不共享 Cookie。当前 GitHub OAuth 回调只把 Session Cookie 写入浏览器 Cookie 存储，且没有 App Deep Link 或一次性 session 交接接口，因此浏览器完成 OAuth 后，原生 `CookieJar` 仍未登录，调用 `/auth/me` 会返回 401。Flutter 原生版目前应使用账号密码登录；GitHub OAuth 只适用于 Web 浏览器流程。

JSON 请求使用 `Content-Type: application/json`。文件和图片上传使用 `multipart/form-data`，字段名均为 `file`。日期时间均按 JSON 序列化结果传输（通常为 ISO 8601 字符串）。分页接口使用从 0 开始的 `offset` 和 `limit`；各接口上限见表格。启用 CAPTCHA 时，注册、登录、找回/重置密码、申请注销、站长立即注销用户和站长重置密码等接口必须提交服务端验证码提供方签发的 `captchaToken`；未启用时可省略。

## 共享数据模型

| 模型 | 字段摘要 |
|---|---|
| `PublicUser` | `id`, `username`, `displayName`, `role: member\|admin\|owner`, `level`, `state`, `avatarPath`, `bio`, `hasPassword`, `createdAt`。不含邮箱和密码散列。 |
| `ProfileUser` | `PublicUser` 加 `email`, `inviteBound`, `inviteCode`, `oauthProviders`, `homepageMd`, `followingVisibility`, `followersVisibility`, `homepageVisibility`（均为 `public\|mutual\|private`）、`mutedUntil`, `muteReason`, `bannedUntil`, `banReason`, `themeColour`, `themeMode`。 |
| `SessionView` | 登录设备管理的会话摘要（一次登录 = 一条会话）：`id`, `device`（由 User-Agent 推断的简短展示名，仅用于显示）、`ip`（未知为 `null`）、`createdAt`, `lastUsedAt`（可为 `null`）、`expiresAt`, `isCurrent`。时间均为 ISO 8601。绝不包含 Cookie、Token 或 `token_hash`。 |
| `UserProfile` | `id`, `username`, `displayName`, `avatarPath`, `bio`, `homepageMd`, `role`, `level`, `state`, `createdAt`, `postCount`, `likeReceivedCount`, `followerCount`, `followingCount`, `viewerFollowsTarget`, `targetFollowsViewer`, `followingVisibility`, `followersVisibility`, `homepageVisibility`, `followingListVisible`, `followersListVisible`, `homepageVisible`, `badges`, `isSelf`。 |
| `FollowedUser` | `id`, `username`, `displayName`, `avatarPath`, `role`, `level`, `bio`, `followsViewer`。 |
| `Board` | `id`, `slug`, `name`, `description`, `parent_id`, `sort_order`, `access_policy`, `topic_count`, `post_count`, `posting_policy`, `archived_at`, `created_at`, `updated_at`，另加解析后的 `policy`；公开列表不含已归档版块。 |
| `Topic` | `id`, `board_id`, `author_id`, `title`, `slug`, `is_pinned`, `is_locked`, `status`, `reply_count`, `view_count`, `last_post_at`, `last_post_author_id`, `created_at`, `updated_at`, `deleted_at`, `deleted_by`；列表另有 `authorUsername`, `authorDisplayName`, `authorLevel` 和 `preview: { firstPost, topReplies }`。 |
| `Post` | `id`, `topic_id`, `author_id`, `position`, `content_md`, `status`, `reply_to_post_id`, `edited_at`, `edit_count`, `created_at`, `deleted_at`, `deleted_by`；详情列表另有 `authorUsername`, `authorDisplayName`, `authorAvatarPath`, `authorBadges`。 |
| `Resource` | 对外字段：`id`, `categoryId`, `authorId`, `title`, `summary`, `descriptionMd`, `versionLabel`, `sourceType`, `status`, `downloadCount`, `viewCount`, `publishedAt`, `createdAt`。下载链接、提取码和访问策略不会随资源返回。 |
| `Category` | `id`, `slug`, `name`, `description`, `sort_order`, `access_policy`, `archived_at`, `created_at`, `updated_at`，另加解析后的 `policy`；只返回当前访问者可见的分类。 |
| `Card` | 公开卡片为 `id`, `parentId`, `title`, `subtitle`, `subtitleUrl`, `kind`, `redirectUrl`, `w`, `h`, `position`；扁平返回，客户端按 `parentId` 组树。 |
| `ModerationItem` | `id`, `target_type`, `target_id`, `reason`, `reporter_id`, `detail`, `status`, `decided_by`, `decided_at`, `decision_note`, `created_at`。 |
| `NotificationGroup` | `key`, `kind`, `title`, `body`, `linkUrl`, `isAdmin`, `count`, `unreadCount`, `latestAt`, `actors`（最多 8 个）、`sampleCreatedAt`。 |
| `AdminUser` | `PublicUser` 加 `email`, `postCount`, `likeReceivedCount`, `createdAt`, `mutedUntil`, `bannedUntil`, `muteReason`, `banReason`；用户列表另加 `githubUsername`, `lastLoginAt`, `inviteCodeUsed`。 |
| `AdminCard` | `id`, `parentId`, `title`, `subtitle`, `subtitleUrl`, `kind`, `redirectUrl`, `w`, `h`, `visibility`, `position`, `status`。 |
| `AdminBoard` | `id`, `slug`, `name`, `description`, `parentId`, `sortOrder`, `visibility`, `minLevel`, `requireInvite`, `postingPolicy`, `archivedAt`, `createdAt`。 |

下列表格中的 `Path` 表示路径参数、`Query` 表示查询参数、`JSON` 表示请求体。未列出的参数类别表示无；没有请求体的接口不要发送业务 JSON。字符串字段的数字范围表示字符长度。

表格中“公开/可选会话”表示不要求登录，但有效 Session 会影响可见内容、点赞状态或关系字段。“权限”表示必须登录并拥有所列权限；角色的具体权限以站点 `config/roles.ts` 为准。

## 健康检查

| 方法与路径 | 鉴权 | 参数/请求 | 成功响应与行为 |
|---|---|---|---|
| `GET /api/healthz` | 公开 | 无 | 不使用标准 `data` 信封。数据库可用时 HTTP 200：`{ ok: true, service, name, version, db: "up", time }`；探测失败时 HTTP 503、`ok: false`, `db: "down"`。会实际执行数据库查询。 |

## 认证与账号 `/api/auth`

| 方法与路径 | 鉴权 | 参数/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `POST /api/auth/register` | 公开；IP 限流 | JSON：`username` 1–20、`email` 3–255、`password` 1–200；可选 `inviteCode`, `captchaToken`；`agreeTerms` 必须为 `true` | HTTP 201；`{ needsVerification, alreadyRegistered }`。为防账号枚举，已注册邮箱也使用相同响应形态。 |
| `POST /api/auth/verify-email` | 公开 | JSON：`token` 1–256 | `{ user: PublicUser }`。 |
| `POST /api/auth/resend-verification` | 公开；IP 限流 | JSON：`email`；可选 `captchaToken`（当前路由不校验该字段） | `null`；无论邮箱是否存在均相同。 |
| `POST /api/auth/login` | 公开；IP 限流 | JSON：`login`, `password`；可选 `captchaToken`, `rememberMe`；`agreeTerms` 必须为 `true` | `{ user: PublicUser, needsVerification, expiresAt }`，并设置 Session Cookie。注销冷静期内登录会自动取消注销；已过期处罚自动解除。 |
| `POST /api/auth/logout` | 可选会话 | 无 | `null`；有会话则撤销服务端会话，并清除 Cookie。幂等。 |
| `GET /api/auth/sessions` | 登录；仅 Session Cookie（Bearer API 密钥 403） | 无 | `{ sessions: SessionView[] }`。只返回当前账号未撤销、未过期的会话（一次登录 = 一条会话）；当前会话排第一并标记 `isCurrent`，其余按最近活跃（无记录看创建时间）倒序。`device` 仅由 User-Agent 作展示推断，不参与鉴权。 |
| `POST /api/auth/sessions/revoke-others` | 登录；仅 Session Cookie（Bearer API 密钥 403） | 无 | `{ revokedCount }`。一键退出本账号其他所有有效会话（当前会话不受影响，退出当前会话请用 `POST /api/auth/logout`）；重复调用返回 `revokedCount: 0`。 |
| `DELETE /api/auth/sessions/:sessionId` | 登录；仅 Session Cookie（Bearer API 密钥 403） | Path `sessionId`（UUID） | `null`。退出指定的其他设备：目标是当前会话返回 409，目标不存在、已失效或不属于当前用户返回 404。撤销后目标端 REST 请求立即返回未登录；已建立的 WebSocket 连接最迟约 30 秒后的下一次会话校验时断开。 |
| `GET /api/auth/me` | 登录 | 无 | `{ user: PublicUser & { themeColour, themeMode } }`。 |
| `POST /api/auth/delete-account` | 登录 | JSON：可选 `captchaToken` | `null`；发送确认邮件，确认后进入 3 天冷静期；禁言/封禁状态可能阻止操作。 |
| `POST /api/auth/delete-account/confirm` | 公开 | JSON：`token` | `null`；确认注销并进入冷静期。 |
| `POST /api/auth/cancel-deletion` | 登录 | 无 | `null`；冷静期内取消注销。 |
| `GET /api/auth/profile` | 登录 | 无 | `{ user: ProfileUser }`。 |
| `PATCH /api/auth/profile` | 登录 | JSON 全可选：`displayName` ≤40、`bio` ≤500、`avatarPath` ≤2000 或 `null`、`homepageMd` ≤8000、`followingVisibility`, `followersVisibility`, `homepageVisibility`（`public\|mutual\|private`）、`searchable`（布尔，是否允许被别人搜到，默认 true） | `{ user: PublicUser }`。 |
| `POST /api/auth/change-password` | 登录 | JSON：`currentPassword` 1–200、`newPassword` 8–200 | `null`。 |
| `POST /api/auth/set-password` | 登录 | JSON：`newPassword` 8–200 | `null`；仅用于 OAuth 创建且尚无密码的账号。 |
| `POST /api/auth/change-email` | 登录 | JSON：`email` 3–255 | `null`；新邮箱进入验证流程。 |
| `POST /api/auth/bind-invite` | 登录 | JSON：`code` 1–10 | `null`。 |
| `POST /api/auth/theme` | 登录 | JSON：`colour: azure\|pink\|mint\|orange\|slate\|none`，`mode: auto\|dark\|light` | `{ themeColour, themeMode }`。 |
| `POST /api/auth/oauth/unlink` | 登录 | JSON：`provider: github\|google` | `{ oauthProviders }`；没有密码时不可解绑最后的登录方式。 |
| `GET /api/auth/me/topics` | 登录 | 无 | `{ topics }`，当前用户创建的主题数组。 |
| `GET /api/auth/me/posts` | 登录 | 无 | `{ posts }`，当前用户创建的帖子数组。 |
| `GET /api/auth/me/resources` | 登录 | 无 | `{ resources }`，当前用户创建的资源数组。 |
| `GET /api/auth/github` | 公开 | Query：可选 `bind=1` 表示把 GitHub 绑定到当前会话账号 | 特例：HTTP 302 跳转 GitHub，并设置 30 分钟 `oauth_state` Cookie；不返回 JSON。未配置 GitHub 时返回 404 错误信封。 |
| `GET /api/auth/github/callback` | 公开；绑定流程需登录 Cookie | Query：GitHub 回传 `code`, `state` 或 `error` | 特例：仅 302 浏览器重定向。登录成功到 `/`；绑定成功到 `/dashboard?bind=done`；失败到 `/login?oauth=...` 或 `/dashboard?bind=error`。会设置 Session Cookie。无 App Deep Link。 |
| `POST /api/auth/forgot-password` | 公开；IP 限流 | JSON：`email`；可选 `captchaToken` | `null`；防枚举，不透露邮箱是否存在。 |
| `POST /api/auth/reset-password` | 公开；IP 限流 | JSON：`token`, `password` 1–200；可选 `captchaToken` | `null`。 |

## 论坛 `/api/forum`

| 方法与路径 | 鉴权 | 路径/Query/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/forum/boards` | 公开/可选会话 | 无 | `{ boards: Board[] }`，按访问策略过滤。 |
| `GET /api/forum/boards/:slug/topics` | 公开/可选会话；须可见版块 | Path `slug`；Query `offset` 默认 0，`limit` 默认 20、最大 100 | `{ total, topics }`，每个主题含 `preview`。 |
| `POST /api/forum/boards/:slug/topics` | 公开版块允许游客；登录用户须 `FORUM_TOPIC_CREATE` 且账号可操作；用户/IP 策略限流 | Path `slug`；JSON：`title` 1–120（领域层实际要求 2–120）、`content` 1–100000 | HTTP 201；`{ topic, post, needsReview }`。新会员内容可能进入审核；违禁词拦截；`postingPolicy=staff` 仅管理员/站长。 |
| `GET /api/forum/topics/:topicId` | 公开/可选会话；须可见所属版块 | Path `topicId`；Query `offset` 默认 0；每次固定最多 50 条帖子（路由不接受 `limit`） | `{ topic, posts, likedPostIds }`；增加浏览数；登录访问他人主题可能产生去重的浏览通知。帖子含作者徽章。当前响应不返回帖子总数。 |
| `POST /api/forum/topics/:topicId/posts` | 公开版块允许游客；登录用户须 `FORUM_POST_CREATE`；限流 | Path `topicId`；JSON：`content` 1–100000，可选 `replyToPostId` | HTTP 201；`{ post }`。锁定/非发布主题不可回复；新会员内容可能待审核；可能通知主题作者。 |
| `PATCH /api/forum/posts/:postId` | 登录；仅作者 | Path `postId`；JSON：`content` 1–100000；`replyToPostId` 可传但编辑逻辑忽略 | `{ post }`；保存编辑历史并检查违禁词。 |
| `DELETE /api/forum/posts/:postId` | 登录；自己的帖子需 `FORUM_POST_DELETE_OWN`，他人/游客帖子需 `FORUM_POST_DELETE_ANY` | Path `postId` | `null`；软删除并审计，管理员删他人帖子会通知作者。 |
| `POST /api/forum/posts/:postId/like` | 登录；账号可操作 | Path `postId` | `{ liked: true }`；幂等并可能通知作者。 |
| `POST /api/forum/topics/:topicId/share` | 登录；账号可操作 | Path `topicId` | `{ shared: true }`；对同一分享者 24 小时去重通知。 |
| `POST /api/forum/posts/:postId/unlike` | 登录 | Path `postId` | `{ liked: false }`；幂等。 |
| `POST /api/forum/topics/:topicId/action` | 登录；按动作要求置顶、锁定、删除任意内容或移动主题权限 | Path `topicId`；JSON：`action: pin\|unpin\|lock\|unlock\|delete\|move`；移动时必须 `boardId` | `{ topic }`；写审计，删除他人主题会通知作者。 |
| `DELETE /api/forum/topics/:topicId` | 登录；自己的主题需 `FORUM_POST_DELETE_OWN`，他人/游客主题需 `FORUM_POST_DELETE_ANY` | Path `topicId` | `null`；软删除并审计。 |
| `GET /api/forum/search` | 公开/可选会话 | Query：`q`，`scope=all\|forum\|downloads\|users`（其他值返回空集合） | `{ forum, users, downloads }`。`forum` 为**按板块分组**的数组：`{ boardId, boardSlug, boardName, topics[] }`（组内按相关度、组间按最好成绩排序）；`users` 排除注销/封禁与关闭了「允许被搜到」的账号；`downloads` 按访问者可见性过滤。 |
| `GET /api/forum/moderation/pending` | 权限 `FORUM_CONTENT_AUDIT` | 无 | `{ items: ModerationItem[] }`，仅主题和帖子。 |
| `POST /api/forum/moderation/:itemId/decide` | 权限 `FORUM_CONTENT_AUDIT` | Path `itemId`；JSON：`decision: approve\|reject`，可选 `note` ≤500 | `null`；只能处理主题/帖子待审项，并写审计。 |

## 下载区 `/api/downloads`

| 方法与路径 | 鉴权 | 路径/Query/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/downloads/categories` | 公开/可选会话 | 无 | `{ categories: Category[] }`，按访问策略过滤。 |
| `GET /api/downloads/cards` | 公开/可选会话 | 无 | `{ cards: Card[] }`，仅已发布且可见卡片，扁平返回。 |
| `GET /api/downloads/resources` | 公开/可选会话 | Query：可选 `categoryId`，`offset` 默认 0，`limit` 默认 20、最大 100 | `{ resources, total }`，仅已发布且当前主体可见。 |
| `GET /api/downloads/resources/:resourceId` | 可选会话；须账号状态可用、策略允许且有 `DOWNLOAD_RESOURCE_VIEW` | Path `resourceId` | `{ resource: Resource }`。 |
| `POST /api/downloads/resources` | 权限 `DOWNLOAD_RESOURCE_CREATE` | JSON：`categorySlug`, `title` 1–80；可选 `summary` ≤300、`description` ≤20000、`versionLabel` ≤40；`sourceType=external\|local` 默认 external；`visibility=public\|login\|invite` 默认 login | HTTP 201；`{ resource: Resource }`；资源状态由创建者角色/审核规则决定。 |
| `PATCH /api/downloads/resources/:resourceId` | 权限 `DOWNLOAD_RESOURCE_EDIT_OWN`；实际还需作者或 owner | Path `resourceId`；JSON 全可选：`title`, `summary`, `description`, `versionLabel`（可 null）, `categorySlug`, `visibility` | `{ resource: Resource }`。分类 slug 不存在时当前实现不会显式报错，而是不更新分类。 |
| `POST /api/downloads/resources/:resourceId/withdraw` | 权限 `DOWNLOAD_RESOURCE_EDIT_OWN`；作者或 owner | Path `resourceId` | `null`；撤回资源。 |
| `POST /api/downloads/resources/:resourceId/links` | 权限 `DOWNLOAD_RESOURCE_EDIT_OWN`；作者或 owner | Path `resourceId`；JSON：`sourceType: external\|local`；可选 `kind: primary\|mirror`, `url`, `extractCode` ≤32, `localPath`, `fileName`, 非负整数 `sizeBytes` | `{ link: { id, kind, source_type, status } }`；URL、提取码和本地路径不回传。外链受域名白名单等领域校验。 |
| `POST /api/downloads/resources/:resourceId/upload` | 权限 `DOWNLOAD_RESOURCE_CREATE`；作者或 owner | Path `resourceId`；multipart 字段 `file` | HTTP 201；`{ file: { name, size } }`；保存本地文件并创建 local link。文件大小/类型限制由上传存储层配置执行。 |
| `DELETE /api/downloads/links/:linkId` | 权限 `DOWNLOAD_RESOURCE_EDIT_OWN`；所属资源作者或 owner | Path `linkId` | `null`。 |
| `POST /api/downloads/links/:linkId/report` | 权限 `DOWNLOAD_LINK_REPORT`；限流 | Path `linkId`；JSON：可选 `reason` ≤300 | `null`；创建死链审核项。 |
| `POST /api/downloads/resources/:resourceId/report` | 权限 `DOWNLOAD_LINK_REPORT`；限流 | Path `resourceId`；JSON：可选 `reason` ≤300 | `null`；按资源举报其下载链接。 |
| `GET /api/downloads/resources/:resourceId/go` | 可选会话；完整资源访问策略、账号状态、下载权限与每日配额检查 | Path `resourceId`；本地文件可带单段 `Range: bytes=start-end` | 特例：外链 HTTP 302 跳转且不向脚本暴露 URL；本地文件返回 `application/octet-stream`、`Content-Disposition: attachment`，完整响应 200，合法范围响应 206，并带 `Accept-Ranges`。不返回 JSON。 |
| `GET /api/downloads/resources/:resourceId/extract-code` | 与实际下载相同的访问门禁 | Path `resourceId` | `{ extractCode: string\|null }`；仅在通过门禁后返回。 |
| `POST /api/downloads/moderation/:itemId/decide` | 权限 `DOWNLOAD_RESOURCE_AUDIT` | Path `itemId`；JSON：`decision: approve\|reject`，可选 `note` ≤500 | `null`；仅下载资源/链接审核项。 |

## 上传 `/api/uploads`

| 方法与路径 | 鉴权 | 参数/请求 | 成功响应与特殊行为 |
|---|---|---|---|
| `POST /api/uploads/images` | 登录；用户限流 | multipart 字段 `file` | HTTP 201；`{ url, mime, size }`。仅 PNG/JPEG/WebP/GIF，magic byte 校验，单个 ≤50MB，文件名随机化。 |
| `GET /api/uploads/images/:file` | 公开 | Path `file` 必须为 8–64 位安全随机名加允许的图片扩展名 | 特例：直接返回图片字节与正确 MIME，`Cache-Control: public, max-age=31536000, immutable`；不返回 JSON。 |
| `POST /api/uploads/videos` | 登录；用户限流（10 次/小时） | multipart 字段 `file` | HTTP 201；`{ url, mime, size }`。仅 MP4/WebM/MOV，magic byte 校验，单个 ≤50MB，文件名随机化。 |
| `GET /api/uploads/videos/:file` | 公开 | Path `file` 必须为 8–64 位安全随机名加 `mp4\|webm\|mov` 扩展名 | 特例：直接返回视频字节与正确 MIME，支持 `Range`（206，可拖动进度条），`Cache-Control: public, max-age=31536000, immutable`；不返回 JSON。 |

## 用户 `/api/users`

| 方法与路径 | 鉴权 | 参数 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/users/:username` | 公开/可选会话 | Path `username` | `{ profile: UserProfile }`；注销或封禁用户返回 404，隐私字段按访问者关系计算。 |
| `GET /api/users/:username/following` | 公开/可选会话；须符合对方可见度 | Path `username` | `{ items: FollowedUser[] }`，最多 100 条；不可见时 403。 |
| `GET /api/users/:username/followers` | 公开/可选会话；须符合对方可见度 | Path `username` | `{ items: FollowedUser[] }`，最多 100 条；不可见时 403。 |
| `POST /api/users/:username/follow` | 登录 | Path `username` | `{ following: true }`；幂等，不能关注自己，写审计。 |
| `POST /api/users/:username/unfollow` | 登录 | Path `username` | `{ following: false }`；幂等，写审计。 |
| `GET /api/users` | 公开 | Query：可选 `q`, `offset` 默认 0；`limit` 固定 20 | `{ items, total }`；item 为 `id`, `username`, `displayName`, `avatarPath`, `role`, `level`。注意该静态根路由与 `/:username` 的匹配由 Hono 路由器处理。 |

## 通知 `/api/notifications`

| 方法与路径 | 鉴权 | 请求 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/notifications` | 登录 | 无 | `{ groups: NotificationGroup[] }`；读取最近 400 条后分组并按最新时间倒序。 |
| `GET /api/notifications/unread-count` | 登录 | 无 | `{ count }`。 |
| `POST /api/notifications/read` | 登录 | JSON：可选 `keys: string[]` | `{ count }`（操作后的未读数）。`keys` 缺省、空数组或包含 `"*"` 表示全部已读；组 key 形如 `t:<kind>:<topicId>`, `c:<kind>:<cardId>`, `i:<id>`。 |

## 管理 `/api/admin`

所有接口都要求有效 Session；表中的权限还会执行账号状态检查。

### 用户、徽章与设置

| 方法与路径 | 权限 | 路径/Query/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/admin/users` | `ADMIN_DASHBOARD_ACCESS` | Query：可选 `q`，`offset` 默认 0，`limit` 默认 20、最大 100 | `{ users: AdminUser[], total }`。 |
| `PATCH /api/admin/users/:userId/role` | `USER_ROLE_ASSIGN`（实际仅 owner 可授予敏感角色） | Path `userId`；JSON：`role: member\|admin\|owner` | `{ user: AdminUser }`；owner 身份转移受领域规则约束。 |
| `POST /api/admin/users/:userId/ban` | `USER_BAN` | Path `userId`；JSON：可选 `reason` ≤300，`until` 为 ISO datetime 或 `null`（缺省/null 为永久） | `{ user: AdminUser }`；通知目标用户。 |
| `POST /api/admin/users/:userId/unban` | `USER_BAN` | Path `userId` | `{ user: AdminUser }`。 |
| `POST /api/admin/users/:userId/mute` | `USER_MUTE` | Path `userId`；JSON：可选 `reason` ≤300，`until` 为 ISO datetime 或 `null` | `{ user: AdminUser }`；通知目标用户。 |
| `POST /api/admin/users/:userId/unmute` | `USER_MUTE` | Path `userId` | `{ user: AdminUser }`。 |
| `POST /api/admin/users/:userId/delete` | `ADMIN_DASHBOARD_ACCESS` 且角色必须 owner | Path `userId`；JSON：可选 `captchaToken` | `null`；立即永久注销，无 3 天冷静期，并撤销相关状态。 |
| `POST /api/admin/users/:userId/reset-password` | `ADMIN_DASHBOARD_ACCESS`；领域层要求 owner | Path `userId`；JSON：`newPassword` 8–200，可选 `captchaToken` | `{ user: AdminUser }`；目标用户全部会话失效。 |
| `GET /api/admin/badges` | `ADMIN_DASHBOARD_ACCESS` | 无 | `{ badges }`。 |
| `POST /api/admin/badges` | `ADMIN_DASHBOARD_ACCESS` | JSON：`name` 1–20；可选 `colorFrom`, `colorTo`（`#RRGGBB`） | HTTP 201；`{ badge }`。 |
| `DELETE /api/admin/badges/:badgeId` | `ADMIN_DASHBOARD_ACCESS` | Path `badgeId` | `null`；删除定义及关联并写审计。 |
| `GET /api/admin/users/:userId/badges` | `ADMIN_DASHBOARD_ACCESS` | Path `userId` | `{ badges }`。 |
| `POST /api/admin/users/:userId/badges/:badgeId` | `ADMIN_DASHBOARD_ACCESS` | Path `userId`, `badgeId` | `{ badges }`（分配后的完整列表）；幂等性由领域层约束。 |
| `DELETE /api/admin/users/:userId/badges/:badgeId` | `ADMIN_DASHBOARD_ACCESS` | Path `userId`, `badgeId` | `{ badges }`（撤销后的完整列表）。 |
| `GET /api/admin/settings` | `ADMIN_DASHBOARD_ACCESS` | 无 | `{ settings }`，运行时设置键值列表。 |
| `PATCH /api/admin/settings` | `SITE_CONFIG_EDIT` | JSON：`key` 1–64，`value` 任意 JSON 值 | `null`；可写键及值合法性由领域层白名单校验。 |

### 审核、资源、审计与注册码

| 方法与路径 | 权限 | 路径/Query/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/admin/moderation` | `ADMIN_DASHBOARD_ACCESS` | Query：`offset` 默认 0，`limit` 默认 50、最大 100 | `{ items: ModerationItem[] }`。 |
| `POST /api/admin/moderation/:itemId/decide` | 按目标动态要求：下载资源 `DOWNLOAD_RESOURCE_AUDIT`，下载链接 `DOWNLOAD_RESOURCE_DELETE_ANY`，其余 `FORUM_CONTENT_AUDIT` | Path `itemId`；JSON：`decision: approve\|reject`，可选 `note` ≤500 | `null`；写审计。此路由没有静态权限中间件，但处理器内强制鉴权和权限。 |
| `GET /api/admin/resources` | `ADMIN_DASHBOARD_ACCESS` | Query：可选 `status`，`offset` 默认 0，`limit` 默认 50、最大 200 | `{ resources, total }`；资源摘要含 `id`, `categoryId`, `authorId`, `title`, `versionLabel`, `sourceType`, `status`, `downloadCount`, `createdAt`。无效 `status` 当前直接传入领域查询。 |
| `GET /api/admin/audit` | `SYSTEM_AUDITLOG_VIEW` | Query：可选 `action`（前缀匹配），`offset` 默认 0，`limit` 默认 50、最大 200 | `{ entries, total }`；entry 含操作人信息、IP、动作、目标、`meta`, `createdAt`。 |
| `GET /api/admin/invites` | `INVITE_CREATE` | 无 | `{ inviteCodes }`。 || `POST /api/admin/invites` | `INVITE_CREATE` | JSON：`name` 1–60；可选 `code` ≤10、`maxUses` 1–1000 | HTTP 201；`{ inviteCode }`；未给 code 时服务端生成。 |
| `DELETE /api/admin/invites/:inviteId` | `INVITE_CREATE` | Path `inviteId` | `null`。 |
| `PATCH /api/admin/invites/:inviteId` | `INVITE_CREATE` | Path `inviteId`；JSON：`maxUses` 1–100000（整数） | `{ inviteCode }`；修改可绑定账号数，不能小于已绑定的数量。 |
| `DELETE /api/admin/users/:userId/invite-binding` | `INVITE_CREATE` | Path `userId` | `{ code }`（解绑掉的注册码，未绑定时为 null）；删除绑定并把名额还给注册码。 |
| `GET /api/admin/invites/:inviteId/uses` | `INVITE_CREATE` | Path `inviteId` | `{ users }`；每项为 `userId`, `username`, `displayName`, `avatarPath`, `role`, `state`, `usedAt`。 |

### 开放 API 密钥（仅站长）

脚本 / CI 批量管理下载区卡片的完整示例（curl、Bash、PowerShell、Python、Node，含幂等 upsert 与常见坑）见 [`docs/API-卡片脚本.md`](./API-卡片脚本.md)。

| 方法与路径 | 权限 | 路径/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/admin/api-keys` | `API_KEY_MANAGE`（仅 owner） | 无 | `{ keys: ApiKeyView[] }`；只含名称、前缀、最近使用、有效期、撤销状态，**不含明文**。 |
| `POST /api/admin/api-keys` | `API_KEY_MANAGE`（仅 owner） | JSON：`name` 1–60；可选 `readOnly`（默认 false）、`expiresInDays` 0–3650（0/缺省 = 永久） | HTTP 201；`{ apiKey: ApiKeyView & { key: string } }`；`key` 明文只在此响应出现一次，形如 `ycomm_…`。 |
| `DELETE /api/admin/api-keys/:keyId` | `API_KEY_MANAGE`（仅 owner） | Path `keyId` | `null`；撤销后立即失效（幂等）。 |

### 下载卡片与论坛版块

| 方法与路径 | 权限 | 路径/请求体 | 成功 `data` 与特殊行为 |
|---|---|---|---|
| `GET /api/admin/cards` | `ADMIN_DASHBOARD_ACCESS` | 无 | `{ cards: AdminCard[] }`，含所有状态和可见度。 |
| `POST /api/admin/cards` | `ADMIN_DASHBOARD_ACCESS` | JSON：`title` 1–80；可选 `parentId`（可 null）、`insertBeforeId`, `subtitle` ≤200、`subtitleUrl` ≤2000/null、`kind: container\|redirect\|resources`（默认 container）、`redirectUrl` ≤2000/null、`w`,`h` 1–6、`visibility: public\|login\|invite\|staff`（默认 public）、整数 `position` | HTTP 201；`{ card: AdminCard }`。`insertBeforeId` 存在时优先使用其同层位置并忽略 `parentId/position`。非 owner 创建可能进入审核。 |
| `PATCH /api/admin/cards/:cardId` | `ADMIN_DASHBOARD_ACCESS` | Path `cardId`；JSON 为创建字段的可选版本（不含 `insertBeforeId`） | `{ card: AdminCard }`；防止形成父子循环。 |
| `POST /api/admin/cards/:cardId/review` | `ADMIN_DASHBOARD_ACCESS` 且角色必须 owner | Path `cardId`；JSON：`decision: approve\|reject` | `{ card: AdminCard }`；通知创建者。 |
| `DELETE /api/admin/cards/:cardId` | `ADMIN_DASHBOARD_ACCESS` | Path `cardId` | `null`。 |
| `POST /api/admin/cards/:cardId/move` | `ADMIN_DASHBOARD_ACCESS` | Path `cardId`；JSON：`direction: up\|down` | `{ card: AdminCard }`；同层交换顺序。 |
| `GET /api/admin/boards` | `FORUM_BOARD_MANAGE` | 无 | `{ boards: AdminBoard[] }`，包括已归档版块。 |
| `POST /api/admin/boards` | `FORUM_BOARD_MANAGE` | JSON：`slug` 2–40（小写字母/数字/连字符）、`name` 2–60；可选 `description` ≤500（默认空）、整数 `sortOrder`、`visibility: public\|login\|invite`（默认 public）、`postingPolicy: all\|staff`（默认 all） | HTTP 201；`{ board: AdminBoard }`。 |
| `PATCH /api/admin/boards/:boardId` | `FORUM_BOARD_MANAGE` | Path `boardId`；JSON：`name`, `description`, `sortOrder`, `visibility`, `postingPolicy` 均可选 | `{ board: AdminBoard }`。slug 不可修改。 |
| `DELETE /api/admin/boards/:boardId` | `FORUM_BOARD_MANAGE` | Path `boardId` | `null`；软删除（归档），主题和帖子保留。 |
| `POST /api/admin/boards/:boardId/restore` | `FORUM_BOARD_MANAGE` | Path `boardId` | `null`；恢复已归档版块。 |

## WebSocket /api/ws

WebSocket 地址为 `wss://<站点主机>/api/ws`（本地非 TLS 开发可用 `ws://`）。它使用同一 Session Cookie，Cookie 名为 `SESSION_COOKIE_NAME`，默认 `__Host-ycomm_session`；不要把 token 放进 URL、查询字符串或 WebSocket 子协议。

握手必须携带有效 Session Cookie。`Origin` 必须是一个纯 origin（scheme、host、port，不能带路径），并等于 `new URL(SITE_URL).origin`；因此即使 `SITE_URL` 配有路径，也只比较它的 origin。浏览器会自动设置 Origin；Flutter 原生 WebSocket 客户端必须显式设置 `site.origin`。开发环境未配置 `SITE_URL` 时，只允许 `http`/`https` 的 `localhost`、`127.0.0.1` 或 `[::1]` Origin。生产环境要求 `SITE_URL` 使用 HTTPS，握手也必须是 TLS；在可信反向代理后仅当 `TRUST_PROXY_HEADERS=true` 且 `X-Forwarded-Proto: https` 时才接受代理终止 TLS。

连接建立后服务端发送：

```json
{ "type": "ready", "data": { "userId": "<用户 ID>", "serverTime": "<ISO 8601>" } }
```

通知状态变化时发送：

```json
{ "type": "notification.changed", "data": { "reason": "created", "at": "<ISO 8601>" } }
```

该事件只表示“通知可能变化”，不携带通知正文；客户端收到后调用 `GET /api/notifications` 和/或 `GET /api/notifications/unread-count` 刷新。

服务端每 30 秒发送协议层 ping，并同时重新验证 Session；标准 WebSocket 客户端应自动 pong，不要发送业务 JSON ping。若一个周期没有收到 pong，服务端直接终止连接。服务端只允许下行事件，客户端发送任何消息会以 `1008 server_events_only` 关闭。每个用户最多 8 条连接，全进程最多 1000 条已建立连接，同时最多 100 个待鉴权升级；升级鉴权 5 秒未完成会断开。单条客户端消息（含分片累计）最大 1024 字节，关闭压缩。待发送事件达到 64 个或 socket 缓冲超过 64 KiB 时以 `1013 slow_consumer` 关闭。

握手阶段拒绝是 HTTP 响应，不是 WebSocket close frame：URL 带 query 返回 400；缺少/无效 Cookie 返回 401；Origin、用户状态或生产 HTTPS 不合要求返回 403；单用户连接超限（以及鉴权后并发抢占到总连接上限）返回 429；停止中、鉴权前全局/待鉴权容量耗尽或鉴权服务不可用返回 503。已建立连接在 Session 失效时以 `1008 session_invalid` 关闭，鉴权基础设施异常时以 `1011 authentication_unavailable` 关闭，服务退出时以 `1001 server_shutdown` 关闭。客户端应把这些关闭都视为需要重新确认登录态或稍后重连的提示，业务状态仍以 REST 为准。

断线后采用带抖动的指数退避重连（例如 1、2、4、8 秒，封顶 30 秒），连接成功收到 `ready` 后立即用 REST 补拉，避免断线窗口丢事件。401/403 或 `1008 session_invalid` 应先停止自动重连并引导重新登录；429、503、1011、1013 可退避重试。

## 文档维护

路由、Zod 请求校验和领域返回值发生变化时应在同一变更中更新本文件。`apps/api/src/routes/api-docs.test.ts` 检查已有路由文件中的方法与路径是否都有文档条目；它不能代替字段、权限及特殊响应的人工审查。新增路由模块时同时更新测试的挂载前缀清单。实时事件类型由 `packages/notify/src/events.ts` 导出，协议变更须同步客户端解析与本文协议说明。
