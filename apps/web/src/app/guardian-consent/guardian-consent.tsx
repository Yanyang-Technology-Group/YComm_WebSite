'use client';

import { useState } from 'react';
import Link from 'next/link';

export function GuardianConsent({ token }: { token: string }) {
  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  async function confirm() {
    if (!agreed || state === 'pending') return;
    setState('pending');
    try {
      const response = await fetch('/api/auth/guardian-consent', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean } | null;
      setState(response.ok && body?.ok ? 'done' : 'error');
    } catch { setState('error'); }
  }
  return <section className="panel"><h1>儿童账号监护人同意</h1>
    <p>请先阅读<a href="/legal/children" target="_blank" rel="noreferrer">《儿童个人信息保护规则及监护人须知》</a>。确认后，未满十四周岁的账号才可使用服务。</p>
    {state === 'done' ? <p role="status">监护人单独同意已记录。</p> : <>
      <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>我是该儿童的监护人，已阅读并理解规则，同意按规则处理该儿童为使用晏阳社区所必需的个人信息。</span>
      </label>
      <button type="button" disabled={!agreed || state === 'pending'} onClick={() => void confirm()}>{state === 'pending' ? '正在确认…' : '确认监护人同意'}</button>
      {state === 'error' && <p role="alert">确认链接无效或已过期，请让儿童重新注册并检查监护人邮箱。</p>}
    </>}
    <p><Link href="/">返回首页</Link></p>
  </section>;
}
