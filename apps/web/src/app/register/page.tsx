import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '注册' };

export default function RegisterPage() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="register" />
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}