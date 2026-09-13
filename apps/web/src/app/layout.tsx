import type { Metadata } from 'next';
import Link from 'next/link';
import { NAV_ITEMS, getSiteBranding } from '@ycomm/config';
import { SessionNav } from '../components/session-nav';
import { ThemeToggle } from '../components/theme-toggle';
import './globals.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const branding = getSiteBranding();
  return {
    title: {
      default: `${branding.name} — ${branding.tagline}`,
      template: `%s · ${branding.name}`,
    },
    description: branding.description,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = getSiteBranding();
  return (
    <html lang="zh-CN" data-theme="azure">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              <img src="/logo.png" alt={branding.name} className="logo logo-light" />
              <img src="/logo-dark.png" alt={branding.name} className="logo logo-dark" />
              <span className="brand-name">{branding.name}</span>
            </Link>
            <nav className="site-nav">
              {NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className="nav-link">
                  {item.label}
                </Link>
              ))}
            </nav>
            <span className="flex-spacer" />
            <nav className="site-actions">
              <ThemeToggle />
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
      </body>
    </html>
  );
}
