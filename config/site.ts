import { getEnv, type Env } from '@ycomm/kernel';

/**
 * Site branding. Defaults live here; a self-hosted operator overrides them with
 * environment variables (`SITE_NAME`, `SITE_TAGLINE`, `SITE_DESCRIPTION`,
 * `SITE_ICP`, `SITE_SOURCE_URL`) so a fork is not required to rebrand.
 */
export interface SiteBranding {
  name: string;
  tagline: string;
  description: string;
  /** ICP filing number, rendered in the footer when present. */
  icp: string;
  /**
   * Repository URL for the exact running version — AGPL §13 requires network
   * users be able to obtain the corresponding source, so this is mandatory in
   * production and the footer links to it.
   */
  sourceUrl: string;
  /** 镜像仓库（海外访问不便时用），页脚展示。 */
  mirrorUrl: string;
}

export const SITE_DEFAULTS: SiteBranding = {
  name: '晏阳社区',
  tagline: '论坛讨论 · 资源下载',
  description: '晏阳社区 —— 一个自托管的社区平台，包含论坛讨论与资源下载区。',
  icp: '',
  sourceUrl: 'https://github.com/Yanyang-Technology-Group/YComm_WebSite',
  mirrorUrl: 'https://gitee.com/Yanyang-Technology-Group/YComm_WebSite',
} as const;

export function getSiteBranding(env: Env = getEnv()): SiteBranding {
  return {
    name: env.SITE_NAME ?? SITE_DEFAULTS.name,
    tagline: env.SITE_TAGLINE ?? SITE_DEFAULTS.tagline,
    description: env.SITE_DESCRIPTION ?? SITE_DEFAULTS.description,
    icp: env.SITE_ICP ?? SITE_DEFAULTS.icp,
    sourceUrl: env.SITE_SOURCE_URL ?? SITE_DEFAULTS.sourceUrl,
    mirrorUrl: env.SITE_MIRROR_URL ?? SITE_DEFAULTS.mirrorUrl,
  };
}

export interface NavItem {
  href: string;
  label: string;
  /** When true the item is only rendered for signed-in users. */
  requiresAuth?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: '首页' },
  { href: '/forum', label: '论坛' },
  { href: '/downloads', label: '下载区' },
] as const;

/**
 * 协议版本号。任何一次协议实质变更都要改这里：
 * 同意留证（users.terms_version）与页脚的「协议版本」都读它，改动后
 * 用户下一次登录勾选同意即视为同意新版本（对应协议 15.1 条）。
 */
export const LEGAL_VERSION = '2026.10';

export interface LegalDoc {
  /** 站内页面路径。 */
  href: string;
  label: string;
  /** 腾讯文档上的同一份正文（对外分享/存档用），页脚会一并展示。 */
  mirror: string;
}

/**
 * 注册/登录时必须勾选同意的法律文书。
 *
 * 正文现在也在站内（`/legal/*`）——外链文档只作为镜像，避免出现「勾了同意却
 * 点不开正文」的情况（原来的实现只链腾讯文档，站内没有任何协议页面）。
 */
export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    href: '/legal/terms',
    label: '《软件许可及服务协议》',
    mirror: 'https://docs.qq.com/pdf/DQXpNU2NUcWxERWxP',
  },
  {
    href: '/legal/privacy',
    label: '《晏阳隐私政策》',
    mirror: '',
  },
  {
    href: '/legal/children',
    label: '《儿童个人信息保护规则》',
    mirror: 'https://docs.qq.com/doc/DQUN1b0tycXRGdXdn',
  },
] as const;

/** 运营方对外联系方式（协议/隐私政策/举报/申诉都用这一份）。 */
export const CONTACT = {
  /** 隐私与儿童个人信息保护负责人邮箱。 */
  email: 'feedback@yanyn.cn',
  /** 客服 QQ（协议正文里列出的三个号）。 */
  qq: ['2781809404', '160613646', '1476564426'],
  /** 处理时限（工作日），与儿童规则第七条一致。 */
  responseWorkdays: 15,
} as const;

/**
 * 全站公告（页首横幅）。留空则不显示。
 *
 * 协议变更、服务终止（协议 15.8 要求提前一个月通知）都通过这里发布 ——
 * 改完重新部署即生效，不需要改代码。
 */
export const SITE_NOTICE = {
  text: '',
  /** 可选：公告里的链接（例如 /legal/terms）。 */
  href: '',
} as const;
