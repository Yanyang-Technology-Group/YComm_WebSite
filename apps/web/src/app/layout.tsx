import type { Metadata } from 'next';
import Link from 'next/link';
import localFont from 'next/font/local';
import { getSiteBranding } from '@ycomm/config';
import { SessionNav } from '../components/session-nav';
import { SiteNav } from '../components/site-nav';
import { SearchBox } from '../components/search-box';
import { ThemeSync } from '../components/theme-toggle';
import { GuestPrompt } from '../components/guest-prompt';
import { PageTransition } from '../components/page-transition';
import './globals.css';

/** 首帧前应用本地主题（避免闪白）；账号主题由 ThemeSync 登录后校正。 */
const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem('ycomm_theme_colour')||'azure';var m=localStorage.getItem('ycomm_theme_mode')||'auto';var r=document.documentElement;r.dataset.themeColour=(c==='none'?'slate':c);r.dataset.themeMode=m;}catch(e){}})();`;

export const dynamic = 'force-dynamic';

/**
 * 自托管字体：Noto Sans SC 可变字重（100–900），随镜像一起分发，
 * 运行时不请求任何外部字体 CDN（大陆访问 Google Fonts 会被墙）。
 */
const noto = localFont({
  src: '../fonts/NotoSansSC-VF.ttf',
  variable: '--font-noto',
  display: 'swap',
  weight: '100 900',
  preload: false,
  fallback: ['system-ui', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
});

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

  return (
    <html lang="zh-CN" data-theme-colour="azure" data-theme-mode="auto" className={noto.variable}>
      <body>
        {/* 主题：先按本地缓存上色，登录后按账号主题校正（按账号生效） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
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
          <PageTransition>{children}</PageTransition>
        </main>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <span>© 2025-2026 晏阳技术组，本站支持IPV4与IPV6</span>
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            <span className="footer-version" title="版本号（yyyy.mm.dd.提交数）">
              {appVersion}
            </span>
            {branding.sourceUrl ? (
              <>
                <span className="footer-sep" aria-hidden="true">
                  ·
                </span>
                <Link href={branding.sourceUrl} target="_blank" rel="noopener">
                  开源仓库（AGPLv3）
                </Link>
              </>
            ) : null}
            {branding.icp ? (
              <>
                <span className="footer-sep" aria-hidden="true">
                  ·
                </span>
                <span>{branding.icp}</span>
              </>
            ) : null}
          </div>
        </footer>
        {/* 弹窗自身会先自检登录态（客户端），已登录不显示 */}
        <GuestPrompt siteName={branding.name} />
      </body>
    </html>
  );
}