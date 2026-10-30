import { describe, expect, it } from 'vitest';
import { mailPlainText, renderStaffMail, sanitizeMailBody } from './mail-content';

describe('staff email rendering', () => {
  it('retains formatting and remote images while removing executable content', () => {
    const html = sanitizeMailBody('<p onclick="alert(1)" style="font-size:24px;color:#ff0000;position:fixed;background-image:url(https://bad.test/x)"><b>粗体</b><i>斜体</i><u>下划线</u><s>删除线</s></p><img src="https://images.example.com/a.png" onerror="x()"><script>bad()</script><iframe src="https://bad.test"></iframe>');
    expect(html).toContain('font-size:24px'); expect(html).toContain('color:#ff0000');
    for (const tag of ['b', 'i', 'u', 's']) expect(html).toContain('<' + tag + '>');
    expect(html).toContain('https://images.example.com/a.png'); expect(html).toContain('max-width:100%');
    expect(html).not.toMatch(/onclick|onerror|script|iframe|position|background-image/);
  });
  it('rejects unsafe image and link protocols', () => {
    const html = sanitizeMailBody('<img src="javascript:alert(1)"><img src="data:image/svg+xml,evil"><img src="//bad.test/a"><a href="javascript:x()">link</a>');
    expect(html).not.toMatch(/src=|href=/);
  });
  it('normalizes browser editor font tags without losing color or size', () => {
    const html = sanitizeMailBody('<font size="5" color="#ff0000"><b>通知</b></font>');
    expect(html).toContain('font-size:24px'); expect(html).toContain('color:#ff0000'); expect(html).toContain('<b>通知</b>');
    expect(html).not.toContain('<font'); expect(sanitizeMailBody(html)).toBe(html);
  });
  it('keeps the two brand backgrounds fixed and escapes the subtitle', () => {
    const content = { subject: '通知', subtitle: '<img src=x onerror=alert(1)>', bodyHtml: '<p>内容</p>' };
    const community = renderStaffMail({ ...content, background: 'community' });
    const city = renderStaffMail({ ...content, background: 'city' });
    expect(community.html).toContain('晏阳社区'); expect(community.html).toContain('max-width:480px');
    expect(city.html).toContain('晏阳城市建设'); expect(city.html).toContain('max-width:580px');
    for (const mail of [community, city]) { expect(mail.html).toContain('&lt;img'); expect(mail.html).not.toContain('<img src=x'); expect(mail.html).toContain('<p>内容</p>'); }
    expect(mailPlainText('<p>第一段</p><p>第二段<br>下一行 &amp; 更多</p>')).toBe('第一段\n第二段\n下一行 & 更多');
  });
});
