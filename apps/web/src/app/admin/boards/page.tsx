import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { BoardManager } from '../../../components/board-manager';

export const metadata: Metadata = { title: '版块管理' };
export const dynamic = 'force-dynamic';

export default async function AdminBoardsPage() {
  const result = await apiGet('/api/admin/boards');

  if (!result.ok) {
    return (
      <div>
        <h1>版块管理</h1>
        <p style={{ color: '#dc2626' }}>没有权限访问（仅管理员/站长）。</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>版块管理</h1>
      <BoardManager />
    </div>
  );
}