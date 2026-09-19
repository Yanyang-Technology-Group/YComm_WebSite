/**
 * Roles, permission points, and the default role → permission matrix.
 *
 * Three distinct concepts live side by side and must not be conflated:
 *
 *   - **Role** (`config/roles.ts`)        — what you are allowed to do, by duty.
 *   - **Level** (`config/policy.ts`)      — whether you clear an activity threshold.
 *   - **State** (per user record)         — whether you may act at all right now.
 *
 * A fourth concept, the **access policy**, is stored per board / per resource and
 * decides who can even see the thing. The runtime order in which all four are
 * evaluated is documented in `docs/ARCHITECTURE.md`.
 *
 * This file is the single source of truth: the runtime permission checks, the
 * admin UI matrix, and the tests all read from here.
 */

/** Roles that can be persisted on a user record. */
export const ASSIGNABLE_ROLES = ['member', 'admin', 'owner'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Roles plus `guest`. `guest` is the *absence* of a session and is never stored. */
export const SUBJECT_ROLES = ['guest', 'member', 'admin', 'owner'] as const;
export type SubjectRole = (typeof SUBJECT_ROLES)[number];

export const ROLE_LABELS: Record<SubjectRole, string> = {
  guest: '访客',
  member: '会员',
  admin: '管理员',
  owner: '站长',
};

export const ROLE_DESCRIPTIONS: Record<SubjectRole, string> = {
  guest: '未登录访问者，只能浏览公开内容',
  member: '注册并通过邮箱验证的用户，可发帖、下载资源',
  admin: '内容管理者，可管理论坛内容与下载资源（上传的资源需站长审核）',
  owner: '站点拥有者，唯一，负责资源审核、角色授予与系统维护',
};

/** Higher rank outranks lower rank. Used to keep admins from acting on the owner. */
export const ROLE_RANK: Record<SubjectRole, number> = {
  guest: 0,
  member: 10,
  admin: 20,
  owner: 30,
};

/**
 * Every permission point in the system, as `resource.action`.
 * Adding one here is the only way to create a new permission.
 */
export const PERMISSION = {
  FORUM_BOARD_VIEW: 'forum.board.view',
  FORUM_TOPIC_CREATE: 'forum.topic.create',
  FORUM_POST_CREATE: 'forum.post.create',
  FORUM_POST_EDIT_OWN: 'forum.post.edit.own',
  FORUM_POST_DELETE_OWN: 'forum.post.delete.own',
  FORUM_POST_DELETE_ANY: 'forum.post.delete.any',
  FORUM_TOPIC_PIN: 'forum.topic.pin',
  FORUM_TOPIC_LOCK: 'forum.topic.lock',
  FORUM_TOPIC_MOVE: 'forum.topic.move',
  FORUM_BOARD_MANAGE: 'forum.board.manage',
  FORUM_CONTENT_AUDIT: 'forum.content.audit',

  DOWNLOAD_RESOURCE_VIEW: 'download.resource.view',
  DOWNLOAD_FILE_FETCH: 'download.file.fetch',
  DOWNLOAD_RESOURCE_CREATE: 'download.resource.create',
  DOWNLOAD_RESOURCE_EDIT_OWN: 'download.resource.edit.own',
  DOWNLOAD_RESOURCE_AUDIT: 'download.resource.audit',
  DOWNLOAD_RESOURCE_DELETE_ANY: 'download.resource.delete.any',
  DOWNLOAD_LINK_REPORT: 'download.link.report',
  DOWNLOAD_CATEGORY_MANAGE: 'download.category.manage',

  USER_PROFILE_EDIT_OWN: 'user.profile.edit.own',
  USER_WARN: 'user.warn',
  USER_MUTE: 'user.mute',
  USER_BAN: 'user.ban',
  USER_ROLE_ASSIGN: 'user.role.assign',
  REPORT_HANDLE: 'report.handle',
  INVITE_CREATE: 'invite.create',
  INVITE_POLICY_MANAGE: 'invite.policy.manage',

  ADMIN_DASHBOARD_ACCESS: 'admin.dashboard.access',
  SYSTEM_AUDITLOG_VIEW: 'system.auditlog.view',
  SITE_CONFIG_EDIT: 'site.config.edit',
  MAIL_BROADCAST: 'mail.broadcast',
  SYSTEM_MAINTENANCE: 'system.maintenance',
  SYSTEM_OWNER_TRANSFER: 'system.owner.transfer',
  /** 开放 API 密钥管理（仅站长）。 */
  API_KEY_MANAGE: 'api.key.manage',
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSION);

export type PermissionGroup = 'forum' | 'download' | 'user' | 'system';

export interface PermissionDefinition {
  id: Permission;
  group: PermissionGroup;
  label: string;
  description: string;
  /**
   * Marks a capability that is inherently dangerous or that guards the ownership
   * model itself. The admin UI renders these as locked rows and the runtime
   * refuses to delegate them, even if a stale database row claims otherwise.
   */
  ownerOnly?: boolean;
}

/** Labels and grouping for the admin permission matrix. */
export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  // ---- forum ----------------------------------------------------------
  {
    id: PERMISSION.FORUM_BOARD_VIEW,
    group: 'forum',
    label: '浏览版块',
    description: '查看版块列表与主题内容，仍受版块访问策略约束',
  },
  {
    id: PERMISSION.FORUM_TOPIC_CREATE,
    group: 'forum',
    label: '发表主题',
    description: '在版块中创建新主题',
  },
  {
    id: PERMISSION.FORUM_POST_CREATE,
    group: 'forum',
    label: '回复主题',
    description: '在已有主题中发表回复',
  },
  {
    id: PERMISSION.FORUM_POST_EDIT_OWN,
    group: 'forum',
    label: '编辑自己的内容',
    description: '在时限内编辑自己发表的主题与回复，并留下修订记录',
  },
  {
    id: PERMISSION.FORUM_POST_DELETE_OWN,
    group: 'forum',
    label: '删除自己的内容',
    description: '软删除自己发表的主题与回复',
  },
  {
    id: PERMISSION.FORUM_POST_DELETE_ANY,
    group: 'forum',
    label: '删除任何内容',
    description: '软删除任意用户的主题与回复，并记录操作人',
  },
  {
    id: PERMISSION.FORUM_TOPIC_PIN,
    group: 'forum',
    label: '置顶主题',
    description: '将主题置顶或取消置顶',
  },
  {
    id: PERMISSION.FORUM_TOPIC_LOCK,
    group: 'forum',
    label: '锁定主题',
    description: '锁定主题以停止新回复',
  },
  {
    id: PERMISSION.FORUM_TOPIC_MOVE,
    group: 'forum',
    label: '移动主题',
    description: '将主题移动到其他版块',
  },
  {
    id: PERMISSION.FORUM_BOARD_MANAGE,
    group: 'forum',
    label: '管理版块',
    description: '创建、编辑、排序、归档版块及其访问策略',
  },
  {
    id: PERMISSION.FORUM_CONTENT_AUDIT,
    group: 'forum',
    label: '审核论坛内容',
    description: '处理待审核的主题与回复（新成员前几帖会进入该队列）',
  },

  // ---- downloads ------------------------------------------------------
  {
    id: PERMISSION.DOWNLOAD_RESOURCE_VIEW,
    group: 'download',
    label: '浏览下载资源',
    description: '查看资源列表与详情，仍受资源访问策略约束',
  },
  {
    id: PERMISSION.DOWNLOAD_FILE_FETCH,
    group: 'download',
    label: '获取下载链接',
    description: '通过门禁校验后跳转到外链或取得文件，外链不会出现在页面源码中',
  },
  {
    id: PERMISSION.DOWNLOAD_RESOURCE_CREATE,
    group: 'download',
    label: '上传资源',
    description: '创建下载资源；管理员提交的版本需站长审核后才能发布',
  },
  {
    id: PERMISSION.DOWNLOAD_RESOURCE_EDIT_OWN,
    group: 'download',
    label: '编辑自己上传的资源',
    description: '修改自己上传资源的标题、说明与版本；改动文件或外链会重新触发审核',
  },
  {
    id: PERMISSION.DOWNLOAD_RESOURCE_AUDIT,
    group: 'download',
    label: '审核下载资源',
    description: '批准或驳回待审核的资源。只有站长可以审核，避免管理员自我批准',
    ownerOnly: true,
  },
  {
    id: PERMISSION.DOWNLOAD_RESOURCE_DELETE_ANY,
    group: 'download',
    label: '删除任何资源',
    description: '归档或删除任意资源',
  },
  {
    id: PERMISSION.DOWNLOAD_LINK_REPORT,
    group: 'download',
    label: '举报失效链接',
    description: '提交失效链接举报，达到阈值后自动标记待修复',
  },
  {
    id: PERMISSION.DOWNLOAD_CATEGORY_MANAGE,
    group: 'download',
    label: '管理下载分类',
    description: '创建、编辑、排序下载分类及其访问策略',
  },

  // ---- users & governance ---------------------------------------------
  {
    id: PERMISSION.USER_PROFILE_EDIT_OWN,
    group: 'user',
    label: '编辑个人资料',
    description: '修改自己的昵称、头像、签名等资料',
  },
  {
    id: PERMISSION.USER_WARN,
    group: 'user',
    label: '警告用户',
    description: '向用户发出警告并记录在案',
  },
  {
    id: PERMISSION.USER_MUTE,
    group: 'user',
    label: '禁言用户',
    description: '禁止用户发表内容，可设置时长或永久',
  },
  {
    id: PERMISSION.USER_BAN,
    group: 'user',
    label: '封禁用户',
    description: '封禁账号，所有需要登录的操作一律拒绝',
  },
  {
    id: PERMISSION.USER_ROLE_ASSIGN,
    group: 'user',
    label: '授予角色',
    description: '授予或撤销管理员。只有站长持有该权限，防止管理员自行提权',
    ownerOnly: true,
  },
  {
    id: PERMISSION.REPORT_HANDLE,
    group: 'user',
    label: '处理举报',
    description: '处理用户提交的内容与链接举报',
  },
  {
    id: PERMISSION.INVITE_CREATE,
    group: 'user',
    label: '生成邀请码',
    description: '生成邀请码，用于注册或解锁受限版块与资源',
  },
  {
    id: PERMISSION.INVITE_POLICY_MANAGE,
    group: 'user',
    label: '管理邀请码策略',
    description: '设置全站是否必须凭邀请码注册，属于站务级配置',
    ownerOnly: true,
  },

  // ---- system ---------------------------------------------------------
  {
    id: PERMISSION.ADMIN_DASHBOARD_ACCESS,
    group: 'system',
    label: '访问管理后台',
    description: '进入管理后台的入口权限',
  },
  {
    id: PERMISSION.SYSTEM_AUDITLOG_VIEW,
    group: 'system',
    label: '查看审计日志',
    description: '查看管理操作、登录失败与审核记录',
  },
  {
    id: PERMISSION.SITE_CONFIG_EDIT,
    group: 'system',
    label: '编辑站点设置',
    description: '修改站点名称、公告、注册开关等运行时设置',
  },
  {
    id: PERMISSION.MAIL_BROADCAST,
    group: 'system',
    label: '全站群发邮件',
    description: '向全部或部分用户群发邮件，极易被滥用，仅限站长',
    ownerOnly: true,
  },
  {
    id: PERMISSION.SYSTEM_MAINTENANCE,
    group: 'system',
    label: '系统维护',
    description: '触发备份、重跑任务、清理缓存等运维操作',
    ownerOnly: true,
  },
  {
    id: PERMISSION.SYSTEM_OWNER_TRANSFER,
    group: 'system',
    label: '转移站长身份',
    description: '将站长身份移交他人。不可逆，仅站长本人可执行',
    ownerOnly: true,
  },
  {
    id: PERMISSION.API_KEY_MANAGE,
    group: 'system',
    label: '管理 API 密钥',
    description: '创建/撤销开放接口密钥（Bearer）。密钥身份等同站长，仅限站长本人',
    ownerOnly: true,
  },
];

