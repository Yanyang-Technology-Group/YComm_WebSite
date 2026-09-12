'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * The gated download button. External links answer with a 302 redirect that
 * the fetch silences (`redirect: 'follow'` never exposes the URL to scripts);
 * local files stream straight to the browser.
 */
export function DownloadButton({ resourceId }: { resourceId: string }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    setCode(null);
    try {
      const response = await fetch(`/api/downloads/resources/${resourceId}/go`, { redirect: 'follow' });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } };
        throw new Error(json?.error?.message ?? `下载失败（${response.status}）`);
      }
      // Local file → save stream; external → we only know it succeeded.
      const disposition = response.headers.get('content-disposition');
      if (disposition) {
        const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
        const fileName = match?.[1] ? decodeURIComponent(match[1]) : 'download.bin';
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      // Offer the extract code if the resource has one.
      const codeData = await apiFetch<{ extractCode: string | null }>(
        `/api/downloads/resources/${resourceId}/extract-code`,
      ).catch(() => ({ extractCode: null }));
      setCode(codeData.extractCode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '下载失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.4rem', maxWidth: 480 }}>
      <button type="button" onClick={() => void download()} disabled={busy} style={{ padding: '0.5rem' }}>
        {busy ? '处理中…' : '下载'}
      </button>
      {code && (
        <p style={{ margin: 0 }}>
          网盘提取码：<strong>{code}</strong>
        </p>
      )}
      {error && <p style={{ margin: 0, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}

export function ReportResourceButton({ resourceId }: { resourceId: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function report() {
    setError(null);
    try {
      await apiFetch(`/api/downloads/resources/${resourceId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'dead' }),
      });
      setDone(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '举报失败');
    }
  }

  if (done) return <span style={{ color: '#16a34a' }}>已提交举报，感谢反馈</span>;
  return (
    <span>
      <button type="button" onClick={() => void report()} style={{ cursor: 'pointer' }}>
        链接失效？举报
      </button>
      {error && <span style={{ color: '#dc2626', marginLeft: '0.5rem' }}>{error}</span>}
    </span>
  );
}