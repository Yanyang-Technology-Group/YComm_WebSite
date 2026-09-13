'use client';

import Link from 'next/link';
import { useState } from 'react';

/** 邮件里的「确认注销」落地页：点击后进入 3 天冷静期。 */
export function AccountDeletionConfirm({ token }: { token?: string }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function confirm() {
    if (!token) {
      setStatus('error');
      setMessage('链接无效：缺少 token，请重新从邮件进入。');
      return;
    }
    setStatus('working');
    setMessage(null);
    try {
      const response = await fetch('/api/auth/delete-account/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok: boolean; error?: { message?: string; meta?: { issues?: { message: string }[] } } }
        | null;
      if (!response.ok || !json?.ok) {
        setStatus('error');
        setMessage(
          json?.error?.meta?.issues?.[0]?.message ?? json?.error?.message ?? '注销确认失败，请重试',
        );
        return;
      }
      setStatus('done');
    } catch {
      setStatus('error');
      setMessage('网络异常，请重试');
    }
  }

  if (status === 'done') {
    return (
      <div className="panel">
        <p className="panel-title">已进入注销冷静期</p>
        <p style={{ margin: '0 0 0.5rem' }}>
          账号已标记为注销中。<strong>3 天内重新登录即可取消注销</strong>；到期未登录，账号将被永久注销。
        </p>
        <p className="muted" style={{ margin: 0 }}>
          所有已登录设备已被强制退出。
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link href="/login">前往登录以取消注销</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="panel-title">确认注销账号</p>
      <p style={{ margin: '0 0 0.5rem' }}>确认后账号进入 3 天冷静期：期间重新登录即可取消注销。</p>
      <p className="muted" style={{ margin: '0 0 1rem' }}>
        到期未登录，账号将被永久注销，且无法恢复。
      </p>
      {message && (
        <p role="alert" style={{ color: '#dc2626', margin: '0 0 0.75rem' }}>
          {message}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="button" className="primary" onClick={() => void confirm()} disabled={status === 'working'}>
          {status === 'working' ? '处理中…' : '确认注销'}
        </button>
        <Link href="/" className="hero-btn">
          取消，返回首页
        </Link>
      </div>
    </div>
  );
}