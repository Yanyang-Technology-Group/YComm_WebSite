import { describe, expect, it } from 'vitest';
import { isCaptchaError } from './captcha';

describe('isCaptchaError', () => {
  it('recognizes the server validation path even when the message is localized differently', () => {
    expect(isCaptchaError({ meta: { issues: [{ path: 'captchaToken', message: 'Invalid token' }] } })).toBe(true);
  });

  it('recognizes localized CAPTCHA failure messages', () => {
    expect(isCaptchaError({ meta: { issues: [{ path: 'body', message: '人机验证未通过或已过期' }] } })).toBe(true);
  });

  it('does not classify unrelated request errors as CAPTCHA failures', () => {
    expect(isCaptchaError({ meta: { issues: [{ path: 'email', message: '邮箱格式错误' }] } })).toBe(false);
    expect(isCaptchaError({ message: '账号不存在' })).toBe(false);
  });

  it('recognizes a CAPTCHA service error exposed as the top-level message', () => {
    expect(isCaptchaError({ message: 'CAPTCHA service unavailable' })).toBe(true);
  });
});
