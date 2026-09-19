'use client';

import { useState } from 'react';
import type { CaptchaConfig } from '@ycomm/kernel';
import { CaptchaField } from './captcha-field';
import { ModalPortal } from './modal-portal';

/**
 * 通用「人机验证 + 确认」弹窗：注销账号、站长改密等敏感操作共用。
 * 未配置验证码时（captcha=null）直接确认即可。
 */
export function CaptchaGateModal({
  title,
  description,
  confirmLabel,
  captcha,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  captcha: CaptchaConfig | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: (captchaToken: string | undefined) => void | Promise<void>;
  onClose: () => void;
}) {
  const [token, setToken] = useState<string | undefined>(undefined);

  return (
    <ModalPortal role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="modal-title">{title}</p>
        {description && (
          <p className="muted" style={{ margin: '0 0 0.9rem', fontSize: '0.9rem' }}>
            {description}
          </p>
        )}
        {captcha && (
          <div style={{ marginBottom: '0.9rem' }}>
            <CaptchaField onToken={setToken} script={captcha.script} widgetApi={captcha.widgetApi} />
          </div>
        )}
        {error && <p style={{ color: '#dc2626', margin: '0 0 0.6rem' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="primary"
            disabled={busy || (captcha !== null && !token)}
            onClick={() => void onConfirm(token)}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}