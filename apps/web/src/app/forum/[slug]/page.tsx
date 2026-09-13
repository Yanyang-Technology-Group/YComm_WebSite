import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { NewTopicFab } from '../../../components/forum-form';

export const metadata: Metadata = { title: '版块' };
export const dynamic = 'force-dynamic';

interface PreviewPost {
  contentExcerpt: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatarPath: string | null;
  likeCount: number;
}

/** 小头像：有图用图，没图用昵称首字母。 */
function Avatar({ path, name, small = false }: { path: string | null; name: string | null; small?: boolean }) {
  const cls = small ? 'avatar avatar-sm' : 'avatar';
  return path ? (
    <img src={path} alt={name ?? '访客'} className={cls} loading="lazy" />
  ) : (
    <span className={`${cls} avatar-fallback`}>{(name ?? '访客').slice(0, 1).toUpperCase()}</span>
  );
}

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
  preview: { firstPost: PreviewPost | null; topReplies: PreviewPost[] };
}

interface BoardDetail {
  slug: string;
  name: string;
  description: string;
}

function excerpt(text: string): string {
  const oneLine = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;
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

      {topics.length === 0 && <p className="muted">还没有主题，点右下角「发新主题」来发第一帖吧。</p>}
      {topics.map((topic) => (
        <Link key={topic.id} href={`/forum/${slug}/${topic.id}`} className="topic-block">
          <div className="topic-block-title">
            {topic.is_pinned && '📌 '}
            {topic.is_locked && '🔒 '}
            {topic.title}
          </div>

          {topic.preview.firstPost && (
            <div className="topic-block-post">
              <Avatar
                path={topic.preview.firstPost.authorAvatarPath}
                name={topic.preview.firstPost.authorDisplayName}
                small
              />
              <span className="topic-block-author">
                {topic.preview.firstPost.authorDisplayName ?? '访客'}
              </span>
              <span className="topic-block-text">
                {excerpt(topic.preview.firstPost.contentExcerpt)}
              </span>
            </div>
          )}

          {topic.preview.topReplies.map((reply, index) => (
            <div key={index} className="topic-block-post topic-block-reply">
              <span className="topic-block-likes">♥ {reply.likeCount}</span>
              <Avatar path={reply.authorAvatarPath} name={reply.authorDisplayName} small />
              <span className="topic-block-author">{reply.authorDisplayName ?? '访客'}</span>
              <span className="topic-block-text">{excerpt(reply.contentExcerpt)}</span>
            </div>
          ))}

          <div className="topic-block-meta muted">
            {topic.authorDisplayName ?? '访客'} 发帖 · {topic.reply_count} 回复 · {topic.view_count} 浏览
          </div>
        </Link>
      ))}

      <NewTopicFab boardSlug={slug} />
    </div>
  );
}