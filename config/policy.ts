/**
 * Numeric policy knobs: levels, rate limits, moderation thresholds, upload caps.
 *
 * Anything an operator might reasonably want to change without reading code lives
 * in `config/*`. Anything that would be a *security* regression if loosened is
 * expressed as a hard ceiling here, and the environment can only lower it —
 * never raise it. `UPLOADS.attachment.maxBytes` is the clearest example: raise
 * the code ceiling deliberately, do not paper over it with an env var.
 */

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface LevelDefinition {
  level: number;
  name: string;
  description: string;
  /** All three thresholds must be met for the level to be reached. */
  minPosts: number;
  minLikesReceived: number;
  minAccountAgeDays: number;
}

/**
 * Levels are *derived* from activity, never hand-maintained, so they cannot
 * drift out of sync with the counters they are supposed to reflect.
 */
export const LEVELS: readonly LevelDefinition[] = [
  {
    level: 0,
    name: '新成员',
    description: '刚注册，前几帖会进入审核队列',
    minPosts: 0,
    minLikesReceived: 0,
    minAccountAgeDays: 0,
  },
  {
    level: 1,
    name: '正式成员',
    description: '已参与讨论',
    minPosts: 5,
    minLikesReceived: 1,
    minAccountAgeDays: 3,
  },
  {
    level: 2,
    name: '活跃成员',
    description: '稳定参与，可访问需要一定活跃度的资源',
    minPosts: 30,
    minLikesReceived: 10,
    minAccountAgeDays: 14,
  },
  {
    level: 3,
    name: '资深成员',
    description: '长期贡献者',
    minPosts: 100,
    minLikesReceived: 50,
    minAccountAgeDays: 60,
  },
  {
    level: 4,
    name: '元老',
    description: '社区的长期支柱',
    minPosts: 300,
    minLikesReceived: 200,
    minAccountAgeDays: 180,
  },
];

export const MAX_LEVEL: number = LEVELS.reduce((max, definition) => Math.max(max, definition.level), 0);

export interface LevelStats {
  postCount: number;
  likeReceivedCount: number;
  accountAgeDays: number;
}

export function getLevelDefinition(level: number): LevelDefinition | undefined {
  return LEVELS.find((definition) => definition.level === level);
}

function meetsLevel(stats: LevelStats, definition: LevelDefinition): boolean {
  return (
    stats.postCount >= definition.minPosts &&
    stats.likeReceivedCount >= definition.minLikesReceived &&
    stats.accountAgeDays >= definition.minAccountAgeDays
  );
}

/**
 * Pure level calculation. Recompute on the events that change the inputs
 * (post created, reaction added) and nightly as a safety net.
 */
export function computeLevel(stats: LevelStats): number {
  return LEVELS.reduce(
    (reached, definition) => (meetsLevel(stats, definition) ? Math.max(reached, definition.level) : reached),
    0,
  );
}

// ---------------------------------------------------------------------------
// Registration & accounts
// ---------------------------------------------------------------------------

export const REGISTRATION = {
  /** Site-wide default. The runtime value can be overridden in the settings table. */
  openRegistration: true,
  requireEmailVerification: true,
  /** When true, *creating an account* needs an invite code. */
  requireInviteByDefault: false,
  /** Referenced by both the UI hint and the server-side validator. */
  usernamePattern: /^[A-Za-z0-9_-]{3,20}$/,
  usernameHint: '3-20 位字母、数字、下划线或连字符',
  /**
   * Length only — no mandatory symbol classes. Composition rules push people
   * toward `Password1!` while NIST guidance favours length.
   */
  minPasswordLength: 10,
  maxPasswordLength: 200,
  /** Case-insensitive; prevents impersonation of staff and of routes. */
  reservedUsernames: [
    'admin',
    'administrator',
    'root',
    'owner',
    'system',
    'support',
    'moderator',
    'mod',
    'staff',
    'api',
    'login',
    'logout',
    'register',
    'settings',
    'downloads',
    'forum',
    'me',
  ],
} as const;

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export const MODERATION = {
  /**
   * Posts by a member whose post count is below this value go to the review
   * queue. There are no per-board moderators in this deployment, so this is the
   * only thing standing between a fresh account and the front page.
   */
  newMemberReviewPostCount: 3,
  /** How long the author may still edit their own post without a moderator. */
  selfEditWindowMinutes: 60,
  /** Soft-deleted content is purged this many days after deletion. */
  softDeleteRetentionDays: 30,
  /** Active sanctions at or above this count block new registrations from the same IP. */
  maxActiveSanctionsPerIp: 3,
} as const;

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
  /**
   * Which counters are applied. Every listed dimension gets its own budget and
   * all of them must pass, so a single abusive IP cannot exhaust a signed-in
   * user's quota and vice versa.
   */
  dimensions: readonly ('ip' | 'user')[];
  description: string;
}

