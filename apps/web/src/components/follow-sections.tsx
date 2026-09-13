'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface FollowedUser {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: 'member' | 'admin' | 'owner';
  level: number;
  bio: string;
  followsViewer: boolean;
}

type Kind = 'following' | 'followers';

/**
 * 关注 / 粉丝列表（按所有者设置的可见度决定能否查看）。
 * public 所有人可见；mutual 仅互关；private 仅本人。
 */
export function FollowSections({
  username,
  initialVisible,
  followerCount,
  followingCount,
  isSelf,
}: {
  username: string;
  initialVisible: boolean;
  followerCount: number;
  followingCount: number;
  isSelf: boolean;
}) {
  const [kind, setKind] = useState<Kind>('following');
  const [items, setItems] = useState<FollowedUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!initialVisible || forbidden) return;
    setLoading(true);
    setItems(null);
    void apiFetch<{ items: FollowedUser[] }>(`/api/users/${encodeURIComponent(username)}/${kind}`)
      .then((data) => {
        setItems(data.items);
        setForbidden(false);
      })
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, [kind, username, initialVisible, forbidden]);

  const counts: Record<Kind, number> = { following: followingCount, followers: followerCount };

  return (
    <div className="panel" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {(['following', 'followers'] as Kind[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setKind(key);
              setForbidden(false);
            }}
            style={{
              fontWeight: kind === key ? 700 : 400,
              color: kind === key ? 'var(--accent-strong)' : undefined,
              cursor: 'pointer',
            }}
          >
            {key === 'following' ? '关注' : '粉丝'} {counts[key]}
          </button>
        ))}
        {!isSelf && (
          <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
            列表可见度由用户自己设置
          </span>
        )}
      </div>

      {!initialVisible ? (
        <p className="muted" style={{ margin: '0.75rem 0 0' }}>
          对方将{kind === 'following' ? '关注' : '粉丝'}列表设置为仅自己/互关可见，当前不可查看。
        </p>
      ) : loading ? (
        <p className="muted" style={{ margin: '0.75rem 0 0' }}>加载中…</p>
      ) : forbidden ? (
        <p className="muted" style={{ margin: '0.75rem 0 0' }}>
          列表不可见（对方设置了可见度）。
        </p>
      ) : items === null ? null : items.length === 0 ? (
        <p className="muted" style={{ margin: '0.75rem 0 0' }}>还没有人。</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.75rem' }}>
          {items.map((user) => (
            <Link
              key={user.id}
              href={`/users/${encodeURIComponent(user.username)}`}
              className="topic-block-post"
              style={{ alignItems: 'center', gap: '0.6rem' }}
            >
              {user.avatarPath ? (
                <img src={user.avatarPath} alt={user.displayName} className="avatar avatar-sm" loading="lazy" />
              ) : (
                <span className="avatar avatar-sm avatar-fallback">
                  {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                </span>
              )}
              <span>
                <strong>{user.displayName || user.username}</strong>
                <span className="muted" style={{ marginLeft: '0.4rem' }}>
                  @{user.username}
                </span>
                {user.followsViewer && <span className="muted" style={{ marginLeft: '0.4rem' }}>· 回关你</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}