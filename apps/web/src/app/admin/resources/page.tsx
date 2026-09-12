import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { ResourcesPanel, type AdminResource } from '../../../components/admin-panels';

export const metadata: Metadata = { title: '资源管理' };
export const dynamic = 'force-dynamic';

export default async function AdminResourcesPage() {
  // Sequential: see apps/web/src/app/downloads/page.tsx (PGlite dev quirk).
  const categoriesResult = await apiGet<{ categories: { slug: string; name: string }[] }>(
    '/api/downloads/categories',
  );
  const resourcesResult = await apiGet<{ resources: AdminResource[] }>('/api/admin/resources');

  if (!categoriesResult.ok || !resourcesResult.ok) {
    return (
      <div>
        <h1>资源管理</h1>
        <p style={{ color: '#dc2626' }}>没有权限访问（仅管理员/站长）。</p>
      </div>
    );
  }

  return (
    <div>
      <h1>资源管理</h1>
      <ResourcesPanel
        categories={categoriesResult.data?.categories ?? []}
        initial={{ resources: resourcesResult.data?.resources ?? [] }}
      />
    </div>
  );
}