import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { UsersPanel, type AdminUser } from '../../../components/admin-panels';

export const metadata: Metadata = { title: '用户管理' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const result = await apiGet<{ users: AdminUser[]; total: number }>('/api/admin/users');

  if (!result.ok) {
    return (
      <div>
        <h1>用户管理</h1>
        <p style={{ color: '#dc2626' }}>没有权限访问（仅管理员/站长）。</p>
      </div>
    );
  }

  return (
    <div>
      <h1>用户管理</h1>
      <UsersPanel initial={{ users: result.data?.users ?? [], total: result.data?.total ?? 0 }} />
    </div>
  );
}