import Link from 'next/link';
import type { Metadata } from 'next';
import { BannedWordsPanel, InviteCodesPanel } from '../../components/admin-panels';
import { CardsPanel } from '../../components/card-editor';

export const metadata: Metadata = { title: '管理后台' };
export const dynamic = 'force-dynamic';

const MENU = [
  { href: '/admin/users', title: '用户管理', desc: '角色授予 / 封禁 / 禁言 / 注销' },
  { href: '/admin/boards', title: '版块管理', desc: '新增版块 / 删除归档 / 访问设置' },
  { href: '/admin/moderation', title: '审核队列', desc: '论坛内容 / 下载资源 / 失效链接' },
  { href: '/admin/resources', title: '资源管理', desc: '发布上传 / 状态查看' },
] as const;

export default function AdminPage() {
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>管理后台</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        站务入口与快捷设置
      </p>

      <section>
        {MENU.map((item) => (
          <Link key={item.href} href={item.href} className="admin-menu-row">
            <span className="admin-menu-title">{item.title}</span>
            <span className="admin-menu-desc">{item.desc}</span>
            <span className="admin-menu-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </section>

      <h2 className="section-title" style={{ marginTop: '2.25rem' }}>
        快捷设置
      </h2>
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <CardsPanel />
        <InviteCodesPanel />
        <BannedWordsPanel />
      </div>

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        提示：资源审核与失效链接处理统一走「审核队列」，由站长执行最终审批。
      </p>
    </div>
  );
}