import type { Metadata } from 'next';
import { AdminNav } from '../../components/admin-nav';

export const metadata: Metadata = { title: '管理' };
export const dynamic = 'force-dynamic';

/**
 * 管理区外壳：左侧导航 + 右侧内容。
 * 从控制台点进管理页后，左侧栏依然在（与控制台同一套样式）。
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-layout">
      <AdminNav />
      <div className="dashboard-content">{children}</div>
    </div>
  );
}
