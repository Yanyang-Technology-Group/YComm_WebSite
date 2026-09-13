import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '管理后台' };
export const dynamic = 'force-dynamic';

const MENU = [
  { href: '/admin/users', title: '用户管理', desc: '角色授予 / 封禁 / 禁言 / 注销' },
  { href: '/admin/boards', title: '版块管理', desc: '新增版块 / 删除归档 / 访问设置' },
  { href: '/admin/cards', title: '下载区卡片', desc: '无限套娃 / 可见度 / 拖拽尺寸' },
  { href: '/admin/moderation', title: '审核队列', desc: '论坛内容 / 下载资源 / 失效链接' },
  { href: '/admin/resources', title: '资源管理', desc: '发布上传 / 状态查看' },
  { href: '/admin/audit', title: '操作日志', desc: '管理员做了什么，全部留痕' },
  { href: '/admin/settings', title: '违禁词与注册码', desc: '违禁词拦截 / 注册码创建' },
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

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        提示：卡片套娃/可见度在「下载区卡片」，违禁词与注册码在「违禁词与注册码」；左侧栏随时可切换。
      </p>
    </div>
  );
}