/**
 * Guests are not a role, but they still need a permission set for the matrix to
 * be total. They can only look at boards whose policy allows anonymous reading.
 */
export const GUEST_PERMISSIONS: readonly Permission[] = [PERMISSION.FORUM_BOARD_VIEW];

const MEMBER_PERMISSIONS: readonly Permission[] = [
  ...GUEST_PERMISSIONS,
  PERMISSION.FORUM_TOPIC_CREATE,
  PERMISSION.FORUM_POST_CREATE,
  PERMISSION.FORUM_POST_EDIT_OWN,
  PERMISSION.FORUM_POST_DELETE_OWN,
  PERMISSION.DOWNLOAD_RESOURCE_VIEW,
  PERMISSION.DOWNLOAD_FILE_FETCH,
  PERMISSION.DOWNLOAD_LINK_REPORT,
  PERMISSION.USER_PROFILE_EDIT_OWN,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MEMBER_PERMISSIONS,
  PERMISSION.FORUM_POST_DELETE_ANY,
  PERMISSION.FORUM_TOPIC_PIN,
  PERMISSION.FORUM_TOPIC_LOCK,
  PERMISSION.FORUM_TOPIC_MOVE,
  PERMISSION.FORUM_BOARD_MANAGE,
  PERMISSION.FORUM_CONTENT_AUDIT,
  PERMISSION.DOWNLOAD_RESOURCE_CREATE,
  PERMISSION.DOWNLOAD_RESOURCE_EDIT_OWN,
  PERMISSION.DOWNLOAD_RESOURCE_DELETE_ANY,
  PERMISSION.DOWNLOAD_CATEGORY_MANAGE,
  PERMISSION.USER_WARN,
  PERMISSION.USER_MUTE,
  PERMISSION.USER_BAN,
  PERMISSION.REPORT_HANDLE,
  PERMISSION.INVITE_CREATE,
  PERMISSION.ADMIN_DASHBOARD_ACCESS,
  PERMISSION.SYSTEM_AUDITLOG_VIEW,
  PERMISSION.SITE_CONFIG_EDIT,
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  PERMISSION.DOWNLOAD_RESOURCE_AUDIT,
  PERMISSION.USER_ROLE_ASSIGN,
  PERMISSION.INVITE_POLICY_MANAGE,
  PERMISSION.MAIL_BROADCAST,
  PERMISSION.SYSTEM_MAINTENANCE,
  PERMISSION.SYSTEM_OWNER_TRANSFER,
  PERMISSION.API_KEY_MANAGE,
];

