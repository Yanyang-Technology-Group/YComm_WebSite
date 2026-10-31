import type { Metadata } from 'next';
import { registrationToday } from '@ycomm/config';
import { RegistrationDateForm } from './date-form';

export const metadata: Metadata = { title: '注册 · 出生日期' };
export const dynamic = 'force-dynamic';

export default async function RegistrationDatePage() {
  return <div style={{ maxWidth: 480, margin: '0 auto' }}>
    <RegistrationDateForm today={registrationToday()} />
  </div>;
}
