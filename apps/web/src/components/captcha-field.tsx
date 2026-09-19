'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 人机验证 —— CAP Worker（Cloudflare Workers + SHA-256 工作量证明）。
 *
 * 拿 token 的两条路都走通（之前只监听外层 div，而 cap 的 solve 事件不一定冒泡，
 * 导致「明明做完了却提示未完成人机验证」）：
 * 1. `<cap-widget>` 在表单里会自动注入一个隐藏字段 —— 用
 *    `data-cap-hidden-field-name="captchaToken"` 让它直接叫后端认识的名字；
 * 2. 同时监听 widget 元素本身的 `solve` 事件（捕获阶段兜底）写入自己的隐藏字段，
 *    弹窗（不在表单里）等场景则通过 `onToken` 回调拿 token。
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

  // 监听 widget 的 solve / reset 事件，拿到或清掉 token。
  useEffect(() => {
    const host = hostRef.current;
    const widget = host?.querySelector('cap-widget') as HTMLElement | null;
    if (!ready || !widget) return;

    function onSolve(event: Event) {
      const detail = (event as CustomEvent<{ token?: string }>).detail;
      if (detail?.token) {
        setToken(detail.token);
        setDone(true);
        onToken?.(detail.token);
      }
    }
    function onReset() {
      setToken('');
      setDone(false);
      onToken?.('');
    }

    // 直接挂在 widget 上，再用捕获阶段在外层兜底（事件不冒泡时也能收到）。
    widget.addEventListener('solve', onSolve);
    widget.addEventListener('reset', onReset);
    host?.addEventListener('solve', onSolve, true);
    host?.addEventListener('reset', onReset, true);
    return () => {
      widget.removeEventListener('solve', onSolve);
      widget.removeEventListener('reset', onReset);
      host?.removeEventListener('solve', onSolve, true);
      host?.removeEventListener('reset', onReset, true);
    };
  }, [ready, onToken]);

  return (
    <div>
      {/* 兜底：只有拿到 token 才提交该字段（空字符串会被服务端 min(1) 校验拒绝） */}
      {token && <input type="hidden" name="captchaToken" value={token} />}
      {error && (
        <p role="alert" style={{ color: '#dc2626', margin: 0, fontSize: '0.85rem' }}>
          验证码加载失败，请刷新重试
        </p>
      )}
      {!error && (
        <div ref={hostRef} style={{ minHeight: 44 }}>
          {ready ? (
            <cap-widget
              data-cap-api-endpoint={widgetApi}
              data-cap-hidden-field-name="captchaToken"
              data-cap-i18n-initial-state="点击验证你是真人"
              data-cap-i18n-verifying-label="验证中…"
              data-cap-i18n-solved-label="验证通过"
              data-cap-i18n-error-label="验证失败"
              data-cap-i18n-troubleshooting-label="遇到问题？"
              data-cap-i18n-verify-aria-label="点击进行人机验证"
              data-cap-i18n-verifying-aria-label="正在验证，请稍候"
              data-cap-i18n-verified-aria-label="已验证"
              data-cap-i18n-error-aria-label="出错了，请重试"
            />
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