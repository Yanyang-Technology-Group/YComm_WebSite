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
