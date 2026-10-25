import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '离开晏阳社区' };

export default async function ExternalLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url: raw } = await searchParams;
  let target: URL | null = null;
  try {
    const parsed = new URL(raw ?? '');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') target = parsed;
  } catch { /* invalid URL stays blocked */ }

  return (
    <section className="panel external-link-panel">
      <div className="external-link-icon" aria-hidden="true">↗</div>
      <p className="section-title">即将离开晏阳社区</p>
      <p>你打开的链接不属于本站，请确认目标地址可信后再继续。请小心谨慎，切勿向陌生网站提供密码、验证码或个人信息。</p>
      {target ? (
        <>
          <p className="external-link-host">目标网站：<strong>{target.hostname}</strong></p>
          <code className="external-link-url">{target.href}</code>
          <div className="external-link-actions">
            <Link className="text-btn" href="/forum">留在本站</Link>
            <a className="text-btn" href={target.href} target="_blank" rel="noopener noreferrer">确认继续前往 ↗</a>
          </div>
        </>
      ) : <p className="error-text">链接无效，已阻止打开。</p>}
    </section>
  );
}
