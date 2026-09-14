import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../../lib/server-api';
import {
  DeletePostButton,
  DeleteTopicButton,
  LikeButton,
  ReplyForm,
  ShareButton,
} from '../../../../components/forum-form';
import { AuthorSanctions } from '../../../../components/author-sanctions';
import { MarkdownContent } from '../../../../components/markdown-content';
import { PageBack } from '../../../../components/page-back';

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
  authorAvatarPath: string | null;
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
        <PageBack fallback={`/forum/${slug}`} label="返回版块" />
        <p className="muted">主题不存在或不可见{result.status === 401 ? '：请先登录' : ''}</p>
      </div>
    );
  }

  const posts: Post[] = result.data?.posts ?? [];
  const liked = result.data?.likedPostIds ?? [];

  return (
    <div className="topic-page">
      <PageBack fallback={`/forum/${slug}`} label="返回版块" />

      {/* 楼主区：主题标题下直接放楼主内容（头像与名字在内容左下角） */}
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
          {/* 内容在上 */}
          <MarkdownContent text={post.content_md} />

          {/* 底部一行：左 = 头像 + 名字（楼主徽章）；右 = 点赞/转发/管理按钮 */}
          <div className="post-footer">
            <div className="post-author">
              {post.authorUsername ? (
                <Link href={`/users/${encodeURIComponent(post.authorUsername)}`}>
                  {post.authorAvatarPath ? (
                    <img
                      src={post.authorAvatarPath}
                      alt={post.authorDisplayName ?? '访客'}
                      className="avatar"
                      loading="lazy"
                    />
                  ) : (
                    <span className="avatar avatar-fallback">
                      {(post.authorDisplayName ?? '访客').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </Link>
              ) : post.authorAvatarPath ? (
                <img
                  src={post.authorAvatarPath}
                  alt={post.authorDisplayName ?? '访客'}
                  className="avatar"
                  loading="lazy"
                />
              ) : (
                <span className="avatar avatar-fallback">
                  {(post.authorDisplayName ?? '访客').slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="post-author-name">
                {post.authorUsername ? (
                  <Link
                    className="uname"
                    href={`/users/${encodeURIComponent(post.authorUsername)}`}
                  >
                    {post.authorDisplayName ?? post.authorUsername}
                  </Link>
                ) : (
                  <span className="uname">{post.authorDisplayName ?? '访客'}</span>
                )}
                {post.position === 1 && <span className="badge badge-role-owner">楼主</span>}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {post.position > 1 ? `#${post.position}` : ''} ·{' '}
                  {new Date(post.created_at).toLocaleString('zh-CN')}
                  {post.edited_at ? ' · 已编辑' : ''}
                </span>
              </span>
            </div>

            <div className="post-actions">
              <LikeButton postId={post.id} initialLiked={liked.includes(post.id)} />
              <ShareButton />
              <DeletePostButton postId={post.id} authorId={post.author_id} />
            </div>

            {/* 封禁/禁言统一放在帖子最底部管理行 */}
            <div className="post-manage">
              <AuthorSanctions
                userId={post.author_id}
                username={post.authorUsername}
                displayName={post.authorDisplayName}
              />
            </div>
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
