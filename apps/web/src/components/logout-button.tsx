'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setPending(true);
    setFailed(false);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <button
      onClick={() => void logout()}
      disabled={pending}
      style={{ background: 'none', border: 'none', color: '#d4d4d8', cursor: 'pointer', fontSize: '0.9rem' }}
      title="退出登录"
    >
      {failed ? '重试' : '退出'}
    </button>
  );
}