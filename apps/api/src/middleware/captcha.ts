import { z } from 'zod';
import { captchaConfig } from '@ycomm/kernel';
import { errors } from '@ycomm/kernel';

/**
 * 人机验证（CAP Worker）：未配置 CAPTCHA_ENDPOINT 时跳过；
 * 已配置则把 widget 解出的 token 交给 `/api/validate` 核验（keepToken=false 一次性消费）。
 * 登录/注册/忘记密码/站长改密等敏感操作共用。
 *
 * token 字段名两种都认：`captchaToken`（本项目前端）/ `cap-token`（cap-widget 在表单里
 * 自动注入的默认字段名），避免「明明验证完了却提示未完成」。
 */
export const captchaTokenFields = {
  captchaToken: z.string().min(1).optional(),
  'cap-token': z.string().min(1).optional(),
} as const;

/** 从请求体里取出验证码 token（两种字段名都认）。 */
export function captchaTokenOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const value = record.captchaToken ?? record['cap-token'];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export async function verifyCaptcha(token: string | undefined): Promise<void> {
  const cfg = captchaConfig();
  if (!cfg) return;
  if (!token) {
    throw errors.validation({ issues: [{ path: 'captchaToken', message: '请完成人机验证' }] });
  }
  let json: { success?: boolean } = {};
  try {
    const response = await fetch(`${cfg.endpoint}/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, keepToken: false }),
    });
    json = (await response.json().catch(() => ({}))) as { success?: boolean };
  } catch {
    throw errors.validation({
      issues: [{ path: 'captchaToken', message: '人机验证服务暂时不可用，请稍后重试' }],
    });
  }
  if (json.success !== true) {
    throw errors.validation({
      issues: [{ path: 'captchaToken', message: '人机验证未通过或已过期，请重新验证' }],
    });
  }
}