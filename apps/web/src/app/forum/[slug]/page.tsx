import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { NewTopicForm } from '../../../components/forum-form';

export const metadata: Metadata = { title: '版块' };
export const dynamic = 'force-dynamic';

interface Topic {
  id: string;
  title: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  reply_count: number;
  view_count: number;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  last_post_at: string | null;
}

interface BoardDetail {
  slug: string;
  name: string;
  description: string;
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Sequential: see apps/web/src/app/downloads/page.tsx (PGlite dev quirk).
  const boardResult = await apiGet<{ boards: BoardDetail[] }>('/api/forum/boards');
  const topicsResult = await apiGet<{ topics: Topic[]; total: number }>(`/api/forum/boards/${slug}/topics`);

  const board = boardResult.data?.boards.find((entry) => entry.slug === slug);
  const topics: Topic[] = topicsResult.data?.topics ?? [];

  return (
    <div>
      <p>
        <Link href="/forum" className="muted">
          ← 全部版块
        </Link>
      </p>
      <h1 className="page-title">{board?.name ?? slug}</h1>
      {board && <p className="muted">{board.description}</p>}

      <h2 className="section-title">主题</h2>
      {topics.length === 0 && <p className="muted">还没有主题，来发第一帖吧。</p>}
      {topics.map((topic) => (
        <Link key={topic.id} href={`/forum/${slug}/${topic.id}`} className="card topic-link">
          <strong>
            {topic.is_pinned && '📌 '}
            {topic.is_locked && '🔒 '}
            {topic.title}
          </strong>
          <span className="muted" style={{ marginLeft: '0.6rem' }}>
            {topic.authorDisplayName ?? '访客'} · {topic.reply_count} 回复 · {topic.view_count} 浏览
          </span>
        </Link>
      ))}

      <h2 className="section-title" style={{ marginTop: '2rem' }}>
        发新主题
      </h2>
      <NewTopicForm boardSlug={slug} />
    </div>
  );
}
