import type { Db } from '@ycomm/db';
import { createSession, describeDevice, type NewSession } from './sessions';
import { deviceFingerprint, isDeviceTrusted } from './devices';
import { isDeliverableEmail, issueDeviceVerificationToken } from './verification';
import type { UserRecord } from './types';

export interface StartSessionInput {
  ip?: string;
  userAgent?: string;
  ttlDays?: number;
}

/**
 * 完全没有 User-Agent 的登录用这个固定指纹。
 *
 * 不这么做的话，「不带 UA」就等于没有指纹，而没有指纹的会话按已信任处理（那是给
 * 升级前老会话留的兼容口子）—— 拿着别人密码的人只要不发送 UA 就能绕开新设备确认。
 * 给它一个固定值，这类登录照样要过一次邮箱确认。
 */
export const NO_USER_AGENT_HASH = 'no-user-agent';

export interface StartedSession extends NewSession {
  /** 这台设备该账号是否已经确认过。 */
  deviceTrusted: boolean;
  /** 本轮是否给它发了新设备确认邮件。 */
  deviceMailSent: boolean;
}

/**
 * 登录成功后开会话：算设备指纹 → 建带指纹的会话 → 该账号没见过这台设备就发确认信。
 *
 * 密码登录与 GitHub 回调共用这一条路：两条登录方式的规则必须一模一样，
 * 否则换一种登录方式就能绕开「新设备要邮箱确认」。
 *
 * 未验证邮箱的账号这里不发新设备确认信 —— 它先要过邮箱验证（账号状态闸门），
 * 一次登录收两封邮件只会让人更不想验证。
 */
export async function startSession(
  db: Db,
  user: UserRecord,
  input: StartSessionInput = {},
): Promise<StartedSession> {
  const deviceHash = deviceFingerprint(input.userAgent) ?? NO_USER_AGENT_HASH;
  const deviceTrusted = await isDeviceTrusted(db, user.id, deviceHash);

  const session = await createSession(db, {
    userId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    ttlDays: input.ttlDays,
    deviceHash,
  });

  let deviceMailSent = false;
  if (!deviceTrusted && user.state !== 'unverified' && isDeliverableEmail(user.email)) {
    await issueDeviceVerificationToken(db, user, {
      deviceHash,
      deviceLabel: describeDevice(input.userAgent),
      ip: input.ip ?? null,
    });
    deviceMailSent = true;
  }

  return { ...session, deviceTrusted, deviceMailSent };
}
