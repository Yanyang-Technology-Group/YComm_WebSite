'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * 新设备确认表单：本人点邮件里的链接落到这里，直接把令牌交给服务端信任这台设备。
 *
 * 换浏览器点开也能确认（服务端只认令牌里的用户 + 设备指纹），所以这里不需要登录态。
 */
export function VerifyDeviceForm({ token }: { token: string }) {
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('正在确认这台设备…');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/auth/verify-device', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = (await response.json().catch(() => null)) as
          | { ok: boolean; error?: { message?: string } }
          | null;
        if (!active) return;
        if (response.ok && json?.ok) {
          setStatus('done');
          setMessage('这台设备已确认。回到刚才登录的窗口刷新一下就能正常使用了。');
        } else {
          setStatus('error');
          setMessage(json?.error?.message ?? '确认链接无效或已过期，请在登录的窗口里重新发送确认邮件。');
        }
      } catch {
        if (active) {
          setStatus('error');
          setMessage('网络异常，请稍后重试。');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem' }}>确认这台设备</h1>
      <p style={{ color: status === 'error' ? '#dc2626' : '#52525b' }}>{message}</p>
      {status !== 'working' && (
        <p>
          <Link href="/">返回首页</Link>
        </p>
      )}
    </div>
  );
}
