import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '登录' };

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="login" />
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/forgot-password">忘记密码？</Link>{' '}
        <Link href="/register" style={{ marginLeft: '1rem' }}>
          没有账号？注册
        </Link>
      </p>
    </div>
  );
}