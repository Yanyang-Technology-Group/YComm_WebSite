import { and, count, desc, eq, ne } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import type { UserRecord } from './types';

/**
 * 关注 / 粉丝（社交向量）。
 *
 * 每个用户的主页都是公开的（/users/<username>）；「关注/粉丝」列表的可见度由
 * 用户自己设置（social_visibility）：
 * - public   公开，所有人都能看列表
 * - mutual   互关可见（只有互相关注的人能看；本人当然能看）
 * - private  仅自己可见
 */

export type SocialVisibility = 'public' | 'mutual' | 'private';

export const SOCIAL_VISIBILITIES: readonly SocialVisibility[] = ['public', 'mutual', 'private'];

export const SOCIAL_VISIBILITY_LABELS: Record<SocialVisibility, string> = {
  public: '公开',
  mutual: '互关可见',
  private: '仅自己可见',
};

export function parseSocialVisibility(value: string | null | undefined): SocialVisibility {
  return value === 'mutual' || value === 'private' ? value : 'public';
}

export function isSocialVisibility(value: string): value is SocialVisibility {
  return value === 'public' || value === 'mutual' || value === 'private';
}

/** follower 是否正在关注 target。 */
export async function isFollowing(db: Db, followerId: string, targetId: string): Promise<boolean> {
  if (followerId === targetId) return false;
  const rows = await db
    .select({ id: schema.follows.id })
    .from(schema.follows)
    .where(
      and(eq(schema.follows.follower_id, followerId), eq(schema.follows.following_id, targetId)),
    )
    .limit(1);
  return rows.length > 0;
}

/** 两人是否互关。 */
async function areMutual(db: Db, aId: string, bId: string): Promise<boolean> {
  if (aId === bId) return true;
  const rows = await db
    .select({ id: schema.follows.id })
    .from(schema.follows)
    .where(
      and(
        eq(schema.follows.follower_id, aId),
        eq(schema.follows.following_id, bId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return false;
  return isFollowing(db, bId, aId);
}

/** target 的关注/粉丝列表对 viewer（可能为 null=游客）是否可见。 */
export async function listsVisibleTo(
  db: Db,
  target: UserRecord,
  viewerId: string | null,
): Promise<boolean> {
  const visibility = parseSocialVisibility(target.social_visibility);
  if (visibility === 'public') return true;
  if (viewerId === null) return false;
  if (viewerId === target.id) return true; // 本人永远可见
  if (visibility === 'private') return false;
  // mutual：需要互关
  return areMutual(db, viewerId, target.id);
}

/** 公开主页视图（不含邮箱等敏感字段）。 */
export interface UserProfileView {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  bio: string;
  homepageMd: string;
  role: 'member' | 'admin' | 'owner';
  level: number;
  state: string;
  createdAt: string;
  postCount: number;
  likeReceivedCount: number;
  followerCount: number;
  followingCount: number;
  /** viewer 是否关注了 target。 */
  viewerFollowsTarget: boolean;
  /** target 是否关注了 viewer。 */
  targetFollowsViewer: boolean;
  /** 关注/粉丝列表对 viewer 是否可见。 */
  listsVisible: boolean;
  socialVisibility: SocialVisibility;
  isSelf: boolean;
}

export async function getPublicProfile(
  db: Db,
  usernameInput: string,
  viewerId: string | null,
): Promise<UserProfileView> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, usernameInput.trim()))
    .limit(1);
  const user = rows[0];
  // 注销账号的主页不公开。
  if (!user || user.state === 'deleted') throw errors.notFound('用户不存在');
  if (user.state === 'banned') throw errors.notFound('用户不存在');

  const [followerCount] = await db
    .select({ n: count() })
    .from(schema.follows)
    .where(eq(schema.follows.following_id, user.id));
  const [followingCount] = await db
    .select({ n: count() })
    .from(schema.follows)
    .where(eq(schema.follows.follower_id, user.id));

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarPath: user.avatar_path,
    bio: user.bio,
    homepageMd: user.homepage_md,
    role: user.role,
    level: user.level,
    state: user.state,
    createdAt: user.created_at.toISOString(),
    postCount: user.post_count,
    likeReceivedCount: user.like_received_count,
    followerCount: followerCount?.n ?? 0,
    followingCount: followingCount?.n ?? 0,
    viewerFollowsTarget: viewerId ? await isFollowing(db, viewerId, user.id) : false,
    targetFollowsViewer: viewerId ? await isFollowing(db, user.id, viewerId) : false,
    listsVisible: await listsVisibleTo(db, user, viewerId),
    socialVisibility: parseSocialVisibility(user.social_visibility),
    isSelf: viewerId === user.id,
  };
}

export interface FollowedUserView {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: 'member' | 'admin' | 'owner';
  level: number;
  bio: string;
  /** 列表里的这位是否正在关注 viewer（方便展示「互关」）。 */
  followsViewer: boolean;
}

/** target 的关注列表（他关注了谁）。调用前先做 listsVisibleTo 校验。 */
export async function listFollowingUsers(db: Db, targetId: string, viewerId: string | null): Promise<FollowedUserView[]> {
  // 关注：rows 的 follower_id = target，输出对侧 following_id 指向的用户。
  return listVia(db, schema.follows.following_id, schema.follows.follower_id, targetId, viewerId);
}

/** target 的粉丝列表（谁关注了他）。调用前先做 listsVisibleTo 校验。 */
export async function listFollowerUsers(db: Db, targetId: string, viewerId: string | null): Promise<FollowedUserView[]> {
  // 粉丝：rows 的 following_id = target，输出对侧 follower_id 指向的用户。
  return listVia(db, schema.follows.follower_id, schema.follows.following_id, targetId, viewerId);
}

async function listVia(
  db: Db,
  selectColumn: PgColumn,
  matchColumn: PgColumn,
  targetId: string,
  viewerId: string | null,
): Promise<FollowedUserView[]> {
  const rows = await db
    .select({ user: schema.users })
    .from(schema.follows)
    .innerJoin(schema.users, eq(selectColumn, schema.users.id))
    .where(
      and(
        eq(matchColumn, targetId),
        ne(schema.users.state, 'deleted'),
        ne(schema.users.state, 'banned'),
      ),
    )
    .orderBy(desc(schema.follows.created_at))
    .limit(100);

  const views: FollowedUserView[] = [];
  for (const row of rows) {
    views.push({
      id: row.user.id,
      username: row.user.username,
      displayName: row.user.display_name,
      avatarPath: row.user.avatar_path,
      role: row.user.role,
      level: row.user.level,
      bio: row.user.bio,
      followsViewer: viewerId ? await isFollowing(db, row.user.id, viewerId) : false,
    });
  }
  return views;
}

/** 关注某人；自己关注自己 / 关注不存在的账号会报错。 */
export async function followUser(db: Db, followerId: string, targetId: string): Promise<void> {
  if (followerId === targetId) throw errors.forbidden('不能关注自己');
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
  if (!target || target.state === 'deleted' || target.state === 'banned') {
    throw errors.notFound('用户不存在');
  }
  await db
    .insert(schema.follows)
    .values({ follower_id: followerId, following_id: targetId })
    .onConflictDoNothing();
}

/** 取消关注；没关注过也是成功（幂等）。 */
export async function unfollowUser(db: Db, followerId: string, targetId: string): Promise<void> {
  await db
    .delete(schema.follows)
    .where(and(eq(schema.follows.follower_id, followerId), eq(schema.follows.following_id, targetId)));
}