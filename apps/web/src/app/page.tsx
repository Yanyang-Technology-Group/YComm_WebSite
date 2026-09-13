import Link from 'next/link';
import { getSiteBranding } from '@ycomm/config';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const branding = getSiteBranding();
  return (
    <div className="hero">
      <span className="hero-kicker">自托管社区 · 论坛与资源下载</span>
      <h1 className="hero-title">{branding.name}</h1>
      <p className="hero-tagline">{branding.tagline}</p>
      <p className="hero-desc">{branding.description}</p>
      <div className="hero-actions">
        <Link href="/forum" className="hero-btn primary">
          进入论坛
        </Link>
        <Link href="/downloads" className="hero-btn">
          浏览下载区
        </Link>
      </div>
    </div>
  );
}
