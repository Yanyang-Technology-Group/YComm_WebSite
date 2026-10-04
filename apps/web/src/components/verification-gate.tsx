'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { formatDateTime } from '../lib/time';
import { getSessionState, invalidateSession, type SessionState } from '../lib/session';

/**
 * 验证闸门（客户端）。
 *
 * 服务端已经会把未验证邮箱 / 未确认新设备的请求全部 403 掉，这一层只负责把
 * 「为什么什么都看不到、接下来该点哪里」讲清楚，别让用户面对一堆报错。
 *
 * 这几条路径必须放行，否则用户连验证入口都点不到：
 * 登录注册、找回密码、验证邮箱、确认设备、注销账号。
 */
const EXEMPT_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/verify-device',
  '/delete-account',
];

function isExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function VerificationGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    invalidateSession();
    setState(await getSessionState(true));
  }, []);

  useEffect(() => {
    let active = true;
    void getSessionState().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  const resend = async (kind: 'email' | 'device') => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(kind === 'email' ? '/api/auth/resend-verification' : '/api/auth/resend-device', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setFeedback(response.ok ? '邮件已重新发送，请查收（含垃圾邮件箱）。' : '发送失败，请稍后再试。');
    } catch {
      setFeedback('网络异常，请稍后再试。');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      invalidateSession();
      window.location.assign('/login');
    }
  };

  // 还没读到会话状态时先正常渲染：内容接口本来就会被服务端拦住，这里不必闪一下。
  if (!state || isExempt(pathname)) return <>{children}</>;
  if (!state.needsEmailVerification && !state.pendingDevice) return <>{children}</>;

  const email = state.email ?? '你的邮箱';
  const deadline = state.verificationGraceEndsAt ? formatDateTime(state.verificationGraceEndsAt) : null;

  return (
    <div className="panel" style={{ maxWidth: 640, margin: '2rem auto' }}>
      <h1 style={{ margin: '0 0 0.6rem', fontSize: '1.35rem' }}>
        {state.needsEmailVerification ? '请先验证邮箱' : '请确认这台新设备'}
      </h1>

      {state.needsEmailVerification ? (
        <>
          <p style={{ margin: '0 0 0.6rem' }}>
            你的账号（{email}）还没有验证邮箱，验证之前社区内容和管理功能都不可用。
          </p>
          <p style={{ margin: '0 0 0.6rem', color: '#b45309' }}>
            我们每 {state.verificationReminderHours} 小时会重发一次验证邮件
            {deadline ? (
              <>
                ；如果在 <strong>{deadline}</strong> 之前仍未验证，账号会被<strong>自动注销</strong>
                （用户名和邮箱会被释放）。
              </>
            ) : null}
          </p>
          <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.9rem' }}>
            打开验证邮件里的链接即可完成验证；同一台设备验证通过后还需要点一次「确认这台设备」。
          </p>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 0.6rem' }}>
            你的账号刚刚在一台新设备上登录。确认是本人在用之前，这台设备不能访问社区。
          </p>
          <p style={{ margin: '0 0 1rem', color: '#b45309' }}>
            确认邮件已发到 <strong>{email}</strong>
            ，点里面的链接即可。没收到就点下面的「重新发送确认邮件」。
          </p>
        </>
      )}

      {feedback && <p style={{ color: feedback.startsWith('邮件') ? 'var(--accent-strong)' : '#dc2626' }}>{feedback}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button type="button" className="primary" disabled={busy} onClick={() => void resend(state.needsEmailVerification ? 'email' : 'device')}>
          {state.needsEmailVerification ? '重新发送验证邮件' : '重新发送确认邮件'}
        </button>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          我已经验证了，刷新
        </button>
        <button type="button" disabled={busy} onClick={() => void logout()}>
          退出登录
        </button>
      </div>

      <p className="muted" style={{ margin: '1rem 0 0', fontSize: '0.85rem' }}>
        换一个账号？<Link href="/login">去登录</Link>
      </p>
    </div>
  );
}
