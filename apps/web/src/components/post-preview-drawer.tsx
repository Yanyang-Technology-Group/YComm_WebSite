'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownContent } from './markdown-content';
import { UiButton } from './ui-controls';

export interface PostPreview { title: string; content: string }

/** Native modal dialog supplies focus trapping, Escape and focus restoration. */
export function PostPreviewDrawer({ preview, boardName, onClose }: {
  preview: PostPreview; boardName?: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(<dialog ref={dialog} className="post-preview-drawer" aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="post-preview-panel">
      <header className="post-preview-header">
        <div><h2 id={heading}>帖子预览</h2><p className="muted">{boardName ? `${boardName} · ` : ''}仅预览，尚未发布</p></div>
        <UiButton type="button" aria-label="关闭预览" onClick={onClose} autoFocus>×</UiButton>
      </header>
      <article className="post-preview-content">
        <h1>{preview.title.trim() || '未填写标题'}</h1>
        {preview.content.trim() ? <MarkdownContent text={preview.content} /> : <p className="muted">正文还未填写。</p>}
      </article>
      <footer className="post-preview-footer"><UiButton type="button" onClick={onClose}>返回继续编辑</UiButton></footer>
    </div>
  </dialog>, document.body);
}
