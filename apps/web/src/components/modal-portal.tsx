'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 弹窗挂载到 document.body。
 *
 * 为什么不用直接写在页面里：祖先元素只要带 transform / filter / will-change，
 * 就会成为 `position: fixed` 的包含块 —— 遮罩变成只盖住内容区、弹窗卡片被居中到
 * 页面高度之外，看起来就是「只有半黑屏、没有窗口」（页面越长越明显）。
 * 走 portal 后 fixed 永远相对视口，z-index 也在全局生效。
 */
export function ModalPortal({
  children,
  className = 'modal-backdrop',
  onClick,
  role,
  ariaModal,
  ariaLabel,
}: {
  children: ReactNode;
  /** 默认 `modal-backdrop`；需要额外类名（如 `modal-layer-top`）直接传完整串。 */
  className?: string;
  onClick?: () => void;
  role?: string;
  ariaModal?: boolean;
  ariaLabel?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // SSR / 首帧不渲染（document 还不存在）
  if (!mounted) return null;

  return createPortal(
    <div className={className} role={role} aria-modal={ariaModal} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </div>,
    document.body,
  );
}