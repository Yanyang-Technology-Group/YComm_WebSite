import type { Metadata } from 'next';
import { MailPanel } from '../../../components/mail-panel';

export const metadata: Metadata = { title: '邮件中心' };
export const dynamic = 'force-dynamic';

export default function MailPage() {
  return <MailPanel />;
}
