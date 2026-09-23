'use client';

import { useEffect, useState } from 'react';
import { ModalPortal } from './modal-portal';

/**
 * Markdown 里的图片 / 视频：点击后用**窗口**查看（全屏浮层），而不是跳转新页面。
 *
 * - 图片：点一下就是窗口查看（卡片简介里的图片同理，不会误触外层链接）
 * - 视频：帖子里直接可播放，右上角「⤢」按钮窗口查看（窗口里自动播放 + 可拖动进度条）
 * - 关闭：点浮层空白处、按 Esc、点右上角 ✕
 */
export function MarkdownMedia({
  kind,
  src,
  alt,
  poster,
}: {
  kind: 'image' | 'video';
  src: string;
  alt?: string;
  poster?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = alt && alt.trim() ? alt : kind === 'video' ? '视频' : '图片';

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {kind === 'image' ? (
        <img
          src={src}
          alt={label}
          className="post-image post-media-clickable"
          loading="lazy"
          title="点击查看大图"
          onClick={(event) => {
            // 图片可能位于卡片/链接内部：别让外层链接把页面带走
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
        />
      ) : (
        <span className="post-video-wrap">
          <video src={src} poster={poster} className="post-video" controls preload="metadata" />
          <button
            type="button"
            className="post-video-zoom"
            title="窗口查看"
            aria-label={`窗口查看${label}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
          >
            ⤢
          </button>
        </span>
      )}

      {open && (
        <ModalPortal
          className="modal-backdrop media-viewer"
          role="dialog"
          ariaModal
          ariaLabel={`${label}（点击空白处关闭）`}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="media-viewer-close"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
            aria-label="关闭"
          >
            ✕
          </button>
          <div className="media-viewer-body" onClick={(event) => event.stopPropagation()}>
            {kind === 'image' ? (
              <img src={src} alt={label} className="media-viewer-img" />
            ) : (
              <video src={src} poster={poster} className="media-viewer-video" controls autoPlay />
            )}
          </div>
          <p className="media-viewer-hint">点空白处或按 Esc 关闭</p>
        </ModalPortal>
      )}
    </>
  );
}