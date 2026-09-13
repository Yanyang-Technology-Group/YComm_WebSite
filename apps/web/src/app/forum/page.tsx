import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../lib/server-api';

export const metadata: Metadata = { title: '论坛' };
export const dynamic = 'force-dynamic';

interface Board {
  slug: string;
  name: string;
  description: string;
  topic_count: number;
  post_count: number;
  policy?: { visibility: string; minLevel: number; requireInvite: boolean };
}

export default async function ForumPage() {
  const result = await apiGet<{ boards: Board[] }>('/api/forum/boards');
  const boards: Board[] = result.data?.boards ?? [];

  return (
    <div>
      <h1 className="page-title">论坛</h1>
      {!result.ok && <p className="muted">无法加载版块列表</p>}
      {boards.length === 0 && <p className="muted">还没有版块，等管理员创建。</p>}
      {boards.map((board) => (
        <Link key={board.slug} href={`/forum/${board.slug}`} className="card topic-link">
          <strong>{board.name}</strong>
          <span className="muted" style={{ marginLeft: '0.6rem' }}>
            {board.topic_count} 主题 · {board.post_count} 帖子
          </span>
          <div className="muted">{board.description}</div>
          {board.policy?.visibility === 'public' && (
            <span className="badge">公开可读</span>
          )}
        </Link>
      ))}
    </div>
  );
}
