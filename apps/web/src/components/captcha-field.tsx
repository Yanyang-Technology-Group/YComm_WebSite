'use client';

import { useEffect, useRef, useState } from 'react';
import { CAPTCHA_RESET_EVENT } from '../lib/captcha';

let capScriptPromise: Promise<void> | null = null;
let capScriptSource: string | null = null;

/**
 * Load CAP exactly once and wait until the custom element has upgraded. A
 * script tag can exist while it is still loading, so treating its presence as
 * readiness makes the first click race the custom-element upgrade.
 */
function loadCapWidget(script: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // Blob workers need an absolute URL. Configure this before loading CAP so
  // neither its prefetch nor its dynamic import reaches the blocked CDN.
  Object.assign(window, {
    CAP_CUSTOM_WASM_URL: new URL('/cap/0.0.6/cap_wasm.min.js', window.location.origin).href,
  });
  if (customElements.get('cap-widget')) return Promise.resolve();
  if (capScriptPromise && capScriptSource === script) return capScriptPromise;

  const existing = document.querySelector<HTMLScriptElement>('script[data-cap-widget]');
  if (existing && existing.dataset.capWidgetStatus === 'error') existing.remove();
  const element = existing?.isConnected
    ? existing
    : (() => {
        const next = document.createElement('script');
        next.src = script;
        next.async = true;
        next.dataset.capWidget = '1';
        next.dataset.capWidgetStatus = 'loading';
        document.head.appendChild(next);
        return next;
      })();

  const promise = new Promise<void>((resolve, reject) => {
    const finish = () => {
      void customElements.whenDefined('cap-widget').then(() => resolve(), reject);
    };
    const fail = () => {
      element.dataset.capWidgetStatus = 'error';
      element.remove();
      reject(new Error('CAPTCHA script failed to load'));
    };

    if (customElements.get('cap-widget')) {
      resolve();
      return;
    }
    element.addEventListener('load', () => {
      element.dataset.capWidgetStatus = 'loaded';
      finish();
    }, { once: true });
    element.addEventListener('error', fail, { once: true });
    // The element may have loaded between the checks above and listener setup.
    queueMicrotask(() => {
      if (customElements.get('cap-widget')) resolve();
    });
  });

  capScriptSource = script;
  capScriptPromise = promise;
  void promise.catch(() => {
    if (capScriptPromise === promise) {
      capScriptPromise = null;
      capScriptSource = null;
    }
  });
  return promise;
}

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
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [token, setToken] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLElement | null>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  // 加载 cap-widget 的客户端脚本，并等待自定义元素真正完成升级。
  useEffect(() => {
    let active = true;
    setReady(false);
    setError(false);
    void loadCapWidget(script)
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [script, loadAttempt]);

  // 组件级和全局级重置都走 CAP 自己的 reset()，确保 shadow UI、隐藏字段
  // 和 React 状态同时清空。
  useEffect(() => {
    function clearState() {
      setToken('');
      setDone(false);
      onTokenRef.current?.('');
    }

    function resetWidget() {
      clearState();
      const widget = widgetRef.current;
      if (widget && typeof (widget as HTMLElement & { reset?: () => void }).reset === 'function') {
        (widget as HTMLElement & { reset: () => void }).reset();
      }
    }

    const onGlobalReset = () => resetWidget();
    window.addEventListener(CAPTCHA_RESET_EVENT, onGlobalReset);
    return () => window.removeEventListener(CAPTCHA_RESET_EVENT, onGlobalReset);
  }, []);

  // 监听 widget 的 solve / reset / error 事件，拿到或清掉 token。
  useEffect(() => {
    const host = hostRef.current;
    const widget = host?.querySelector('cap-widget') as (HTMLElement & { reset?: () => void }) | null;
    if (!ready || !widget) return;
    const activeWidget = widget;
    widgetRef.current = activeWidget;

    function onSolve(event: Event) {
      const detail = (event as CustomEvent<{ token?: string }>).detail;
      if (detail?.token) {
        setToken(detail.token);
        setDone(true);
        onTokenRef.current?.(detail.token);
      }
    }
    function onReset() {
      setToken('');
      setDone(false);
      onTokenRef.current?.('');
    }
    function onError() {
      // CAP leaves its control in an error state after a failed challenge.
      // Reset on the next task so the user immediately gets a clickable fresh
      // control instead of having to reload the page.
      setToken('');
      setDone(false);
      onTokenRef.current?.('');
      window.setTimeout(() => activeWidget.reset?.(), 0);
    }

    activeWidget.addEventListener('solve', onSolve);
    activeWidget.addEventListener('reset', onReset);
    activeWidget.addEventListener('error', onError);
    return () => {
      activeWidget.removeEventListener('solve', onSolve);
      activeWidget.removeEventListener('reset', onReset);
      activeWidget.removeEventListener('error', onError);
      if (widgetRef.current === activeWidget) widgetRef.current = null;
    };
  }, [ready]);

  return (
    <div>
      {/* 兜底：只有拿到 token 才提交该字段（空字符串会被服务端 min(1) 校验拒绝） */}
      {token && <input type="hidden" name="captchaToken" value={token} />}
      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
          <span style={{ color: '#dc2626' }}>人机验证加载失败。</span>
          <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>
            重试加载
          </button>
        </div>
      )}
      {!error && (
        <div ref={hostRef} style={{ minHeight: 44 }}>
          {ready ? (
            <cap-widget
              style={{ display: 'block', width: 'min(100%, 280px)', minHeight: 56 }}
              data-cap-api-endpoint={widgetApi}
              data-cap-worker-count="4"
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
