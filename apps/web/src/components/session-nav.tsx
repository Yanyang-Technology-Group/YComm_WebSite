'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSession } from '../lib/session';
import { LogoutButton } from './logout-button';

/**
 * 头部登录状态（经 getSession 去重缓存，整页只请求一次 /me）：
 * 未登录 → 登录 / 注册；已登录 → 最右侧「控制台」按钮 + 退出。
 */
export function SessionNav() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);

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

  return (
    <>
      <Link href="/dashboard" className="nav-console" title="进入控制台">
        <span className="nav-avatar-initial">{user.username.slice(0, 1).toUpperCase()}</span>
        <span>控制台</span>
      </Link>
      <LogoutButton />
    </>
  );
}
