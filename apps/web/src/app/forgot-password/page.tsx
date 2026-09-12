import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '找回密码' };

export default function ForgotPasswordPage() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="forgot" />
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">返回登录</Link>
      </p>
    </div>
  );
}