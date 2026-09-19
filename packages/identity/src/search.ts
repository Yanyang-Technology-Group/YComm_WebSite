import { and, eq, ilike, ne, or } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';

/** 用户搜索结果（导航栏全站搜索用）。 */
export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: 'member' | 'admin' | 'owner';
  level: number;
  bio: string;
}

/** 按用户名/昵称模糊搜（排除注销、封禁，以及关掉「允许被搜到」的账号）。 */
export async function searchUsers(db: Db, query: string, limit = 8): Promise<UserSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const likeQuery = `%${q}%`;
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        ne(schema.users.state, 'deleted'),
        ne(schema.users.state, 'banned'),
        // 隐私设置：关掉「允许被别人搜到」的账号不出现在任何搜索结果里。
        eq(schema.users.searchable, true),
        or(ilike(schema.users.username, likeQuery), ilike(schema.users.display_name, likeQuery)),
      ),
    )
    .limit(Math.min(limit, 100));
  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarPath: user.avatar_path,
    role: user.role,
    level: user.level,
    bio: user.bio,
  }));
}