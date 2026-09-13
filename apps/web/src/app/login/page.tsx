import Link from 'next/link';
import type { Metadata } from 'next';
import { enabledOAuthProviders } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '登录' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const providers = enabledOAuthProviders();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="login" />
      {providers.includes('github') && (
        <div style={{ marginTop: '1rem' }}>
          <a
            href="/api/auth/github"
            className="hero-btn"
            style={{ width: '100%', textAlign: 'center', display: 'block' }}
          >
            使用 GitHub 登录
          </a>
        </div>
      )}
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/forgot-password">忘记密码？</Link>{' '}
        <Link href="/register" style={{ marginLeft: '1rem' }}>
          没有账号？注册
        </Link>
      </p>
    </div>
  );
}
