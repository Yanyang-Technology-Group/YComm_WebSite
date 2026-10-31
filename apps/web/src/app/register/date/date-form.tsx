'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { registrationAge } from '@ycomm/config';
import { UiButton, UiInput } from '../../../components/ui-controls';
import type { RegistrationAgeDetails } from '../../../lib/registration-age';
import { invalidateSession } from '../../../lib/session';

export function RegistrationDateForm({ today, initial }: { today: string; initial?: RegistrationAgeDetails | null }) {
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const age = registrationAge(birthDate, new Date(`${today}T00:00:00+08:00`));
  const isChild = age !== null && age < 14;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setPending(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/birth-date', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ birthDate: form.get('birthDate'), guardianEmail: form.get('guardianEmail') || undefined }) });
    const json = await response.json().catch(() => null) as { error?: { meta?: { issues?: { message: string }[] }; message?: string } } | null;
    setPending(false);
    if (!response.ok) { setError(json?.error?.meta?.issues?.[0]?.message ?? json?.error?.message ?? '保存失败，请先登录'); return; }
    invalidateSession(); setSaved(true); setTimeout(() => window.location.assign('/'), 500);
  }

  return <form onSubmit={submit} style={{ display: 'grid', gap: '1rem' }}>
    <h1 style={{ margin: 0, fontSize: '1.4rem' }}>填写出生日期</h1>
    <p className="muted" style={{ margin: 0 }}>请填写真实出生日期，用于判断是否需要监护人同意。出生日期不会在公开主页显示。</p>
    <label style={{ display: 'grid', gap: '.5rem' }}>
      出生日期
      <UiInput name="birthDate" type="date" min="1900-01-01" max={today} required autoComplete="bday" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
    </label>
    {age !== null && <p role="status" className="muted" style={{ margin: 0 }}>
      {isChild ? '你尚未满十四周岁，请填写监护人邮箱；注册后需要监护人通过邮件单独确认同意。' : '你已满十四周岁，可以继续填写账号信息。'}
    </p>}
    {isChild && <label style={{ display: 'grid', gap: '.5rem' }}>
      监护人邮箱
      <UiInput name="guardianEmail" type="email" required maxLength={255} defaultValue={initial?.guardianEmail ?? ''} placeholder="填写监护人可接收邮件的邮箱" autoComplete="email" />
      <span className="muted" style={{ fontSize: '.85rem' }}>须与本人注册邮箱不同。请与监护人共同阅读<Link href="/legal/children" target="_blank">儿童个人信息保护规则</Link>。</span>
    </label>}
    {error && <p role="alert" style={{ margin: 0, color: '#dc2626' }}>{error}</p>}
    {saved && <p role="status" style={{ margin: 0, color: '#16a34a' }}>保存成功，正在进入社区…</p>}
    <UiButton type="submit" disabled={pending || age === null} style={{ padding: '.65rem' }}>{pending ? '正在保存…' : '保存出生日期'}</UiButton>
    <Link href="/login">已有账号？去登录</Link>
  </form>;
}
