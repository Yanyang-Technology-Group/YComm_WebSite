import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { DownloadButton, ReportResourceButton } from '../../../components/download-actions';

export const metadata: Metadata = { title: '资源详情' };
export const dynamic = 'force-dynamic';

interface Resource {
  id: string;
  title: string;
  summary: string;
  descriptionMd: string;
  versionLabel: string | null;
  sourceType: string;
  status: string;
  downloadCount: number;
  publishedAt: string | null;
}

export default async function ResourcePage({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const { resourceId } = await params;
  const result = await apiGet<{ resource: Resource }>(`/api/downloads/resources/${resourceId}`);
  const resource = result.data?.resource;

  if (!resource) {
    return (
      <div>
        <p>
          <Link href="/downloads">← 返回下载区</Link>
        </p>
        <p style={{ color: '#dc2626' }}>资源不存在或不可见。</p>
      </div>
    );
  }

  return (
    <div>
      <p>
        <Link href="/downloads">← 返回下载区</Link>
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>
        {resource.title}
        {resource.versionLabel && <span style={{ color: '#2563eb', fontSize: '1rem' }}> v{resource.versionLabel}</span>}
      </h1>
      {resource.summary && <p style={{ color: '#52525b' }}>{resource.summary}</p>}
      <p style={{ color: '#71717a', fontSize: '0.85rem' }}>
        下载 {resource.downloadCount} 次 · {resource.sourceType === 'external' ? '外链资源' : '本站文件'}
      </p>

      {resource.descriptionMd && (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            background: '#fff',
            padding: '1rem',
            margin: '1rem 0',
          }}
        >
          {resource.descriptionMd}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', margin: '1rem 0' }}>
        <DownloadButton resourceId={resource.id} />
        <ReportResourceButton resourceId={resource.id} />
      </div>
    </div>
  );
}