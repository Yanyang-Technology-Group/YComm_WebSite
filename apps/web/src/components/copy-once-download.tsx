'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../lib/toast';

export function CopyOnceDownload({ cardId }: { cardId: string }) {
  const [busy, setBusy] = useState(false);

  async function copy() {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/downloads/cards/${cardId}/one-time-links`, { method: 'POST' });
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      showToast('已经复制一次性下载链接，有效时长1小时');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '复制失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="copy-once-button" disabled={busy} onClick={() => void copy()}>
    {busy ? '正在复制…' : '复制一次性链接'}
  </button>;
}