/** Default matrix. A database row may override it, but never beyond `ALL_PERMISSIONS`. */
export const ROLE_PERMISSIONS: Record<SubjectRole, readonly Permission[]> = {
  guest: GUEST_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  owner: OWNER_PERMISSIONS,
};

export function permissionsForRole(role: SubjectRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: SubjectRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Permission points that must never be delegated outside the owner role. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = PERMISSION_DEFINITIONS.filter(
  (definition) => definition.ownerOnly === true,
).map((definition) => definition.id);

/**
 * Whether `actor` may grant `targetRole` to somebody else.
 *
 * Two deliberate anti-escalation rules:
 *   1. Admins cannot grant roles at all — otherwise one compromised admin
 *      account can mint more admins and the role model collapses from inside.
 *   2. Nobody can grant `owner` through this path; ownership moves only through
 *      the explicit, audited transfer flow held by the current owner.
 */
export function canAssignRole(actor: SubjectRole, targetRole: AssignableRole): boolean {
  if (actor !== 'owner') return false;
  return targetRole !== 'owner';
}

/**
 * Whether `actor` may moderate, edit or delete `target`'s account.
 *
 * Strictly greater rank, so an admin can never touch another admin's account and
 * the owner is untouchable by everyone but themselves.
 */
export function canActOnUser(actor: SubjectRole, target: SubjectRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
