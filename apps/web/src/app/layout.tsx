import type { Metadata } from 'next';
import Link from 'next/link';
import localFont from 'next/font/local';
import { getSiteBranding } from '@ycomm/config';
import { SessionNav } from '../components/session-nav';
import { SiteNav } from '../components/site-nav';
import { GuestPrompt } from '../components/guest-prompt';
import { PageTransition } from '../components/page-transition';
import './globals.css';

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
    <html lang="zh-CN" data-light-theme="azure" data-dark-theme="azure" className={noto.variable}>
      <body>
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
            <span>© 2025-2026 晏阳技术组</span>
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