'use client';

import { useRef, useState } from 'react';
import { UPLOADS } from '@ycomm/config';
import { apiFetch } from '../lib/api';

/** 允许的最大图片体积（与后端 UPLOADS.inlineImage 规则同源）。 */
const MAX_BYTES = UPLOADS.inlineImage.maxBytes;
const MAX_MB = Math.round(MAX_BYTES / (1024 * 1024));

/**
 * 图片选择器：默认上传本地图片（≤ 上限），超过上限或上传失败时引导用户改填外链。
 *
 * `onPicked(url)` 给出可直接使用的图片地址（站内上传路径或外部 http(s) 直链）。
 */
export function ImagePicker({
  onPicked,
  label = '🖼 上传图片',
}: {
  onPicked: (url: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`图片 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_MB}MB 上限，请改用外链`);
      setLinkMode(true);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await apiFetch<{ url: string }>('/api/uploads/images', { method: 'POST', body: form });
      onPicked(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '图片上传失败，可改用外链');
      setLinkMode(true);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function applyLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/api/uploads/')) {
      setError('请填写以 http(s):// 开头的图片直链');
      return;
    }
    onPicked(url);
    setLink('');
    setLinkMode(false);
    setError(null);
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.4rem' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} style={{ padding: '0.4rem 0.8rem' }}>
          {busy ? '上传中…' : label}
        </button>
        <button type="button" onClick={() => setLinkMode((value) => !value)} style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}>
          用外链
        </button>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          本地图片 ≤ {MAX_MB}MB，更大的请填外链
        </span>
        <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
      </span>

      {linkMode && (
        <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://…/image.png"
            style={{ padding: '0.35rem 0.5rem', minWidth: 240 }}
          />
          <button type="button" onClick={applyLink} style={{ padding: '0.35rem 0.7rem' }}>
            使用
          </button>
        </span>
      )}

      {error && <span style={{ color: '#dc2626', fontSize: '0.82rem' }}>{error}</span>}
    </span>
  );
}
