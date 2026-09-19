import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 回归测试：cap-widget 在表单里注入的隐藏字段名是 `cap-token`（默认），
 * 本项目前端用的是 `captchaToken`。两边都认，才不会出现「明明验证完了却提示未完成」。
 */
describe('captcha token field names', () => {
  afterEach(() => {
    vi.doUnmock('@ycomm/kernel');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  /** 以指定的验证码配置加载模块（null = 未配置验证码）。 */
  async function loadCaptcha(config: { endpoint: string; widgetApi: string; script: string } | null) {
    vi.resetModules();
    vi.doMock('@ycomm/kernel', async (importOriginal) => {
      const actual = await importOriginal<Record<string, unknown>>();
      const errors = actual.errors;
      return { ...actual, errors, captchaConfig: () => config };
    });
    return import('./captcha');
  }

  it('captchaTokenOf 同时认 captchaToken 与 cap-token', async () => {
    const { captchaTokenOf } = await loadCaptcha(null);
    expect(captchaTokenOf({ captchaToken: 'abc' })).toBe('abc');
    expect(captchaTokenOf({ 'cap-token': 'xyz' })).toBe('xyz');
    expect(captchaTokenOf({ captchaToken: '  trim-me  ' })).toBe('trim-me');
    // 空值 / 非法输入一律当没填
    expect(captchaTokenOf({})).toBeUndefined();
    expect(captchaTokenOf({ captchaToken: '' })).toBeUndefined();
    expect(captchaTokenOf(null)).toBeUndefined();
    expect(captchaTokenOf('not-an-object')).toBeUndefined();
  });

  it('未配置验证码时直接放行（不校验）', async () => {
    const { verifyCaptcha } = await loadCaptcha(null);
    await expect(verifyCaptcha(undefined)).resolves.toBeUndefined();
  });

  /** 捕获抛出的 AppError 并序列化：具体文案在 meta.issues 里，不在 message 上。 */
  async function failTextOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return '(没有报错)';
    } catch (error) {
      return JSON.stringify(error);
    }
  }

  it('配置了但没带 token → 提示请完成人机验证', async () => {
    const { verifyCaptcha } = await loadCaptcha({
      endpoint: 'https://cap.example.com',
      widgetApi: 'https://cap.example.com/api/',
      script: 'https://cap.example.com/cap.min.js',
    });
    expect(await failTextOf(verifyCaptcha(undefined))).toContain('请完成人机验证');
  });

  it('把 token 提交给 /api/validate；success=false → 提示重新验证', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { verifyCaptcha } = await loadCaptcha({
      endpoint: 'https://cap.example.com',
      widgetApi: 'https://cap.example.com/api/',
      script: 'https://cap.example.com/cap.min.js',
    });

    expect(await failTextOf(verifyCaptcha('token-1'))).toContain('未通过或已过期');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cap.example.com/api/validate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('success=true → 通过', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    const { verifyCaptcha } = await loadCaptcha({
      endpoint: 'https://cap.example.com',
      widgetApi: 'https://cap.example.com/api/',
      script: 'https://cap.example.com/cap.min.js',
    });
    await expect(verifyCaptcha('token-2')).resolves.toBeUndefined();
  });
});