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
}

export const SITE_DEFAULTS: SiteBranding = {
  name: '晏阳社区',
  tagline: '论坛讨论 · 资源下载',
  description: '晏阳社区 —— 一个自托管的社区平台，包含论坛讨论与资源下载区。',
  icp: '',
  sourceUrl: 'https://github.com/Yanyang-Technology-Group/YComm_WebSite',
} as const;

export function getSiteBranding(env: Env = getEnv()): SiteBranding {
  return {
    name: env.SITE_NAME ?? SITE_DEFAULTS.name,
    tagline: env.SITE_TAGLINE ?? SITE_DEFAULTS.tagline,
    description: env.SITE_DESCRIPTION ?? SITE_DEFAULTS.description,
    icp: env.SITE_ICP ?? SITE_DEFAULTS.icp,
    sourceUrl: env.SITE_SOURCE_URL ?? SITE_DEFAULTS.sourceUrl,
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
  { href: '/console', label: '控制台', requiresAuth: true },
  { href: '/admin', label: '管理', requiresAuth: true },
] as const;

/** 注册/登录时必须勾选同意的法律文书。 */
export const LEGAL_DOCS = [
  { label: '《软件许可及服务协议》', href: 'https://docs.qq.com/pdf/DQXpNU2NUcWxERWxP' },
  { label: '《儿童个人信息保护规则》', href: 'https://docs.qq.com/doc/DQUN1b0tycXRGdXdn' },
] as const;