import Link from 'next/link';
import type { Metadata } from 'next';
import { BannedWordsPanel, InviteCodesPanel } from '../../components/admin-panels';
import { CardsPanel } from '../../components/card-editor';

export const metadata: Metadata = { title: '管理后台' };
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>管理后台</h1>
      <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 480 }}>
        <Link href="/admin/users" style={cardStyle}>
          用户管理（角色 / 封禁 / 禁言）
        </Link>
        <Link href="/admin/boards" style={cardStyle}>
          版块管理（新增 / 删除 / 访问设置）
        </Link>
        <Link href="/admin/moderation" style={cardStyle}>
          审核队列（论坛内容 / 下载资源 / 失效链接）
        </Link>
        <Link href="/admin/resources" style={cardStyle}>
          资源管理（发布上传 / 状态查看）
        </Link>
      </div>
      <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
        <CardsPanel />
        <InviteCodesPanel />
        <BannedWordsPanel />
      </div>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '1.5rem' }}>
        提示：资源审核与失效链接处理统一走“审核队列”，站长执行最终审批。
      </p>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'block',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  padding: '0.9rem 1.1rem',
  color: 'var(--text)',
  textDecoration: 'none',
};