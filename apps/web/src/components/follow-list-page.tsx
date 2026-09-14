'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { PageBack } from './page-back';

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

/**
 * 单独的关注/粉丝列表页（按所有者设置的可见度决定能否查看）。
 * public 所有人可见；mutual 仅互关；private 仅本人。
 */
export function FollowListPage({
  username,
  kind,
  visible,
}: {
  username: string;
  kind: 'following' | 'followers';
  visible: boolean;
}) {
  const [items, setItems] = useState<FollowedUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const kindLabel = kind === 'following' ? '关注' : '粉丝';

  useEffect(() => {
    if (!visible || forbidden) return;
    setLoading(true);
    setItems(null);
    void apiFetch<{ items: FollowedUser[] }>(`/api/users/${encodeURIComponent(username)}/${kind}`)
      .then((data) => {
        setItems(data.items);
        setForbidden(false);
      })
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, [kind, username, visible, forbidden]);

  return (
    <div>
      <PageBack fallback={`/users/${encodeURIComponent(username)}`} label="返回主页" />
      <h1 className="page-title">{kindLabel}列表</h1>
      {!visible ? (
        <p className="muted">
          对方将{kindLabel}列表设置为仅自己/互关可见，当前不可查看。
        </p>
      ) : loading ? (
        <div className="loading-center">
          <div className="loading-ring">
            <span className="loading-icon" style={{ background: 'var(--accent-strong)', borderRadius: 999 }} />
          </div>
          <p className="muted" style={{ margin: 0 }}>加载中…</p>
        </div>
      ) : forbidden ? (
        <p className="muted">列表不可见（对方设置了可见度）。</p>
      ) : items === null ? null : items.length === 0 ? (
        <p className="muted">还没有人。</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {items.map((user) => (
            <div key={user.id} className="panel" style={{ padding: '0.7rem 0.9rem', marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              {user.avatarPath ? (
                <Link href={`/users/${encodeURIComponent(user.username)}`}>
                  <img src={user.avatarPath} alt={user.displayName} className="avatar avatar-sm" loading="lazy" />
                </Link>
              ) : (
                <Link href={`/users/${encodeURIComponent(user.username)}`}>
                  <span className="avatar avatar-sm avatar-fallback">
                    {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                  </span>
                </Link>
              )}
              <span style={{ minWidth: 0 }}>
                <Link className="uname" href={`/users/${encodeURIComponent(user.username)}`}>
                  {user.displayName || user.username}
                </Link>
                <span className="muted" style={{ fontSize: '0.82rem' }}>
                  {' '}
                  @{user.username}
                  {user.followsViewer ? ' · 回关你' : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}