import Link from 'next/link';
import type { Metadata } from 'next';
import { captchaConfig } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '注册' };
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  const captcha = captchaConfig();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="register" captcha={captcha} />
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}
