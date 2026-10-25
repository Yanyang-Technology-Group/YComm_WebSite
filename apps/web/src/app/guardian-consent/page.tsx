import type { Metadata } from 'next';
import { GuardianConsent } from './guardian-consent';

export const metadata: Metadata = { title: '监护人同意确认' };

export default async function GuardianConsentPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return token ? <GuardianConsent token={token} /> : <section className="panel"><h1>监护人同意确认</h1><p>请从监护人确认邮件中的链接打开本页。</p></section>;
}
