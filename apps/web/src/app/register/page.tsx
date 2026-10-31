import Link from 'next/link';
import type { Metadata } from 'next';
import { captchaConfig } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '注册' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ oauth?: string }> }) {
  const { oauth } = await searchParams;
  const captcha = captchaConfig();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="register" captcha={captcha} />
      {oauth === 'registration_required' && <p role="status" className="muted">请先完成邮箱注册及必要的监护人确认，之后可在控制台绑定 GitHub 登录。</p>}
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}
