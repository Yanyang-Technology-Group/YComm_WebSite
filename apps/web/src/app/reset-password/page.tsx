import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth-form';

export const metadata: Metadata = { title: '设置新密码' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <AuthForm kind="reset" token={token} />
    </div>
  );
}