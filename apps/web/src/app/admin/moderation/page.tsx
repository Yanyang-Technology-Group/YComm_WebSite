import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { ModerationPanel, type ModerationItem } from '../../../components/admin-panels';

export const metadata: Metadata = { title: '审核队列' };
export const dynamic = 'force-dynamic';

export default async function AdminModerationPage() {
  const result = await apiGet<{ items: ModerationItem[] }>('/api/admin/moderation');

  if (!result.ok) {
    return (
      <div>
        <h1>审核队列</h1>
        <p style={{ color: '#dc2626' }}>没有权限访问（仅管理员/站长）。</p>
      </div>
    );
  }

  return (
    <div>
      <h1>审核队列</h1>
      <ModerationPanel items={result.data?.items ?? []} />
    </div>
  );
}