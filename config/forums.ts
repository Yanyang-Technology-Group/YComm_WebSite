import { accessPolicySchema, type AccessPolicy } from './access-policy';

export interface BoardSeed {
  slug: string;
  name: string;
  description: string;
  /** One level of grouping; `pendingGroup` boards act as a parent only. */
  parentSlug?: string;
  sortOrder: number;
  accessPolicy: AccessPolicy;
}

/**
 * Boards created on first boot (seed). After that, boards live in the database
 * and are managed by admins from the dashboard — this list is only the
 * bootstrap, and deleting an item here never deletes the board.
 */
export const BOARD_SEEDS: readonly BoardSeed[] = [
  {
    slug: 'announcements',
    name: '站务公告',
    description: '官方公告与站点动态',
    sortOrder: 10,
    accessPolicy: accessPolicySchema.parse({ visibility: 'public' }),
  },
  {
    slug: 'general',
    name: '综合讨论',
    description: '不设限的话题都放这里',
    sortOrder: 20,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
  {
    slug: 'tech',
    name: '技术交流',
    description: '开发、运维、折腾心得',
    sortOrder: 30,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
  {
    slug: 'help',
    name: '求助答疑',
    description: '有问题就问，答完记得标记已解决',
    sortOrder: 40,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
  {
    slug: 'meta',
    name: '站务反馈',
    description: '对站点本身的意见与建议',
    sortOrder: 50,
    accessPolicy: accessPolicySchema.parse({ visibility: 'login' }),
  },
] as const;