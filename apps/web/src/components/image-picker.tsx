'use client';

import { useRef, useState } from 'react';
import { UPLOADS } from '@ycomm/config';
import { apiFetch } from '../lib/api';

/** 与后端 UPLOADS 规则同源的体积上限。 */
const IMAGE_MAX_BYTES = UPLOADS.inlineImage.maxBytes;
const VIDEO_MAX_BYTES = UPLOADS.inlineVideo.maxBytes;
const IMAGE_MAX_MB = Math.round(IMAGE_MAX_BYTES / (1024 * 1024));
const VIDEO_MAX_MB = Math.round(VIDEO_MAX_BYTES / (1024 * 1024));

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;

/**
 * 图片 / 视频选择器：上传本地文件（图片 ≤50MB、视频 ≤50MB），
 * 超限或上传失败时引导改用外链。
 *
 * `onPicked(url)` 给出可直接使用的地址（站内上传路径或外部 http(s) 直链）；
 * Markdown 渲染端按扩展名自动区分图片与视频（视频点击用窗口播放）。
 */
export function ImagePicker({
  onPicked,
  label = '🖼 上传图片',
  media = 'image',
}: {
  onPicked: (url: string) => void;
  label?: string;
  /** 'image' 只收图片（头像等）；'all' 同时收视频（帖子用）。 */
  media?: 'image' | 'all';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');

  const acceptsVideo = media === 'all';

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/') || VIDEO_EXT_RE.test(file.name);
    if (isVideo && !acceptsVideo) {
      setError('这里只能上传图片');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const limit = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    const limitMb = isVideo ? VIDEO_MAX_MB : IMAGE_MAX_MB;
    if (file.size > limit) {
      setError(
        `${isVideo ? '视频' : '图片'} ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 ${limitMb}MB 上限，请改用外链`,
      );
      setLinkMode(true);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await apiFetch<{ url: string }>(isVideo ? '/api/uploads/videos' : '/api/uploads/images', {
        method: 'POST',
        body: form,
      });
      onPicked(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传失败，可改用外链');
      setLinkMode(true);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function applyLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/api/uploads/')) {
      setError('请填写以 http(s):// 开头的直链');
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
          {acceptsVideo
            ? `图片 ≤ ${IMAGE_MAX_MB}MB、视频 ≤ ${VIDEO_MAX_MB}MB；更大的请填外链`
            : `本地图片 ≤ ${IMAGE_MAX_MB}MB，更大的请填外链`}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={acceptsVideo ? 'image/*,video/mp4,video/webm,video/quicktime' : 'image/*'}
          onChange={pick}
          style={{ display: 'none' }}
        />
      </span>

      {linkMode && (
        <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder={acceptsVideo ? 'https://…/image.png 或 …/video.mp4' : 'https://…/image.png'}
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