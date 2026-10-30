import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { captchaConfig } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';
import { readRegistrationAge, REGISTRATION_AGE_COOKIE } from '../../lib/registration-age';

export const metadata: Metadata = { title: '注册' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ oauth?: string }> }) {
  const { oauth } = await searchParams;
  const registrationDetails = readRegistrationAge((await cookies()).get(REGISTRATION_AGE_COOKIE)?.value);
  if (!registrationDetails) redirect('/register/date');
  const captcha = captchaConfig();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="register" captcha={captcha} registrationDetails={registrationDetails} />
      <p className="muted" style={{ fontSize: '.85rem' }}><Link href="/register/date">返回修改出生日期{registrationDetails.guardianEmail ? '和监护人邮箱' : ''}</Link></p>
      {oauth === 'registration_required' && <p role="status" className="muted">请先完成邮箱注册及必要的监护人确认，之后可在控制台绑定 GitHub 登录。</p>}
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}