export const RATE_LIMITS = {
  login: {
    limit: 10,
    windowSeconds: 300,
    dimensions: ['ip'],
    description: '登录尝试，防止撞库',
  },
  register: {
    limit: 5,
    windowSeconds: 3600,
    dimensions: ['ip'],
    description: '注册请求，防止批量注册',
  },
  passwordReset: {
    limit: 3,
    windowSeconds: 3600,
    dimensions: ['ip', 'user'],
    description: '找回密码请求，同时限制邮件轰炸',
  },
  emailVerificationResend: {
    limit: 3,
    windowSeconds: 3600,
    dimensions: ['ip', 'user'],
    description: '重发验证邮件',
  },
  topicCreate: {
    limit: 10,
    windowSeconds: 3600,
    dimensions: ['ip', 'user'],
    description: '发表主题',
  },
  postCreate: {
    limit: 30,
    windowSeconds: 3600,
    dimensions: ['ip', 'user'],
    description: '发表回复',
  },
  report: {
    limit: 10,
    windowSeconds: 3600,
    dimensions: ['ip', 'user'],
    description: '举报提交',
  },
  uploadResource: {
    limit: 20,
    windowSeconds: 86400,
    dimensions: ['user'],
    description: '创建下载资源',
  },
  downloadBurst: {
    limit: 10,
    windowSeconds: 60,
    dimensions: ['ip', 'user'],
    description: '下载请求频率',
  },
  downloadDaily: {
    limit: 50,
    windowSeconds: 86400,
    dimensions: ['user'],
    description: '每日下载额度，按 download_logs 统计而非内存计数',
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export interface UploadRule {
  extensions: readonly string[];
  /** Checked against sniffed magic bytes, not the client-supplied content type. */
  mimeTypes: readonly string[];
  /** Hard ceiling. The env var `MAX_UPLOAD_BYTES` may only lower this. */
  maxBytes: number;
}

const MB = 1024 * 1024;

export const UPLOADS = {
  avatar: {
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: 2 * MB,
  },
  /** Images embedded in posts. SVG is deliberately absent — it can carry script. */
  inlineImage: {
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    maxBytes: 5 * MB,
  },
  /** Post attachments. Stays well under the 100MB Cloudflare request-body limit. */
  attachment: {
    extensions: ['zip', '7z', 'rar', 'pdf', 'txt', 'md', 'json', 'png', 'jpg', 'jpeg', 'webp'],
    mimeTypes: [
      'application/zip',
      'application/x-7z-compressed',
      'application/vnd.rar',
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/json',
      'image/png',
      'image/jpeg',
      'image/webp',
    ],
    maxBytes: 50 * MB,
  },
  /** Files hosted on this server for the download area. Anything larger belongs on an external host. */
  resource: {
    extensions: ['zip', '7z', 'rar', 'tar', 'gz', 'pdf', 'exe', 'msi', 'dmg', 'apk'],
    mimeTypes: [
      'application/zip',
      'application/x-7z-compressed',
      'application/vnd.rar',
      'application/gzip',
      'application/pdf',
      'application/vnd.microsoft.portable-executable',
      'application/x-msdownload',
      'application/x-apple-diskimage',
      'application/vnd.android.package-archive',
    ],
    maxBytes: 50 * MB,
  },
} as const satisfies Record<string, UploadRule>;

export type UploadKind = keyof typeof UPLOADS;

// ---------------------------------------------------------------------------
// Auth / email tokens / invites
// ---------------------------------------------------------------------------

export const AUTH = {
  /** Email verification tokens expire after this long. */
  verificationTokenTtlMinutes: 60,
  /** Password reset tokens are short-lived on purpose. */
  resetTokenTtlMinutes: 30,
  /** 注册码默认最多可被使用的次数（即最多绑定/注册的账号数）。 */
  inviteCodeDefaultMaxUses: 1,
  /** Default invite code lifetime. */
  inviteCodeDefaultTtlDays: 90,
  /** 注销确认邮件里的链接有效期。 */
  deleteAccountTokenTtlMinutes: 60,
  /**
   * 注销冷静期：确认注销后，账户会在「注销确认中」状态停留这么多天；
   * 期间重新登录即可取消注销，到期未登录则转为永久注销。
   */
  accountDeletionGraceDays: 3,
  /** Sessions are rotated on every login (fresh token, old one revoked). */
  sessionRotateOnLogin: true,
  /**
   * After this many login failures the account's password hash check is
   * deliberately made slow — cheap protection against online brute force on
   * single-credential accounts without a per-account lockout.
   */
  slowDownLoginAfterFailures: 5,
} as const;
