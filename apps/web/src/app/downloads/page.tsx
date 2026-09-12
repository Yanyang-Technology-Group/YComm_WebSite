import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../lib/server-api';

export const metadata: Metadata = { title: '下载区' };
export const dynamic = 'force-dynamic';

interface Category {
  slug: string;
  name: string;
  description: string;
}

interface Resource {
  id: string;
  title: string;
  summary: string;
  versionLabel: string | null;
  sourceType: string;
  downloadCount: number;
  publishedAt: string | null;
}

export default async function DownloadsPage() {
  // Sequential on purpose: PGlite (zero-install dev driver) is fragile under
  // concurrent query bursts; production Postgres pool is concurrency-safe.
  const categoriesResult = await apiGet<{ categories: Category[] }>('/api/downloads/categories');
  const resourcesResult = await apiGet<{ resources: Resource[]; total: number }>('/api/downloads/resources');

  const categories: Category[] = categoriesResult.data?.categories ?? [];
  const resources: Resource[] = resourcesResult.data?.resources ?? [];

  return (
    <div>
      <h1>下载区</h1>
      {(!categoriesResult.ok || !resourcesResult.ok) && (
        <p style={{ color: '#dc2626' }}>请登录后查看下载区（或稍后再试）</p>
      )}

      <p style={{ color: '#71717a' }}>
        分类：{categories.map((category) => category.name).join(' · ') || '无'}
      </p>

      <h2 style={{ fontSize: '1.05rem' }}>资源</h2>
      {resources.length === 0 && <p style={{ color: '#71717a' }}>暂无已发布资源。</p>}
      {resources.map((resource) => (
        <Link
          key={resource.id}
          href={`/downloads/${resource.id}`}
          style={{
            display: 'block',
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            background: '#fff',
            padding: '0.75rem 1rem',
            marginBottom: '0.5rem',
            color: '#1c1c1e',
            textDecoration: 'none',
          }}
        >
          <strong>{resource.title}</strong>
          {resource.versionLabel && (
            <span style={{ marginLeft: '0.5rem', color: '#2563eb', fontSize: '0.85rem' }}>
              v{resource.versionLabel}
            </span>
          )}
          {resource.summary && (
            <div style={{ color: '#52525b', fontSize: '0.9rem' }}>{resource.summary}</div>
          )}
          <div style={{ color: '#71717a', fontSize: '0.8rem' }}>
            {resource.sourceType === 'external' ? '外链' : '本站文件'} · 下载 {resource.downloadCount} 次
          </div>
        </Link>
      ))}
    </div>
  );
}