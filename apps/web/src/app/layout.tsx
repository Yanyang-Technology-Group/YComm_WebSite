import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { NAV_ITEMS, getSiteBranding } from '@ycomm/config';
import { app } from '@ycomm/api';
import { SessionNav } from '../components/session-nav';
import { GuestPrompt } from '../components/guest-prompt';
import './globals.css';

export const dynamic = 'force-dynamic';

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
    <html lang="zh-CN" data-theme="azure">
      <body>
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
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          © 2025-2026 晏阳技术组
          {branding.sourceUrl ? (
            <>
              {' · '}
              <Link href={branding.sourceUrl} target="_blank" rel="noopener">
                源码（AGPLv3）
              </Link>
            </>
          ) : null}
          {branding.icp ? <> · {branding.icp}</> : null}
        </footer>
        {!signedIn && <GuestPrompt siteName={branding.name} />}
      </body>
    </html>
  );
}
