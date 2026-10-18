import { NextResponse, type NextRequest } from 'next/server';
import {
  baselineSecurityHeaders,
  contentSecurityPolicy,
  noStoreHeaders,
  urlOrigin,
} from '../security-headers';

/**
 * 安全头出口。
 *
 * 为什么放在 middleware 而不是 `next.config.ts` 的 `headers()`：
 * 1. CSP 要带每请求现算的 nonce（Next 会把同一个 nonce 加到自己注入的内联脚本上，
 *    这样就不必给 `script-src` 开 `'unsafe-inline'`）；
 * 2. 人机验证接口的 origin 是运行时配置（`CAPTCHA_ENDPOINT`），构建期读不到。
 *
 * 中间件跑在 Edge 运行时：这里只用 Web API，不 import 任何服务端包。
 */

export function middleware(request: NextRequest) {
  const dev = process.env.NODE_ENV !== 'production';
  // 每次请求一个新 nonce；去掉 - 之后是合法的 CSP nonce 字符集。
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const host = request.headers.get('host') ?? request.nextUrl.host;
  // 浏览器页面是 https 时 WebSocket 走 wss；本地开发走 ws。
  const wsOrigin = host ? `${request.nextUrl.protocol === 'https:' ? 'wss' : 'ws'}://${host}` : null;

  const csp = contentSecurityPolicy({
    nonce,
    // 校验接口永远是外部 CAP Worker（跨域 fetch），必须放行它的 origin。
    captchaConnectOrigin: urlOrigin(process.env.CAPTCHA_ENDPOINT?.trim()),
    // 脚本默认同源自托管（/cap.min.js）；只有显式配置成绝对地址时才需要额外 origin。
    captchaScriptOrigin: urlOrigin(process.env.CAPTCHA_SCRIPT?.trim()),
    wsOrigin,
    dev,
  });

  // 把 nonce 传给渲染层：layout 里的内联启动脚本要带上它，Next 自己的脚本会自动带。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  for (const [name, value] of Object.entries(baselineSecurityHeaders())) {
    response.headers.set(name, value);
  }
  response.headers.set('Content-Security-Policy', csp);
  // API 的 JSON 全是「跟当前会话相关」的数据，绝不能让任何中间层缓存。
  if (request.nextUrl.pathname.startsWith('/api/')) {
    for (const [name, value] of Object.entries(noStoreHeaders())) {
      response.headers.set(name, value);
    }
  }

  return response;
}

export const config = {
  /**
   * 跳过静态资源：它们由 Next 自己的静态处理返回，缓存头（immutable）已经正确，
   * 没必要每个 chunk 都过一遍中间件。
   * `/api/uploads/*` 由自研 Node 服务器直出（见 serve-upload.ts），这里也碰不到。
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|mov|txt|xml|woff2?)$).*)',
  ],
};
