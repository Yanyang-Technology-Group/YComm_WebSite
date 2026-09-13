'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ADMIN_LINKS = [
  { href: '/admin/users', label: '用户管理' },
  { href: '/admin/boards', label: '版块管理' },
  { href: '/admin/moderation', label: '审核队列' },
  { href: '/admin/resources', label: '资源管理' },
] as const;

/**
 * 管理区左侧导航：进入管理页后仍然保留左侧栏，和控制台一致的视觉。
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <aside className="dashboard-nav">
      <div className="dashboard-nav-group">
        <p className="dashboard-nav-title">管理</p>
        {ADMIN_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`dashboard-nav-link${pathname === item.href ? ' active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div className="dashboard-nav-group">
        <p className="dashboard-nav-title">个人</p>
        <Link href="/dashboard" className="dashboard-nav-link">
          返回控制台
        </Link>
      </div>
    </aside>
  );
}
