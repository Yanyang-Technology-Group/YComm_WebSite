import Link from 'next/link';
import type { Metadata } from 'next';
import { captchaConfig, enabledOAuthProviders } from '@ycomm/kernel';
import { AuthForm } from '../../components/auth-form';
import { GitHubLoginButton } from '../../components/github-login';
import { AlreadySignedIn } from '../../components/already-signed-in';

export const metadata: Metadata = { title: '登录' };
export const dynamic = 'force-dynamic';

/** GitHub 回调失败原因 → 给用户看的提示。 */
const OAUTH_MESSAGES: Record<string, string> = {
  denied: '你取消了 GitHub 授权，可以改用账号密码登录。',
  state: '授权链接已过期（授权页停留过久或重复点击导致），请重新点击 GitHub 登录。',
  token: 'GitHub 授权校验失败，请重试。',
  profile: '读取 GitHub 资料失败，请重试。',
  network: '服务器连接 GitHub 超时（国内机房访问 GitHub 不稳定），请稍后重试，或直接用账号密码登录。',
  deleted: '该账号已注销，无法登录。',
  banned: '该账号已被封禁。',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string }>;
}) {
  const { oauth } = await searchParams;
  const providers = enabledOAuthProviders();
  const captcha = captchaConfig();
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AlreadySignedIn />

      {oauth && (
        <p role="alert" className="oauth-alert">
          {OAUTH_MESSAGES[oauth] ?? 'GitHub 登录失败，请重试。'}
        </p>
      )}

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
