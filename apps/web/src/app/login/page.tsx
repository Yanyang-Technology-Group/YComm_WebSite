import Link from 'next/link';
import type { Metadata } from 'next';
import { captchaConfig, enabledOAuthProviders } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';
import { GitHubLoginButton } from '../../components/github-login';

export const metadata: Metadata = { title: '登录' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const providers = enabledOAuthProviders();
  const captcha = captchaConfig();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="login" captcha={captcha} />
      {providers.includes('github') && (
        <div style={{ marginTop: '1rem' }}>
          <GitHubLoginButton />
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
