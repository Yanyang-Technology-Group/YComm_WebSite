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
          <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
            用 GitHub 登录创建的账号<strong>没有密码</strong>，注册后可在控制台「账号安全」里创建密码，
            之后就能用账号密码登录；不创建密码的话继续用 GitHub 登录即可。
          </p>
        </div>
      )}
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}