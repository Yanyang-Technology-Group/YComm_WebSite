import { getSiteBranding } from '@ycomm/config';
import { siteUrl } from '@ycomm/kernel';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Azure accent used across all mail: matches the 晏阳蓝 theme (#5da4fa). */
const ACCENT = '#5da4fa';
const ACCENT_DARK = '#3b82d6';

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
    <tr>
      <td align="center" style="border-radius:12px;background:${ACCENT};">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;background:${ACCENT};border:1px solid ${ACCENT_DARK};">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** Centered azure-blue card that wraps every transactional mail. */
function shell(parts: { title: string; body: string; note: string }): string {
  const branding = getSiteBranding();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f4f7fb;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;box-shadow:0 8px 24px rgba(93,164,250,0.14);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
          <tr>
            <td style="background:linear-gradient(135deg,${ACCENT} 0%,${ACCENT_DARK} 100%);padding:20px 28px;">
              <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(branding.name)}</span>
              <span style="color:#eaf2ff;font-size:13px;margin-left:10px;">${escapeHtml(branding.tagline)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 8px;">
              <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#1c2733;">${escapeHtml(parts.title)}</h1>
              <div style="font-size:15px;line-height:1.7;color:#3c4754;">
                ${parts.body}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;border-top:1px solid #eef2f7;margin-top:16px;">
              <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#8a94a1;">${escapeHtml(parts.note)}</p>
              <p style="margin:20px 0 0;font-size:12px;color:#b3bcc6;">— ${escapeHtml(branding.name)} 自动发送，请勿直接回复</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Email verification: one-time token, short lifetime. */
export function renderVerifyEmail(token: string): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: `验证你的邮箱 — ${branding.name}`,
    text: `欢迎来到 ${branding.name}！请验证你的邮箱：\n\n${url}\n\n链接 60 分钟内有效。若不是你注册的，请忽略此邮件。`,
    html: shell({
      title: '验证你的邮箱',
      body: `<p style="margin:0 0 6px;">欢迎来到 <strong>${escapeHtml(branding.name)}</strong>！</p>
        <p style="margin:0;">点击下方按钮完成邮箱验证：</p>
        ${button(url, '验证邮箱')}`,
      note: '链接 60 分钟内有效。若不是你注册的，请忽略此邮件。',
    }),
  };
}

/** Password reset: one-time token, short lifetime. */
export function renderPasswordReset(token: string, expiresInMinutes: number): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: `重置密码 — ${branding.name}`,
    text: `你申请了重置 ${branding.name} 账号的密码：\n\n${url}\n\n链接 ${expiresInMinutes} 分钟内有效。若你没有申请，请忽略此邮件并考虑修改密码。`,
    html: shell({
      title: '重置密码',
      body: `<p style="margin:0 0 6px;">你申请了重置 <strong>${escapeHtml(branding.name)}</strong> 账号的密码。</p>
        <p style="margin:0;">点击下方按钮设置新密码：</p>
        ${button(url, '设置新密码')}`,
      note: `链接 ${expiresInMinutes} 分钟内有效。若你没有申请，请忽略此邮件并考虑修改密码。`,
    }),
  };
}

