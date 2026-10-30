import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { getSiteBranding } from '@ycomm/config';
import { SessionNav } from '../components/session-nav';
import { SiteNav } from '../components/site-nav';
import { SearchBox } from '../components/search-box';
import { ThemeSync } from '../components/theme-toggle';
import { GuestPrompt } from '../components/guest-prompt';
import { PageTransition } from '../components/page-transition';
import { VerificationGate } from '../components/verification-gate';
import { DEFAULT_UI_STYLE, UI_STYLE_BOOT_SCRIPT } from '../lib/appearance';
import { GLASS_BOOT_SCRIPT } from '../lib/glass-preference';
import { LiquidGlassEffects } from '../components/liquid-glass';
import { SiteFooter } from '../components/site-footer';
import { ToastViewport } from '../components/toast-viewport';
import './styles.css';

/** 首帧前应用本地主题（避免闪白）；账号主题由 ThemeSync 登录后校正。 */
const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem('ycomm_theme_colour')||'azure';var m=localStorage.getItem('ycomm_theme_mode')||'auto';var r=document.documentElement;r.dataset.themeColour=(c==='none'?'slate':c);r.dataset.themeMode=m;}catch(e){}})();`;

export const dynamic = 'force-dynamic';

/** footer 的版本号：yyyy.mm.dd.commits，构建期注入（见 next.config.ts）。 */
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || 'dev';

export async function generateMetadata(): Promise<Metadata> {
  const branding = getSiteBranding();
  return {
    title: {
      // 晏阳社区 / 晏阳社区 | 论坛 / 晏阳社区 | 下载区 …
      default: branding.name,
      template: `${branding.name} | %s`,
    },
    description: branding.description,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = getSiteBranding();
  // CSP 的 nonce 由 middleware 逐请求生成；Next 会自动把它加到自己的内联脚本上，
  // 我们自己注入的这几段启动脚本必须手动带上，否则会被 CSP 拦掉。
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="zh-CN" data-theme-colour="azure" data-theme-mode="auto" data-ui-style={DEFAULT_UI_STYLE} suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: UI_STYLE_BOOT_SCRIPT }} />
        {/* 主题：先按本地缓存上色，登录后按账号主题校正（按账号生效） */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: GLASS_BOOT_SCRIPT }} />
        <LiquidGlassEffects />
        <ThemeSync />
        {/* 切换页面 / 主题时的渐变幕布（CSS 驱动，见 globals.css） */}
        <div className="anim-veil" aria-hidden="true" />
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              <img src="/logo.png" alt={branding.name} className="logo" />
              <span className="brand-name">{branding.name}</span>
            </Link>
            {/* 导航与登录态都由客户端直连 /api/auth/me 判定，保证与真实会话一致 */}
            <SiteNav />
            <SearchBox />
            <span className="flex-spacer" />
            <nav className="site-actions">
              <SessionNav />
            </nav>
          </div>
        </header>
        <main className="site-main">
          {/* 未验证邮箱 / 未确认新设备时，用引导页替代内容（服务端同样会 403 拦下） */}
          <VerificationGate>
            <PageTransition>{children}</PageTransition>
          </VerificationGate>
        </main>
        <SiteFooter branding={branding} version={appVersion} />
        <ToastViewport />
        {/* 弹窗自身会先自检登录态（客户端），已登录不显示 */}
        <GuestPrompt siteName={branding.name} />
      </body>
    </html>
  );
}
