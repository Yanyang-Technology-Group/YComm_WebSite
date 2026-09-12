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
        <header
          style={{
            background: 'var(--header-bg)',
            color: 'var(--header-text)',
            padding: '0 1.5rem',
            height: '3.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
          }}
        >
          <Link
            href="/"
            style={{ color: 'var(--header-text)', fontWeight: 700, textDecoration: 'none' }}
          >
            {branding.name}
          </Link>
          <nav style={{ display: 'flex', gap: '1rem', fontSize: '0.95rem' }}>
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} style={{ color: 'var(--header-text)', opacity: 0.85 }}>
                {item.label}
              </Link>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          <nav style={{ display: 'flex', gap: '0.8rem', fontSize: '0.95rem', alignItems: 'center' }}>
            <ThemeToggle />
            <SessionNav />
          </nav>
        </header>
        <main style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
          {children}
        </main>
        <footer
          style={{
            borderTop: '1px solid var(--border)',
            padding: '1.5rem',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '0.85rem',
          }}
        >
          {branding.name} — {branding.tagline}
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