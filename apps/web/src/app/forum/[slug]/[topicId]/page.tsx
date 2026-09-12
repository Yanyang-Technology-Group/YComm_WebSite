import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../../lib/server-api';
import { LikeButton, ReplyForm } from '../../../../components/forum-form';

export const metadata: Metadata = { title: '主题' };
export const dynamic = 'force-dynamic';

interface Topic {
  id: string;
  title: string;
  is_locked: boolean;
  reply_count: number;
  view_count: number;
  created_at: string;
}

interface Post {
  id: string;
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
          <Link href={`/forum/${slug}`}>← 返回版块</Link>
        </p>
        <p style={{ color: '#dc2626' }}>主题不存在或不可见：{result.status === 401 ? '请先登录' : ''}</p>
      </div>
    );
  }

  const posts: Post[] = result.data?.posts ?? [];
  const liked = result.data?.likedPostIds ?? [];

  return (
    <div>
      <p>
        <Link href={`/forum/${slug}`}>← 返回版块</Link>
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>{topic.title}</h1>
      <p style={{ color: '#71717a', marginTop: 0, fontSize: '0.85rem' }}>
        {topic.reply_count} 回复 · {topic.view_count} 浏览{topic.is_locked ? ' · 已锁定' : ''}
      </p>

      {posts.map((post) => (
        <div
          key={post.id}
          style={{
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            background: '#fff',
            padding: '0.9rem 1.1rem',
            marginBottom: '0.6rem',
          }}
        >
          <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            #{post.position}· {post.authorDisplayName ?? '访客'} ·{' '}
            {new Date(post.created_at).toLocaleString('zh-CN')}
            {post.edited_at ? ' · 已编辑' : ''}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{post.content_md}</div>
          <div style={{ marginTop: '0.5rem' }}>
            <LikeButton postId={post.id} initialLiked={liked.includes(post.id)} />
          </div>
        </div>
      ))}

      {topic.is_locked ? (
        <p style={{ color: '#71717a' }}>主题已锁定，无法回复。</p>
      ) : (
        <div style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.05rem' }}>回复</h2>
          <ReplyForm topicId={topic.id} />
        </div>
      )}
    </div>
  );
}