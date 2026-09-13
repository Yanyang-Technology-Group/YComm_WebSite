'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NAV_ITEMS } from '@ycomm/config';

/**
 * 顶部导航：登录态用客户端直连 /api/auth/me 判定。
 * 桌面端横排；小屏（<=760px）折成「三横杠」汉堡菜单。
 */
export function SiteNav() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

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

  // 路由变化时收起汉堡菜单
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const items = NAV_ITEMS.filter((item) => !item.requiresAuth || signedIn === true);

  return (
    <>
      <button
        type="button"
        className="nav-burger"
        onClick={() => setOpen((value) => !value)}
        aria-label="菜单"
        aria-expanded={open}
      >
        <span className="nav-burger-lines" aria-hidden="true" />
      </button>

      {open && (
        <div className="nav-drawer">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="nav-drawer-link">
              {item.label}
            </Link>
          ))}
        </div>
      )}

      <nav className="site-nav">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="nav-link">
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}