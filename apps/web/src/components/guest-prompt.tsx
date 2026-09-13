'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSession } from '../lib/session';

/**
 * 未登录访客的登录/注册提示框。
 *
 * 客户端自检（经 getSession 去重缓存）：已登录绝不弹；未登录每个浏览器会话
 * （tab 生命周期）最多弹一次，避免每个页面都弹。
 */
export function GuestPrompt({ siteName }: { siteName: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getSession().then((user) => {
      if (!active || user) return;
      if (sessionStorage.getItem('guest_prompt_seen')) return;
      sessionStorage.setItem('guest_prompt_seen', '1');
      setOpen(true);
    });
    return () => {
      active = false;
    };
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