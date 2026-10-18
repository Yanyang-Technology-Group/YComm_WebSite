/**
 * 全站安全响应头。
 *
 * 放在一处，供 Next middleware（HTML / RSC / API）和自研 Node 服务器里的
 * `/api/uploads/*` 直出分支共用 —— 媒体是绕过 Next 直接 pipe 出去的，如果不显式
 * 补上，`X-Content-Type-Options` 这类头在那条路径上就缺失（ZAP 会按 URL 一条条报）。
 */

/** 与 CSP 无关、每个响应都该带的头（OWASP / ZAP 基础项）。 */
export function baselineSecurityHeaders(): Record<string, string> {
  return {
    // 禁止嗅探：声明了 text/plain 的响应绝不能被当成脚本执行。
    'X-Content-Type-Options': 'nosniff',
    // 不允许被任何站点套 iframe（配合 CSP 的 frame-ancestors，给老浏览器兜底）。
    'X-Frame-Options': 'DENY',
    // 跨站跳转不泄漏完整路径（本站含用户名、资源 id）。
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // 本站不用这些能力，全关；顺带挡住「iframe 里借权限」的套路。
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // 弹窗隔离：被打开的第三方页面拿不到 window.opener。
    'Cross-Origin-Opener-Policy': 'same-origin',
    // 只在 HTTPS 下生效；includeSubDomains 不写，避免影响同域其它子域的纯 HTTP 服务。
    'Strict-Transport-Security': 'max-age=31536000',
  };
}

/** 用户相关的 JSON 一律不许缓存（代理、磁盘、浏览器都别留）。 */
export function noStoreHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
}

export interface CspOptions {
  /** 每个请求现算的 nonce：Next 会把它加到自己的内联脚本上。 */
  nonce: string;
  /** 人机验证接口所在的 origin（`CAPTCHA_ENDPOINT`），connect-src 放行它。 */
  captchaConnectOrigin?: string | null;
  /**
   * 人机验证脚本的 origin —— 只有把 `CAPTCHA_SCRIPT` 指回外部地址时才需要；
   * 默认同源 `/cap.min.js`，靠 `'self'` 就够了。
   */
  captchaScriptOrigin?: string | null;
  /** 实时推送的 wss origin（wss://community.yanyn.cn），没算出来就传 null。 */
  wsOrigin: string | null;
  /** 开发模式要放行 eval（React Refresh / 调试器）。 */
  dev: boolean;
}

/**
 * 逐请求生成 CSP。
 *
 * 说明几个不得不放的口子：
 * - `style-src 'unsafe-inline'`：整站样式都是 React 的 `style={{…}}`，SSR 出来就是
 *   style 属性，不放行的话首屏全是没样式的裸文本。（ZAP 会因此报「style-src 不安全-内联」，
 *   要彻底消掉只能把内联样式全量改写成 class，不在本次范围。）
 * - `img-src/media-src https:`：头像、Markdown 里的图片/视频允许任意外链。
 * - `'wasm-unsafe-eval'`：人机验证的工作量证明在 Worker 里编译 WebAssembly（只允许
 *   编译 wasm，不允许 eval 字符串代码）。cap 的 `new Function` 只在渲染
 *   `onreset` 这类内联属性时才走，本站没有这种用法。
 */
export function contentSecurityPolicy(options: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${options.nonce}'`, "'wasm-unsafe-eval'"];
  if (options.dev) scriptSrc.push("'unsafe-eval'");
  if (options.captchaScriptOrigin) scriptSrc.push(options.captchaScriptOrigin);

  const connectSrc = ["'self'"];
  if (options.captchaConnectOrigin) connectSrc.push(options.captchaConnectOrigin);
  if (options.captchaScriptOrigin) connectSrc.push(options.captchaScriptOrigin);
  if (options.wsOrigin) connectSrc.push(options.wsOrigin);

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-src 'self'",
    // 人机验证的 PoW 在 blob: 创建的 Worker 里跑。
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** 从一个 URL 里取 origin；空值/非法值返回 null（宁可不放行也不拼坏 CSP）。 */
export function urlOrigin(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
