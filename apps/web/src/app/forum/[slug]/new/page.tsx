import type { Metadata } from 'next';
import { apiGet } from '../../../../lib/server-api';
import { NewTopicComposer } from '../../../../components/forum-form';
import { PageBack } from '../../../../components/page-back';

export const metadata: Metadata = { title: '发新主题' };
export const dynamic = 'force-dynamic';

interface BoardDetail {
  slug: string;
  name: string;
  description: string;
}

/** 独立的新主题发布页：宽正文、少装饰，发布成功后跳回主题页。 */
export default async function NewTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const boardResult = await apiGet<{ boards: BoardDetail[] }>('/api/forum/boards');
  const board = boardResult.data?.boards.find((entry) => entry.slug === slug);

  return (
    <div>
      <PageBack fallback={`/forum/${slug}`} label={board?.name ?? '返回版块'} />
      <h1 className="page-title">发新主题</h1>
      {board && (
        <p className="muted">
          {board.name}
          {board.description ? ` · ${board.description}` : ''}
        </p>
      )}
      <NewTopicComposer boardSlug={slug} boardName={board?.name} />
    </div>
  );
}
