import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGet } from '../../../../lib/server-api';
import { CardGrid, type PublicCard } from '../../../../components/card-grid';

export const metadata: Metadata = { title: '下载区' };
export const dynamic = 'force-dynamic';

interface Resource {
  id: string;
  title: string;
  summary: string;
  versionLabel: string | null;
  sourceType: string;
  downloadCount: number;
}

export default async function CardPage({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const result = await apiGet<{ cards: PublicCard[] }>('/api/downloads/cards');
  const cards: PublicCard[] = result.data?.cards ?? [];
  const card = cards.find((entry) => entry.id === cardId);

  // 返回上一级：有父卡片就回父卡片，根层卡片才回「下载区」首页。
  const backHref = card?.parentId
    ? `/downloads/card/${card.parentId}`
    : '/downloads';
  const backLabel = card?.parentId
    ? `← ${cards.find((entry) => entry.id === card.parentId)?.title ?? '上一级'}`
    : '← 下载区';
  const BackLink = (
    <p>
      <Link href={backHref} className="muted">
        {backLabel}
      </Link>
    </p>
  );

  if (!card) {
    return (
      <div>
        <p>
          <Link href="/downloads" className="muted">
            ← 下载区
          </Link>
        </p>
        <p className="muted">卡片不存在或不可见。</p>
      </div>
    );
  }

  if (card.kind === 'redirect' && card.redirectUrl) {
    redirect(card.redirectUrl);
  }

  if (card.kind === 'container') {
    const children = cards.filter((entry) => entry.parentId === cardId);
    return (
      <div>
        {BackLink}
        <h1 className="page-title">{card.title}</h1>
        {card.subtitle && <p className="muted">{card.subtitle}</p>}
        {card.subtitleUrl && (
          <p style={{ margin: '0 0 0.75rem' }}>
            <a href={card.subtitleUrl} target="_blank" rel="noopener noreferrer" className="uname" style={{ fontSize: '0.95rem' }}>
              → 直达链接
            </a>
          </p>
        )}
        {children.length === 0 ? <p className="muted">这个卡片里还没有内容。</p> : <CardGrid cards={children} />}
      </div>
    );
  }

  // kind === 'resources'
  const resourcesResult = await apiGet<{ resources: Resource[] }>('/api/downloads/resources');
  const resources: Resource[] = resourcesResult.data?.resources ?? [];

  return (
    <div>
      {BackLink}
      <h1 className="page-title">{card.title}</h1>
      {card.subtitle && <p className="muted">{card.subtitle}</p>}
      {resources.length === 0 && <p className="muted">暂无已发布资源。</p>}
      {resources.map((resource) => (
        <Link key={resource.id} href={`/downloads/${resource.id}`} className="card topic-link">
          <strong>{resource.title}</strong>
          {resource.versionLabel && <span className="muted"> v{resource.versionLabel}</span>}
          {resource.summary && <div className="muted">{resource.summary}</div>}
          <div className="muted">
            {resource.sourceType === 'external' ? '外链' : '本站文件'} · 下载 {resource.downloadCount} 次
          </div>
        </Link>
      ))}
    </div>
  );
}
