import type { Metadata } from 'next';
import { apiGet } from '../../lib/server-api';
import { CardGrid, type PublicCard } from '../../components/card-grid';

export const metadata: Metadata = { title: '下载区' };
export const dynamic = 'force-dynamic';

export default async function DownloadsPage() {
  const result = await apiGet<{ cards: PublicCard[] }>('/api/downloads/cards');
  const cards: PublicCard[] = result.data?.cards ?? [];
  const roots = cards.filter((card) => card.parentId === null);

  return (
    <div>
      <h1 className="page-title">下载区</h1>
      {!result.ok && <p className="muted">无法加载卡片（可能需登录）</p>}
      {roots.length === 0 ? <p className="muted">暂无内容，等管理员配置。</p> : <CardGrid cards={roots} />}
    </div>
  );
}
