'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { getSession } from '../lib/session';

/**
 * 全站唯一的左侧导航：控制台（个人）与管理合在一套里，所有带侧栏的页面共用。
 * - 电脑端：贴左、加宽、常驻（sticky）
 * - 手机端：顶部横向滚动的标签条
 * 激活态按当前路由 + `?section=` 判断，控制台与 /admin/* 互不干扰。
 */

const PERSONAL_LINKS = [
  { section: 'profile', href: '/dashboard', label: '个人资料' },
  { section: 'content', href: '/dashboard?section=content', label: '我的内容' },
  { section: 'security', href: '/dashboard?section=security', label: '账号安全' },
  { section: 'appearance', href: '/dashboard?section=appearance', label: '外观主题' },
] as const;

const ADMIN_LINKS = [
  { href: '/admin', label: '管理后台' },
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/boards', label: '版块管理' },
  { href: '/admin/cards', label: '下载区卡片' },
  { href: '/admin/moderation', label: '审核队列' },
  { href: '/admin/audit', label: '操作日志' },
  { href: '/admin/settings', label: '违禁词与注册码' },
] as const;

export function AppNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [staff, setStaff] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSession().then((user) => {
      if (!active || !user) return;
      setStaff(user.role === 'admin' || user.role === 'owner');
      setUsername(user.username);
    });
    return () => {
      active = false;
    };
  }, []);

  const section = search.get('section') ?? 'profile';
  const onDashboard = pathname === '/dashboard';

  return (
    <aside className="app-nav">
      <div className="app-nav-group">
        <p className="app-nav-title">个人</p>
        {PERSONAL_LINKS.map((link) => (
          <Link
            key={link.section}
            href={link.href}
            className={`app-nav-link${onDashboard && section === link.section ? ' active' : ''}`}
          >
            {link.label}
          </Link>
        ))}
        {username && (
          <Link href={`/users/${encodeURIComponent(username)}`} className="app-nav-link">
            我的主页
          </Link>
        )}
      </div>

      {staff && (
        <div className="app-nav-group">
          <p className="app-nav-title">管理</p>
          {ADMIN_LINKS.map((link) => {
            // 管理后台首页只在 /admin 精确命中时高亮，其他子页各自高亮。
            const active = link.href === '/admin' ? pathname === '/admin' : pathname === link.href;
            return (
              <Link key={link.href} href={link.href} className={`app-nav-link${active ? ' active' : ''}`}>
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}