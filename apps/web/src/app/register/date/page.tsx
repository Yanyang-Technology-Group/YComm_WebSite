import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { registrationToday } from '@ycomm/config';
import { readRegistrationAge, REGISTRATION_AGE_COOKIE } from '../../../lib/registration-age';
import { RegistrationDateForm } from './date-form';

export const metadata: Metadata = { title: '注册 · 出生日期' };
export const dynamic = 'force-dynamic';

export default async function RegistrationDatePage() {
  const initial = readRegistrationAge((await cookies()).get(REGISTRATION_AGE_COOKIE)?.value);
  return <div style={{ maxWidth: 480, margin: '0 auto' }}>
    <RegistrationDateForm today={registrationToday()} initial={initial} />
  </div>;
}
