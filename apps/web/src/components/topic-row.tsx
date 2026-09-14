'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * 主题行（客户端组件）：
 * - 整行点击进主题；
 * - 作者/回复的头像与用户名可单独点进主页（stopPropagation 不误触整行）；
 * - 用户名统一高亮（粗体加大）。
 */

interface PreviewPost {
  contentExcerpt: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatarPath: string | null;
  likeCount: number;
}

export interface TopicRowData {
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

function excerpt(text: string): string {
  const oneLine = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;
}

function Avatar({ path, name, small = false }: { path: string | null; name: string | null; small?: boolean }) {
  const cls = small ? 'avatar avatar-sm' : 'avatar';
  return path ? (
    <img src={path} alt={name ?? '访客'} className={cls} loading="lazy" />
  ) : (
    <span className={`${cls} avatar-fallback`}>{(name ?? '访客').slice(0, 1).toUpperCase()}</span>
  );
}

export function TopicRow({ topic, slug }: { topic: TopicRowData; slug: string }) {
  const router = useRouter();

  function openTopic() {
    router.push(`/forum/${slug}/${topic.id}`);
  }

  /** 头像 + 名字都指向主页（有用户名时）。 */
  function ProfileChip({
    username,
    displayName,
    avatarPath,
    small,
    labelOnly,
  }: {
    username: string | null;
    displayName: string | null;
    avatarPath: string | null;
    small?: boolean;
    labelOnly?: boolean;
  }) {
    if (!username) {
      return (
        <>
          {!labelOnly && <Avatar path={avatarPath} name={displayName} small={small} />}
          <span className="uname">{displayName ?? '访客'}</span>
        </>
      );
    }
    const href = `/users/${encodeURIComponent(username)}`;
    return (
      <>
        {!labelOnly && (
          <Link href={href} onClick={(event) => event.stopPropagation()} aria-label={displayName ?? username}>
            <Avatar path={avatarPath} name={displayName} small={small} />
          </Link>
        )}
        <Link
          href={href}
          className="uname"
          onClick={(event) => event.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
        >
          {displayName ?? username}
        </Link>
      </>
    );
  }

  return (
    <div className="topic-block" onClick={openTopic} role="link" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter') openTopic();
    }}>
      {/* 发布者头像 + 名字（点进主页）在标题上方 */}
      {topic.preview.firstPost && (
        <div className="topic-block-post topic-block-author-row">
          <ProfileChip
            username={topic.preview.firstPost.authorUsername}
            displayName={topic.preview.firstPost.authorDisplayName}
            avatarPath={topic.preview.firstPost.authorAvatarPath}
            small
          />
        </div>
      )}

      <div className="topic-block-title">
        {topic.is_pinned && '📌 '}
        {topic.is_locked && '🔒 '}
        {topic.title}
      </div>

      {topic.preview.firstPost && (
        <div className="topic-block-text">{excerpt(topic.preview.firstPost.contentExcerpt)}</div>
      )}

      {topic.preview.topReplies.map((reply, index) => (
        <div key={index} className="topic-block-post topic-block-reply">
          <span className="topic-block-likes">♥ {reply.likeCount}</span>
          <ProfileChip
            username={reply.authorUsername}
            displayName={reply.authorDisplayName}
            avatarPath={reply.authorAvatarPath}
            small
          />
          <span className="topic-block-text">{excerpt(reply.contentExcerpt)}</span>
        </div>
      ))}

      <div className="topic-block-meta muted">
        <ProfileChip
          username={topic.authorUsername}
          displayName={topic.authorDisplayName}
          avatarPath={null}
          small
          labelOnly
        />{' '}
        发帖 · {topic.reply_count} 回复 · {topic.view_count} 浏览
      </div>
    </div>
  );
}