/** 账号注销确认：一次性 token，确认后进入 N 天冷静期（期内登录可取消）。 */
export function renderAccountDeletion(token: string, graceDays: number, tokenTtlMinutes: number): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/delete-account?token=${encodeURIComponent(token)}`;
  return {
    subject: `确认注销账号 — ${branding.name}`,
    text: `你申请了注销 ${branding.name} 账号：\n\n${url}\n\n链接 ${tokenTtlMinutes} 分钟内有效。确认注销后会有 ${graceDays} 天冷静期，期间重新登录即可取消。若你没有申请，请忽略此邮件。`,
    html: shell({
      title: '确认注销账号',
      body: `<p style="margin:0 0 6px;">你申请了注销 <strong>${escapeHtml(branding.name)}</strong> 账号。</p>
        <p style="margin:0;">确认后将进入 ${graceDays} 天冷静期：期间重新登录即可取消注销；到期未登录则账号永久注销。</p>
        ${button(url, '确认注销')}`,
      note: `链接 ${tokenTtlMinutes} 分钟内有效。若你没有申请，请忽略此邮件。`,
    }),
  };
}

/** 把剩余小时数说成人话：「2 天 5 小时」「5 小时」。 */
export function describeRemainingTime(hours: number): string {
  if (hours <= 0) return '已经到期';
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    return rest === 0 ? `${days} 天` : `${days} 天 ${rest} 小时`;
  }
  return `${hours} 小时`;
}

/**
 * 未验证邮箱的提醒邮件：注册那封之后每 N 小时补发一次，直到验证完成或账号被自动注销。
 *
 * 必须把「还剩多久会被注销」写清楚 —— 这是这套自动清理机制唯一的告知渠道。
 */
export function renderVerifyEmailReminder(
  token: string,
  options: { hoursLeft: number; graceDays: number; reminderHours: number; tokenTtlMinutes: number },
): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const remaining = describeRemainingTime(options.hoursLeft);
  const warning = `${remaining}后还未验证邮箱将自动注销你的账号`;
  return {
    subject: `请验证邮箱：${remaining}后账号将被自动注销 — ${branding.name}`,
    text: `你在 ${branding.name} 的账号还没有验证邮箱。\n\n${warning}（注册满 ${options.graceDays} 天）。在自动注销之前完成验证即可正常使用；未验证期间账号无法访问社区。验证完成后用户名和邮箱仍然属于你。\n\n验证链接：\n${url}\n\n链接 ${options.tokenTtlMinutes} 分钟内有效。我们每 ${options.reminderHours} 小时提醒一次，直到你完成验证。`,
    html: shell({
      title: '请验证你的邮箱',
      body: `<p style="margin:0 0 6px;">你在 <strong>${escapeHtml(branding.name)}</strong> 的账号还没有验证邮箱。</p>
        <p style="margin:0 0 6px;color:#c0392b;font-weight:600;">${escapeHtml(warning)}（注册满 ${options.graceDays} 天）。</p>
        <p style="margin:0;">完成验证前账号无法访问社区；验证之后一切照常，用户名和邮箱仍然属于你。</p>
        ${button(url, '验证邮箱')}`,
      note: `链接 ${options.tokenTtlMinutes} 分钟内有效。我们每 ${options.reminderHours} 小时提醒一次，直到你完成验证。`,
    }),
  };
}

/**
 * 新设备登录确认：这台设备该账号从没见过，点了链接才算「本人」。
 *
 * 邮件里给出设备、时间和来源 IP，让本人一眼能判断是不是自己 —— 也方便发现盗号。
 */
export function renderDeviceVerification(
  token: string,
  options: { deviceLabel: string; ip: string | null; at: Date; tokenTtlMinutes: number },
): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/verify-device?token=${encodeURIComponent(token)}`;
  const when = options.at.toISOString().replace('T', ' ').slice(0, 16);
  const from = options.ip ?? '未知地址';
  const detail = `设备：${options.deviceLabel}；时间：${when} UTC；来源 IP：${from}`;
  return {
    subject: `新设备登录确认 — ${branding.name}`,
    text: `你的 ${branding.name} 账号刚刚在一台新设备上登录：\n\n${detail}\n\n如果是你本人，请点下面的链接确认这台设备；确认之前这台设备不能访问社区。\n\n${url}\n\n链接 ${options.tokenTtlMinutes} 分钟内有效。如果不是你本人，请立即修改密码。`,
    html: shell({
      title: '确认这台新设备',
      body: `<p style="margin:0 0 6px;">你的 <strong>${escapeHtml(branding.name)}</strong> 账号刚刚在一台新设备上登录：</p>
        <p style="margin:0 0 6px;color:#3c4754;">设备：<strong>${escapeHtml(options.deviceLabel)}</strong><br>时间：${escapeHtml(when)} UTC<br>来源 IP：${escapeHtml(from)}</p>
        <p style="margin:0;">如果是你本人，点下面按钮确认这台设备；确认之前它不能访问社区。</p>
        ${button(url, '确认这台设备')}`,
      note: `链接 ${options.tokenTtlMinutes} 分钟内有效。如果不是你本人，请立即修改密码。`,
    }),
  };
}
