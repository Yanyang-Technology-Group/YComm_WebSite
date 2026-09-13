import { captchaConfig } from '@ycomm/kernel';
import { errors } from '@ycomm/kernel';

/**
 * 人机验证（CAP Worker）：未配置 CAPTCHA_ENDPOINT 时跳过；
 * 已配置则把 widget 解出的 token 交给 `/api/validate` 核验（keepToken=false 一次性消费）。
 * 登录/注册/忘记密码/站长改密等敏感操作共用。
 */
export async function verifyCaptcha(token: string | undefined): Promise<void> {
  const cfg = captchaConfig();
  if (!cfg) return;
  if (!token) {
    throw errors.validation({ issues: [{ path: 'captchaToken', message: '请完成人机验证' }] });
  }
  const response = await fetch(`${cfg.endpoint}/api/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, keepToken: false }),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean };
  if (json.success !== true) {
    throw errors.validation({ issues: [{ path: 'captchaToken', message: '人机验证失败，请重试' }] });
  }
}