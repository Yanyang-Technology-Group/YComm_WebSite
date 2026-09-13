'use client';

import { useState } from 'react';

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setPending(true);
    setFailed(false);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // 硬跳转：带「已注销」的结果让服务端重新渲染头部状态。
      window.location.assign('/');
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <button
      onClick={() => void logout()}
      disabled={pending}
      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}
      title="退出登录"
    >
      {failed ? '重试' : '退出'}
    </button>
  );
}