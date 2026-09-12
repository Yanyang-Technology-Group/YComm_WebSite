import { accessPolicySchema, type AccessPolicy } from './access-policy';

export interface DownloadCategorySeed {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  accessPolicy: AccessPolicy;
}

/** Bootstrap categories, created on first boot. Admirers manage them later. */
export const DOWNLOAD_CATEGORY_SEEDS: readonly DownloadCategorySeed[] = [
  {
    slug: 'software',
    name: '软件工具',
    description: '桌面软件、命令行工具、脚本',
    sortOrder: 10,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
  {
    slug: 'documents',
    name: '文档资料',
    description: '手册、教程、白皮书',
    sortOrder: 20,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
  {
    slug: 'media',
    name: '素材资源',
    description: '图标、模板、示例项目',
    sortOrder: 30,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
  {
    slug: 'other',
    name: '其他资源',
    description: '不好分类的都在这',
    sortOrder: 40,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
] as const;

/**
 * Hosts allowed as external resource links.
 *
 * The download area is a natural spam/phishing vector, so link targets are
 * allow-listed. Matching is by exact host or any subdomain (`lanzou*.com`
 * style hosts are listed individually).
 */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  'pan.baidu.com',
  'www.aliyundrive.com',
  'alipan.com',
  'caiyun.139.com',
  'cloud.189.cn',
  'www.123pan.com',
  'lanzou.app',
  'lanzoui.com',
  'lanzoux.com',
  'drive.google.com',
  'mega.nz',
  'github.com',
  'objects.githubusercontent.com',
  'onedrive.live.com',
  '1drv.ms',
  'd.serctl.com',
] as const;

/**
 * True when `host` matches the allowlist exactly or by subdomain.
 * An empty allowlist denies everything — it is a security list, not a suggestion.
 */
export function isExternalHostAllowed(host: string): boolean {
  const normalized = host.toLowerCase();
  return EXTERNAL_HOST_ALLOWLIST.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}

export const DOWNLOAD_AREA = {
  /** Lifetime of the short-lived signed URLs handed out after the gate passes. */
  signedJumpUrlTtlSeconds: 300,
  /** A link is auto-flagged for review after this many dead-link reports. */
  linkReportThreshold: 3,
  /** Upper bound of links (primary + mirrors) per resource. */
  maxLinksPerResource: 6,
  /** Title bounds. */
  minTitleLength: 2,
  maxTitleLength: 80,
  /** Markdown description length cap. */
  maxDescriptionLength: 20_000,
} as const;