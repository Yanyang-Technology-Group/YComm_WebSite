'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * 未登录访客每次进站弹一次登录/注册提示框（可关闭）。
 */
export function GuestPrompt({ siteName }: { siteName: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(true);
  }, []);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">
          ×
        </button>
        <h2 className="modal-title">欢迎来到{siteName}</h2>
        <p className="modal-text">登录后可以发帖、下载资源、参与讨论。</p>
        <div className="modal-actions">
          <Link href="/login" className="hero-btn primary" onClick={() => setOpen(false)}>
            登录
          </Link>
          <Link href="/register" className="hero-btn" onClick={() => setOpen(false)}>
            注册
          </Link>
        </div>
        <button type="button" className="modal-skip" onClick={() => setOpen(false)}>
          先逛逛，稍后再说
        </button>
      </div>
    </div>
  );
}
