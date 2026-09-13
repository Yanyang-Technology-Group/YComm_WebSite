'use client';

import Link from 'next/link';
import { useState } from 'react';

/** 注销前的确认声明（用户点击「确认注销」即视为确认下列内容）。 */
const DELETION_STATEMENT =
  '本人自愿申请注销晏阳社区账号，该申请系本人真实意愿表达。账号注销完成后，本人与晏阳社区不再存在相关权责关系。且本人已经了解并知晓账号提交注销申请后将进入 3 日冷静期，冷静期届满账号及对应数据将予以全部清除；冷静期内如重新登录，即可撤销注销申请、恢复账号正常使用。';

/** 邮件里的「确认注销」落地页：确认声明 → 勾选 → 进入 3 天冷静期。 */
export function AccountDeletionConfirm({ token }: { token?: string }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function confirm() {
    if (!token) {
      setStatus('error');
      setMessage('链接无效：缺少 token，请重新从邮件进入。');
      return;
    }
    if (!agreed) {
      setMessage('请先阅读并勾选确认上述注销声明。');
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
          账号已标记为注销中。<strong>3 天内重新登录即可撤销注销申请、恢复账号正常使用</strong>；
          冷静期届满，账号及对应数据将予以全部清除。
        </p>
        <p className="muted" style={{ margin: 0 }}>
          所有已登录设备已被强制退出。
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link href="/login">前往登录以撤销注销</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="panel-title">确认注销账号</p>
      <blockquote
        style={{
          margin: '0 0 1rem',
          padding: '0.9rem 1rem',
          borderLeft: '3px solid var(--accent)',
          background: 'var(--accent-soft)',
          borderRadius: '0 8px 8px 0',
          fontSize: '0.9rem',
          lineHeight: 1.8,
        }}
      >
        {DELETION_STATEMENT}
      </blockquote>

      <label
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'flex-start',
          fontSize: '0.9rem',
          lineHeight: 1.6,
          marginBottom: '1rem',
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          style={{ marginTop: '0.25rem' }}
        />
        <span>本人已阅读并同意上述内容，自愿申请注销账号。</span>
      </label>

      {message && (
        <p role="alert" style={{ color: status === 'error' ? '#dc2626' : 'var(--muted)', margin: '0 0 0.75rem' }}>
          {message}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="primary"
          onClick={() => void confirm()}
          disabled={status === 'working' || !agreed}
        >
          {status === 'working' ? '处理中…' : '确认注销'}
        </button>
        <Link href="/" className="hero-btn">
          取消，返回首页
        </Link>
      </div>
    </div>
  );
}