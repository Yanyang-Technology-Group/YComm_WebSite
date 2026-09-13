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
            注意：用 GitHub 登录创建的账号<strong>没有密码</strong>，之后无法修改密码，只能继续用 GitHub 登录。
            想用密码登录请在左侧表单注册。
          </p>
        </div>
      )}
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <Link href="/login">已有账号？去登录</Link>
      </p>
    </div>
  );
}