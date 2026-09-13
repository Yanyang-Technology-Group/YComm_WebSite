import type { Metadata } from 'next';
import { AccountDeletionConfirm } from '../../components/account-deletion-confirm';

export const metadata: Metadata = { title: '注销账号' };
export const dynamic = 'force-dynamic';

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1 className="page-title">注销账号</h1>
      <AccountDeletionConfirm token={token} />
    </div>
  );
}