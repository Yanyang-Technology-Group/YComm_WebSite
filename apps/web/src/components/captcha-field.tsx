'use client';

import { useEffect, useState } from 'react';

interface CaptchaWindow {
  captcha?: { getToken: (opts: Record<string, unknown>) => Promise<string> };
}

/**
 * 注册人机验证（Cap.js PoW + 自托管 cap-worker）。
 * 加载 Cap.js 脚本 → 用户点击后计算 PoW 拿到 token → 写入隐藏字段 captchaToken。
 */
export function CaptchaField({ script, siteKey, endpoint }: { script: string; siteKey: string; endpoint: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'verifying' | 'done' | 'error'>('loading');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.querySelector('script[data-cap-captcha]')) {
      setStatus('ready');
      return;
    }
    const el = document.createElement('script');
    el.src = script;
    el.async = true;
    el.dataset.capCaptcha = '1';
    el.onload = () => setStatus('ready');
    el.onerror = () => setStatus('error');
    document.head.appendChild(el);
  }, [script]);

  async function run() {
    setStatus('verifying');
    try {
      const cap = (window as unknown as CaptchaWindow).captcha;
      if (!cap?.getToken) throw new Error('验证码脚本未就绪');
      const value = await cap.getToken({ apiKey: siteKey, callbackUrl: endpoint, siteKey });
      setToken(value);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div>
      <input type="hidden" name="captchaToken" value={token} />
      {status === 'error' && <p style={{ color: '#dc2626', margin: 0, fontSize: '0.85rem' }}>验证码加载失败，请刷新重试</p>}
      {status !== 'done' ? (
        <button type="button" onClick={() => void run()} disabled={status !== 'ready'} style={{ width: '100%' }}>
          {status === 'loading' ? '加载人机验证…' : status === 'verifying' ? '验证中…' : '完成人机验证'}
        </button>
      ) : (
        <p style={{ color: '#16a34a', margin: 0, fontSize: '0.85rem' }}>✓ 人机验证通过</p>
      )}
    </div>
  );
}
