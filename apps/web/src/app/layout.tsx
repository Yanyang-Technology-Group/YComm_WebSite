import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import { NAV_ITEMS, getSiteBranding } from '@ycomm/config';
import { app } from '@ycomm/api';
import { SessionNav } from '../components/session-nav';
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

async function isSignedIn(): Promise<boolean> {
  try {
    const cookieHeader = (await cookies()).toString();
    const response = await app.request('/api/auth/me', {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    if (!response.ok) return false;
    const json = (await response.json()) as { user?: unknown };
    return json.user != null;
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = getSiteBranding();
  const signedIn = await isSignedIn();

  return (
    <html lang="zh-CN" data-theme="azure" className={noto.variable}>
      <body>
        {/* 切换页面 / 主题时的渐变幕布（CSS 驱动，见 globals.css） */}
        <div className="anim-veil" aria-hidden="true" />
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              <img src="/logo.png" alt={branding.name} className="logo" />
              <span className="brand-name">{branding.name}</span>
            </Link>
            <nav className="site-nav">
              {NAV_ITEMS.filter((item) => !item.requiresAuth || signedIn).map((item) => (
                <Link key={item.href} href={item.href} className="nav-link">
                  {item.label}
                </Link>
              ))}
            </nav>
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
        {!signedIn && <GuestPrompt siteName={branding.name} />}
      </body>
    </html>
  );
}
