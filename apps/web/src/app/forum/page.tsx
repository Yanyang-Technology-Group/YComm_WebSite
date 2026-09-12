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
      <h1>论坛</h1>
      {!result.ok && <p style={{ color: '#dc2626' }}>无法加载版块列表</p>}
      {boards.map((board) => (
        <Link
          key={board.slug}
          href={`/forum/${board.slug}`}
          style={{
            display: 'block',
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            background: '#fff',
            padding: '0.9rem 1.1rem',
            marginBottom: '0.6rem',
            color: '#1c1c1e',
            textDecoration: 'none',
          }}
        >
          <strong>{board.name}</strong>
          <span style={{ color: '#71717a', marginLeft: '0.6rem', fontSize: '0.9rem' }}>
            {board.topic_count} 主题 · {board.post_count} 帖子
          </span>
          <div style={{ color: '#52525b', fontSize: '0.9rem' }}>{board.description}</div>
          {board.policy?.visibility === 'public' && (
            <span style={{ fontSize: '0.75rem', color: '#0891b2' }}>公开可读</span>
          )}
        </Link>
      ))}
    </div>
  );
}