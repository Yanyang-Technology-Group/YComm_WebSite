'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface NotificationActorView {
  id: string | null;
  username: string | null;
  displayName: string | null;
}

export interface NotificationGroupView {
  key: string;
  kind: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isAdmin: boolean;
  count: number;
  unreadCount: number;
  latestAt: string;
  actors: NotificationActorView[];
}

const AGGREGATABLE = new Set(['like', 'share', 'view', 'reply']);

function iconFor(kind: string): string {
  if (kind === 'like') return '♥';
  if (kind === 'share') return '↗';
  if (kind === 'view') return '◉';
  if (kind === 'reply') return '💬';
  if (kind === 'admin.sanction') return '⚠';
  if (kind.startsWith('admin.')) return '🛠';
  return '📣';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/** 聚合条目标题：多条时显示「N 人…」。 */
function groupTitle(group: NotificationGroupView): string {
  if (group.count <= 1) return group.title;
  if (group.kind === 'like') return `${group.count} 人赞了你的帖子`;
  if (group.kind === 'share') return `${group.count} 人分享了你的帖子`;
  if (group.kind === 'reply') return `${group.count} 人回复了你的主题`;
  if (group.kind === 'view') return `你的主题被浏览了 ${group.count} 次`;
  return group.title;
}

/**
 * 站内通知列表：点赞/分享/浏览/回复按主题聚合，可展开看是谁；
 * 管理员/站长操作淡橙底；未读有红点，点条目标已读并跳转。
 */
export function NotificationList({
  compact = false,
  onNavigate,
  onUnreadChange,
}: {
  /** 紧凑模式（论坛右栏）：标题行小一点。 */
  compact?: boolean;
  onNavigate?: () => void;
  onUnreadChange?: (count: number) => void;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState<NotificationGroupView[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void apiFetch<{ groups: NotificationGroupView[] }>('/api/notifications')
      .then((result) => {
        if (!active) return;
        setGroups(result.groups);
        setSignedIn(true);
        const unread = result.groups.reduce((sum, group) => sum + group.unreadCount, 0);
        onUnreadChange?.(unread);
      })
      .catch(() => {
        if (!active) return;
        setSignedIn(false);
        setGroups([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function markRead(key: string, linkUrl: string | null) {
    const next = groups?.map((group) =>
      group.key === key ? { ...group, unreadCount: 0, count: group.count } : group,
    );
    setGroups(next ?? null);
    onUnreadChange?.(
      (next ?? []).reduce((sum, group) => sum + group.unreadCount, 0),
    );
    try {
      await apiFetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [key] }),
      });
    } catch {
      /* 忽略失败 */
    }
    if (linkUrl) {
      onNavigate?.();
      router.push(linkUrl);
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });
  }

  if (signedIn === false) {
    return (
      <p className="notif-empty">
        登录后在这里查看点赞、分享、浏览与管理员操作通知。
      </p>
    );
  }
  if (groups === null) {
    return (
      <div className="loading-center" style={{ padding: '1rem 0' }}>
        <div className="loading-ring">
          <span className="loading-icon" style={{ background: 'var(--accent-strong)', borderRadius: 999 }} />
        </div>
      </div>
    );
  }
  if (groups.length === 0) {
    return <p className="notif-empty">还没有通知。</p>;
  }

  return (
    <div className={`notif-list${compact ? ' notif-list-compact' : ''}`}>
      {groups.map((group) => {
        const isAggregated = group.count > 1 && AGGREGATABLE.has(group.kind);
        const isOpen = expanded.has(group.key);
        return (
          <div
            key={group.key}
            className={`notif-group${group.isAdmin ? ' notif-admin' : ''}${group.unreadCount > 0 ? ' unread' : ''}`}
          >
            <div className="notif-row">
              <button
                type="button"
                className="notif-main"
                onClick={() => void markRead(group.key, group.linkUrl)}
                title={group.linkUrl ?? '标记已读'}
              >
                <span className="notif-icon" aria-hidden="true">
                  {iconFor(group.kind)}
                </span>
                <span className="notif-text">
                  <span className="notif-title">{groupTitle(group)}</span>
                  {group.body && <span className="notif-body">{group.body}</span>}
                  <span className="notif-meta">
                    {relativeTime(group.latestAt)}
                    {group.isAdmin && <span className="notif-admin-tag">管理员操作</span>}
                  </span>
                </span>
                {group.unreadCount > 0 && <span className="notif-dot" aria-label="未读" />}
              </button>
              {isAggregated && (
                <button
                  type="button"
                  className="notif-expand"
                  onClick={() => toggleExpand(group.key)}
                  title={isOpen ? '收起' : `查看谁（${group.count} 人）`}
                >
                  {isOpen ? '▸' : '▾'}
                </button>
              )}
            </div>
            {isAggregated && isOpen && (
              <div className="notif-actors">
                {group.actors.map((actor) => (
                  <button
                    key={actor.id ?? actor.username ?? actor.displayName ?? 'x'}
                    type="button"
                    className="notif-actor"
                    onClick={() => {
                      if (actor.username) {
                        onNavigate?.();
                        router.push(`/users/${encodeURIComponent(actor.username)}`);
                      }
                    }}
                  >
                    {actor.displayName ?? actor.username ?? '已注销用户'}
                    <span className="muted" style={{ fontSize: '0.75rem' }}>
                      {' '}
                      {actor.username ? `@${actor.username}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}