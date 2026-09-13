'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogoutButton } from './logout-button';

interface MePayload {
  user?: { username: string; role: string } | null;
}

/**
 * 头部登录状态：直连 `/api/auth/me`（浏览器自动带上会话 cookie），
 * 路由变化时重新拉取——登录/登出后状态一定和真实会话一致。
 */
export function SessionNav() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me')
      .then((response) => (response.ok ? (response.json() as Promise<MePayload>) : null))
      .then((json) => {
        if (active) setUser(json?.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

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

  // 已登录：隐藏登录/注册，换成最右侧的头像图标（点击进控制台 /dashboard）
  return (
    <>
      <Link href="/dashboard" className="nav-avatar" title="控制台" aria-label="控制台">
        <span className="nav-avatar-initial">{user.username.slice(0, 1).toUpperCase()}</span>
      </Link>
      <LogoutButton />
    </>
  );
}