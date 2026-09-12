import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '验证邮箱' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      {token ? (
        <AuthForm kind="verify" token={token} />
      ) : (
        <>
          <h1 style={{ fontSize: '1.4rem' }}>验证邮箱</h1>
          <p style={{ color: '#52525b' }}>
            请在邮件中打开验证链接；或
            <Link href="/login">登录后在个人页重新发送</Link>。
          </p>
        </>
      )}
    </div>
  );
}