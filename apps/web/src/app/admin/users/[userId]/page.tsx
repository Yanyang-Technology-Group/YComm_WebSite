import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../../lib/server-api';
import { PageBack } from '../../../../components/page-back';
import type { AdminUser } from '../../../../components/admin-panels';

export const metadata: Metadata = { title: '用户详情' };
export const dynamic = 'force-dynamic';

const ROLE_META: Record<string, { label: string; className: string }> = {
  member: { label: '成员', className: 'badge-role-member' },
  admin: { label: '管理员', className: 'badge-role-admin' },
  owner: { label: '站长', className: 'badge-role-owner' },
};

const STATE_META: Record<string, { label: string; className: string }> = {
  active: { label: '正常', className: 'badge-state-active' },
  unverified: { label: '未验证邮箱', className: 'badge-state-unverified' },
  muted: { label: '禁言中', className: 'badge-state-muted' },
  banned: { label: '封禁中', className: 'badge-state-banned' },
  deleting: { label: '注销确认中', className: 'badge-state-deleted' },
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const result = await apiGet<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(userId)}`);
  if (!result.ok || !result.data?.user) {
    if (result.status === 404) notFound();
    return (
      <div>
        <PageBack fallback="/admin/users" label="返回用户管理" />
        <h1>无法查看用户详情</h1>
        <p style={{ color: '#dc2626' }}>没有权限访问，或用户不存在。</p>
      </div>
    );
  }

  const user = result.data.user;
  const role = ROLE_META[user.role] ?? { label: user.role, className: 'badge-neutral' };
  const state = STATE_META[user.state] ?? { label: user.state, className: 'badge-neutral' };

  return (
    <div>
      <PageBack fallback="/admin/users" label="返回用户管理" />
      <h1>用户详情</h1>
      <section className="panel" style={{ padding: '1.25rem', maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          {user.avatarPath ? (
            <img src={user.avatarPath} alt={user.username} className="avatar" style={{ width: 64, height: 64 }} />
          ) : (
            <span className="avatar avatar-fallback" style={{ width: 64, height: 64, fontSize: '1.4rem' }}>
              {(user.displayName || user.username).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <h2 style={{ margin: 0 }}>{user.displayName || user.username}</h2>
            <p className="muted" style={{ margin: '0.2rem 0 0' }}>@{user.username}</p>
          </div>
        </div>
        <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.95rem' }}>
          <DetailRow label="邮箱">{user.email}</DetailRow>
          <DetailRow label="出生日期">{user.birthDate ?? '未填写（历史账号）'}</DetailRow>
          <DetailRow label="GitHub">
            {user.githubUsername ? (
              <a href={`https://github.com/${encodeURIComponent(user.githubUsername)}`} target="_blank" rel="noopener noreferrer" className="uname">
                @{user.githubUsername} ↗
              </a>
            ) : '未绑定'}
          </DetailRow>
          <DetailRow label="注册时间">{new Date(user.createdAt).toLocaleString('zh-CN')}</DetailRow>
          <DetailRow label="最后登录">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '未记录'}</DetailRow>
          <DetailRow label="目前状态"><span className={`badge ${state.className}`}>{state.label}</span></DetailRow>
          <DetailRow label="权限"><span className={`badge ${role.className}`}>{role.label}</span></DetailRow>
          <DetailRow label="等级">Lv{user.level}</DetailRow>
          <DetailRow label="使用的注册码">{user.inviteCodeUsed ?? '无'}</DetailRow>
          <DetailRow label="发帖 / 获赞">{user.postCount ?? 0} 帖 · {user.likeReceivedCount ?? 0} 赞</DetailRow>
        </div>
      </section>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
      <span className="muted" style={{ flexShrink: 0, width: 100 }}>{label}</span>
      <span style={{ minWidth: 0, wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}
