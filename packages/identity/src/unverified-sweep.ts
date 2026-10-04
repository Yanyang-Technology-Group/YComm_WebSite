import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { isDeliverableEmail, sendVerificationReminder } from './verification';
import { purgeUnverifiedAccount } from './account-deletion';
import type { UserRecord } from './types';

/**
 * 未验证邮箱账号的定期清理。
 *
 * 规则（站长定）：
 * - 绑定邮箱注册的账号必须验证邮箱才能用；
 * - 注册后每 6 小时补发一封提醒邮件，邮件里写明「还剩多久会被自动注销」；
 * - 注册满 3 天仍未验证 → 自动注销（用户名/邮箱让位，会话与第三方绑定一起释放）。
 *
 * 两种情况都不用处理：GitHub 等 OAuth 注册出来的账号直接是 `active`；
 * 中途验证过的账号状态会变成 `active`，自动从名单里消失。
 */

export interface UnverifiedSweepOptions {
  /** 便于测试注入时间。 */
  now?: Date;
  /** 宽限期天数，默认取配置（3 天）。 */
  graceDays?: number;
  /** 提醒间隔小时数，默认取配置（6 小时）。 */
  reminderHours?: number;
}

export interface UnverifiedSweepResult {
  /** 名单里有多少个未验证账号。 */
  scanned: number;
  /** 本轮发出提醒邮件的数量。 */
  reminded: number;
  /** 本轮自动注销的数量。 */
  purged: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** 提醒邮件也算「验证邮件」：注册那封 + 后续提醒共用同一套节流判断。 */
const VERIFICATION_MAIL_TEMPLATES = ['verify_email', 'verify_email_reminder'];

/**
 * 上一封验证邮件是什么时候发的。
 *
 * 直接看 `email_logs`（投递记录表）而不是新增一列「上次提醒时间」：
 * 这样「发信失败」也照样算一次尝试，不会因为发信通道抖动而在每轮扫描里重复轰炸。
 */
async function lastVerificationMailAt(db: Db, email: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: schema.emailLogs.created_at })
    .from(schema.emailLogs)
    .where(
      and(
        eq(sql`lower(${schema.emailLogs.to_email})`, email.trim().toLowerCase()),
        inArray(schema.emailLogs.template, VERIFICATION_MAIL_TEMPLATES),
      ),
    )
    .orderBy(sql`${schema.emailLogs.created_at} desc`)
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

/** 还剩多少小时会被自动注销（向上取整，至少 1）。 */
export function hoursUntilPurge(
  user: Pick<UserRecord, 'created_at'>,
  now: Date,
  graceDays: number,
): number {
  const deadline = user.created_at.getTime() + graceDays * 24 * HOUR_MS;
  return Math.max(1, Math.ceil((deadline - now.getTime()) / HOUR_MS));
}

/**
 * 跑一轮清理。可以安全地重复调用（幂等）：到期的删掉，没到期的按 6 小时节流提醒。
 */
export async function sweepUnverifiedAccounts(
  db: Db,
  options: UnverifiedSweepOptions = {},
): Promise<UnverifiedSweepResult> {
  const now = options.now ?? new Date();
  const graceDays = options.graceDays ?? AUTH.verificationGraceDays;
  const reminderHours = options.reminderHours ?? AUTH.verificationReminderHours;

  const pending = await db.select().from(schema.users).where(eq(schema.users.state, 'unverified'));

  let reminded = 0;
  let purged = 0;

  for (const user of pending) {
    const ageMs = now.getTime() - user.created_at.getTime();
    if (ageMs >= graceDays * 24 * HOUR_MS) {
      if (await purgeUnverifiedAccount(db, user.id)) purged += 1;
      continue;
    }

    // 占位邮箱（OAuth 没给邮箱）发不出去，不给它无限重试。
    if (!isDeliverableEmail(user.email)) continue;

    const lastMail = await lastVerificationMailAt(db, user.email);
    if (lastMail && now.getTime() - lastMail.getTime() < reminderHours * HOUR_MS) continue;

    await sendVerificationReminder(db, user, hoursUntilPurge(user, now, graceDays));
    reminded += 1;
  }

  return { scanned: pending.length, reminded, purged };
}
