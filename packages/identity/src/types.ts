import { schema } from '@ycomm/db';

/** Full row shape of the users table. */
export type UserRecord = typeof schema.users.$inferSelect;

export type SessionRecord = typeof schema.sessions.$inferSelect;

/** Safe-to-serialize view of a user — this is what leaves the API. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: 'member' | 'admin' | 'owner';
  level: number;
  state: string;
  avatarPath: string | null;
  bio: string;
  /** 是否设置了密码；GitHub 等第三方登录创建的账号为 false。 */
  hasPassword: boolean;
  createdAt: Date;
}

/** Session found with its user, after validity checks. */
export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
}