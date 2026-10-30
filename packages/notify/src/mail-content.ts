import sanitizeHtml from 'sanitize-html';
import type { MailBackground } from '@ycomm/config';
import type { RenderedMail } from './templates';

/** A bounded email HTML vocabulary: formatting survives, executable content does not. */
export function sanitizeMailBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'span', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a', 'img',
      'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font'],
    allowedAttributes: { '*': ['style'], a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], font: ['color', 'size', 'face'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowedSchemesByTag: { img: ['https', 'http'] },
    allowProtocolRelative: false,
    allowedStyles: { '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i, /^[a-z]+$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i],
      'font-size': [/^(?:[8-9]|[1-6]\d|7[0-2])px$/, /^(?:[6-9]|[1-4]\d|5[0-4])pt$/],
      'font-weight': [/^(?:normal|bold|[1-9]00)$/], 'font-style': [/^(?:normal|italic)$/],
      'text-decoration': [/^(?:none|underline|line-through|underline line-through)$/],
      'text-align': [/^(?:left|center|right|justify)$/], 'line-height': [/^(?:1(?:\.\d+)?|2)(?:em)?$/],
      'max-width': [/^100%$/], height: [/^auto$/],
    } },
    transformTags: {
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, style: 'max-width:100%;height:auto;' } }),
      // Normalize browser font tags to explicit email-safe sizes and colors.
      font: (_tagName, attribs) => {
        const sizes: Record<string, number> = { '1': 10, '2': 13, '3': 16, '4': 18, '5': 24, '6': 32, '7': 48 };
        const styles = [attribs.style || ''];
        if (attribs.size && sizes[attribs.size]) styles.push('font-size:' + sizes[attribs.size] + 'px');
        if (attribs.color) styles.push('color:' + attribs.color);
        return { tagName: 'span', attribs: { style: styles.filter(Boolean).join(';') } };
      },
    },
  });
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function mailPlainText(html: string): string {
  return sanitizeHtml(html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|li|h[1-4]|tr)>/gi, '\n'),
    { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

export function renderStaffMail(input: { background: MailBackground; subtitle: string; subject: string; bodyHtml: string }): RenderedMail {
  const body = sanitizeMailBody(input.bodyHtml);
  const subtitle = escape(input.subtitle);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
  const card = input.background === 'city'
    ? '<div style="font-family:' + font + ';max-width:580px;margin:0 auto;padding:0;">' +
      '<div style="background:linear-gradient(135deg,#3B82F6,#2563EB);padding:32px 24px;text-align:center;border-radius:16px 16px 0 0;">' +
      '<h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:2px;">晏阳城市建设</h1>' +
      '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">' + subtitle + '</p></div>' +
      '<div style="background:#fff;padding:32px 28px;border-radius:0 0 16px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #f0f0f0;">' +
      '<div style="font-size:15px;color:#333;line-height:1.8;">' + body + '</div>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;"><p style="font-size:13px;color:#999;text-align:center;margin:0;">晏阳城市建设</p>' +
      '<p style="font-size:12px;color:#bbb;text-align:center;margin:8px 0 0;letter-spacing:1px;">由晏阳社区邮件系统发送</p></div></div>'
    : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;"><tr><td align="center">' +
      '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border-radius:16px;box-shadow:0 8px 24px rgba(93,164,250,0.14);overflow:hidden;font-family:' + font + ';">' +
      '<tr><td style="background:linear-gradient(135deg,#5da4fa 0%,#3b82d6 100%);padding:20px 28px;">' +
      '<span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.5px;">晏阳社区</span>' +
      '<span style="color:#eaf2ff;font-size:13px;margin-left:10px;">' + subtitle + '</span></td></tr>' +
      '<tr><td style="padding:30px 28px 28px;"><div style="font-size:15px;line-height:1.7;color:#3c4754;">' + body + '</div></td></tr>' +
      '<tr><td style="padding:8px 28px 28px;border-top:1px solid #eef2f7;"><p style="margin:20px 0 0;font-size:12px;color:#b3bcc6;">— 晏阳社区</p></td></tr></table></td></tr></table>';
  return { subject: input.subject, text: input.subtitle + '\n\n' + mailPlainText(body),
    html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#f4f7fb;-webkit-font-smoothing:antialiased;">' + card + '</body></html>' };
}
