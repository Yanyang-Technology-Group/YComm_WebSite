import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { NewTopicFab } from '../../../components/forum-form';
import { TopicRow, type TopicRowData } from '../../../components/topic-row';

export const metadata: Metadata = { title: '版块' };
export const dynamic = 'force-dynamic';

interface BoardDetail {
  slug: string;
  name: string;
  description: string;
}

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Sequential: see apps/web/src/app/downloads/page.tsx (PGlite dev quirk).
  const boardResult = await apiGet<{ boards: BoardDetail[] }>('/api/forum/boards');
  const topicsResult = await apiGet<{ topics: TopicRowData[]; total: number }>(
    `/api/forum/boards/${slug}/topics`,
  );

  const board = boardResult.data?.boards.find((entry) => entry.slug === slug);
  const topics: TopicRowData[] = topicsResult.data?.topics ?? [];

  return (
    <div>
      <p>
        <Link href="/forum" className="muted">
          ← 全部版块
        </Link>
      </p>
      <h1 className="page-title">{board?.name ?? slug}</h1>
      {board && <p className="muted">{board.description}</p>}

      {topics.length === 0 && <p className="muted">还没有主题，点右下角「发新主题」来发第一帖吧。</p>}
      {topics.map((topic) => (
        <TopicRow key={topic.id} topic={topic} slug={slug} />
      ))}

      <NewTopicFab boardSlug={slug} />
    </div>
  );
}