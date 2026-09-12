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

function shell(htmlBody: string): string {
  return `<!doctype html><html lang="zh-CN"><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1c1c1e">${htmlBody}</body></html>`;
}

/** Email verification: one-time token, short lifetime. */
export function renderVerifyEmail(token: string): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: `验证你的邮箱 — ${branding.name}`,
    text: `欢迎来到 ${branding.name}！请验证你的邮箱：\n\n${url}\n\n链接 60 分钟内有效。若不是你注册的，请忽略此邮件。`,
    html: shell(
      `<p>欢迎来到 <strong>${escapeHtml(branding.name)}</strong>！</p>
       <p><a href="${escapeHtml(url)}">点此验证你的邮箱</a></p>
       <p style="color:#71717a;font-size:13px">链接 60 分钟内有效。若不是你注册的，请忽略此邮件。</p>`,
    ),
  };
}

/** Password reset: one-time token, short lifetime. */
export function renderPasswordReset(token: string, expiresInMinutes: number): RenderedMail {
  const branding = getSiteBranding();
  const url = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: `重置密码 — ${branding.name}`,
    text: `你申请了重置 ${branding.name} 账号的密码：\n\n${url}\n\n链接 ${expiresInMinutes} 分钟内有效。若你没有申请，请忽略此邮件并考虑修改密码。`,
    html: shell(
      `<p>你申请了重置 <strong>${escapeHtml(branding.name)}</strong> 账号的密码。</p>
       <p><a href="${escapeHtml(url)}">点此设置新密码</a></p>
       <p style="color:#71717a;font-size:13px">链接 ${expiresInMinutes} 分钟内有效。若你没有申请，请忽略此邮件并考虑修改密码。</p>`,
    ),
  };
}