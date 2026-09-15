'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSession } from '../lib/session';
import { apiFetch } from '../lib/api';
import { LogoutButton } from './logout-button';
import { NotificationList } from './notification-list';

/**
 * 头部登录状态（经 getSession 去重缓存，整页只请求一次 /me）：
 * 未登录 → 登录 / 注册；已登录 → 铃铛（通知中心 50% 滑出面板）＋
 * 头像（我的主页）＋「控制台」＋退出。
 */
export function SessionNav() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string; avatarPath?: string | null } | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getSession().then((session) => {
      if (!active) return;
      setUser(session);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  // 登录后每 30 秒轮询一次未读数（铃铛红点）。
  useEffect(() => {
    if (!user) return;
    let active = true;
    const poll = () => {
      void apiFetch<{ count: number }>('/api/notifications/unread-count')
        .then((result) => {
          if (active) setUnread(result.count);
        })
        .catch(() => {
          /* 忽略 */
        });
    };
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user]);

  // 路由变化时收起滑出面板。
  useEffect(() => {
    setNotifOpen(false);
  }, [pathname]);

  // 首帧不渲染按钮，避免先闪出「登录/注册」再变成「控制台」
  if (!ready) return null;

  if (!user) {
    return (
      <>
        <Link href="/login" className="nav-auth">
          登录
        </Link>
        <Link href="/register" className="nav-auth nav-auth-strong">
          注册
        </Link>
      </>
    );
  }

  const homeHref = `/users/${encodeURIComponent(user.username)}`;

  return (
    <>
      <button
        type="button"
        className="nav-bell"
        onClick={() => setNotifOpen((value) => !value)}
        title="通知中心"
        aria-label="通知中心"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-dot">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {notifOpen && (
        <div className="notif-slide-backdrop" onClick={() => setNotifOpen(false)}>
          <div className="notif-slide" onClick={(event) => event.stopPropagation()}>
            <div className="notif-slide-head">
              <strong>通知中心</strong>
              <button
                type="button"
                className="notif-slide-close"
                onClick={() => setNotifOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <NotificationList onNavigate={() => setNotifOpen(false)} onUnreadChange={setUnread} />
          </div>
        </div>
      )}

      <Link
        href={homeHref}
        className="nav-console nav-console-avatar"
        title="我的主页"
        aria-label="我的主页"
      >
        {user.avatarPath ? (
          <img src={user.avatarPath} alt={user.username} className="nav-avatar-img" />
        ) : (
          <span className="nav-avatar-initial">{user.username.slice(0, 1).toUpperCase()}</span>
        )}
      </Link>
      <Link href="/dashboard" className="nav-console" title="进入控制台">
        控制台
      </Link>
      <LogoutButton />
    </>
  );
}