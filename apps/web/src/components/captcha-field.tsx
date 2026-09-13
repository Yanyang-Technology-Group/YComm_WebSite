'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 人机验证 —— CAP Worker（Cloudflare Workers + SHA-256 工作量证明）。
 *
 * 流程：加载 `cap.min.js` → 渲染 `<cap-widget data-cap-api-endpoint>` →
 * 用户完成解题后收到 `solve` 事件 → 把 `e.detail.token` 写入隐藏字段
 * captchaToken；服务端再调 `${endpoint}/api/validate` 做一次性核验。
 */
export function CaptchaField({
  script,
  widgetApi,
  onToken,
}: {
  script: string;
  widgetApi: string;
  /** 解出 token 后回调（普通表单用隐藏字段，弹窗等场景用回调）。 */
  onToken?: (token: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [token, setToken] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);

  // 加载 cap-widget 的客户端脚本（只加载一次，登录/注册页共用）。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.querySelector('script[data-cap-widget]')) {
      setReady(true);
      return;
    }
    const el = document.createElement('script');
    el.src = script;
    el.async = true;
    el.dataset.capWidget = '1';
    el.onload = () => setReady(true);
    el.onerror = () => setError(true);
    document.head.appendChild(el);
  }, [script]);

  // 监听 widget 的 solve 事件，拿到解题 token。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function onSolve(event: Event) {
      const detail = (event as CustomEvent<{ token?: string }>).detail;
      if (detail?.token) {
        setToken(detail.token);
        setDone(true);
        onToken?.(detail.token);
      }
    }
    host.addEventListener('solve', onSolve);
    return () => host.removeEventListener('solve', onSolve);
  }, [ready]);

  return (
    <div>
      {/* 只有拿到 token 才提交该字段——空字符串会被服务端 min(1) 校验拒绝 */}
      {token && <input type="hidden" name="captchaToken" value={token} />}
      {error && (
        <p role="alert" style={{ color: '#dc2626', margin: 0, fontSize: '0.85rem' }}>
          验证码加载失败，请刷新重试
        </p>
      )}
      {!error && (
        <div ref={hostRef} style={{ minHeight: 44 }}>
          {ready ? (
            <cap-widget data-cap-api-endpoint={widgetApi} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              加载人机验证…
            </p>
          )}
        </div>
      )}
      {done && (
        <p style={{ color: '#16a34a', margin: 0, fontSize: '0.85rem' }}>✓ 人机验证通过</p>
      )}
    </div>
  );
}