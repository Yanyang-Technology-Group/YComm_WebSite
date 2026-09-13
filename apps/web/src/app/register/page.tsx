import Link from 'next/link';
import type { Metadata } from 'next';
import { captchaConfig, enabledOAuthProviders } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';
import { GitHubLoginButton } from '../../components/github-login';

export const metadata: Metadata = { title: '注册' };
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  const captcha = captchaConfig();
  const providers = enabledOAuthProviders();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="register" captcha={captcha} />
      {/* GitHub 快捷登录：放在「注册」二字下方，带 GitHub logo */}
      {providers.includes('github') && (
        <div style={{ marginTop: '1rem' }}>
          <GitHubLoginButton />
        </div>
      )}
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}