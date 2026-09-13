'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NAV_ITEMS } from '@ycomm/config';

/**
 * 顶部导航：需要登录的项（控制台/管理）用客户端直连 `/api/auth/me` 判定，
 * 和 SessionNav 同一套数据源，登录/登出后立即一致（不依赖服务端渲染状态）。
 */
export function SiteNav() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me')
      .then((response) => response.ok)
      .then((ok) => {
        if (active) setSignedIn(ok);
      })
      .catch(() => {
        if (active) setSignedIn(false);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <nav className="site-nav">
      {NAV_ITEMS.map((item) =>
        item.requiresAuth && signedIn !== true ? null : (
          <Link key={item.href} href={item.href} className="nav-link">
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}