import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../../lib/server-api';
import { DeletePostButton, DeleteTopicButton, LikeButton, ReplyForm } from '../../../../components/forum-form';
import { MarkdownContent } from '../../../../components/markdown-content';

export const metadata: Metadata = { title: '主题' };
export const dynamic = 'force-dynamic';

interface Topic {
  id: string;
  title: string;
  author_id: string | null;
  is_locked: boolean;
  reply_count: number;
  view_count: number;
  created_at: string;
}

interface Post {
  id: string;
  author_id: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  position: number;
  content_md: string;
  created_at: string;
  edited_at: string | null;
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string; topicId: string }>;
}) {
  const { slug, topicId } = await params;
  const result = await apiGet<{ topic: Topic; posts: Post[]; likedPostIds: string[] }>(
    `/api/forum/topics/${topicId}`,
  );
  const topic = result.data?.topic;

  if (!topic) {
    return (
      <div>
        <p>
          <Link href={`/forum/${slug}`} className="muted">
            ← 返回版块
          </Link>
        </p>
        <p className="muted">主题不存在或不可见{result.status === 401 ? '：请先登录' : ''}</p>
      </div>
    );
  }

  const posts: Post[] = result.data?.posts ?? [];
  const liked = result.data?.likedPostIds ?? [];

  return (
    <div>
      <p>
        <Link href={`/forum/${slug}`} className="muted">
          ← 返回版块
        </Link>
      </p>
      <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
        {topic.title}
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {topic.reply_count} 回复 · {topic.view_count} 浏览{topic.is_locked ? ' · 已锁定' : ''}
      </p>
      <p style={{ marginTop: '0.5rem' }}>
        <DeleteTopicButton topicId={topic.id} authorId={topic.author_id} boardSlug={slug} />
      </p>

      {posts.map((post) => (
        <div key={post.id} className="post-item">
          <div className="muted" style={{ marginBottom: '0.4rem' }}>
            #{post.position} · {post.authorDisplayName ?? '访客'} ·{' '}
            {new Date(post.created_at).toLocaleString('zh-CN')}
            {post.edited_at ? ' · 已编辑' : ''}
          </div>
          <MarkdownContent text={post.content_md} />
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.75rem' }}>
            <LikeButton postId={post.id} initialLiked={liked.includes(post.id)} />
            <DeletePostButton postId={post.id} authorId={post.author_id} />
          </div>
        </div>
      ))}

      {topic.is_locked ? (
        <p className="muted">主题已锁定，无法回复。</p>
      ) : (
        <div style={{ marginTop: '1.5rem' }}>
          <h2 className="section-title">回复</h2>
          <ReplyForm topicId={topic.id} />
        </div>
      )}
    </div>
  );
}
