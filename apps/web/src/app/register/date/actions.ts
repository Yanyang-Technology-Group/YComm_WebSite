'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readRegistrationAge, REGISTRATION_AGE_COOKIE } from '../../../lib/registration-age';

export async function saveRegistrationAge(_previous: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const details = readRegistrationAge(JSON.stringify({
    birthDate: form.get('birthDate'),
    guardianEmail: form.get('guardianEmail'),
  }));
  if (!details) return { error: '请填写有效的出生日期；未满十四周岁还需要填写监护人邮箱。' };
  const jar = await cookies();
  jar.set(REGISTRATION_AGE_COOKIE, JSON.stringify(details), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/register',
    maxAge: 30 * 60,
  });
  redirect('/register');
}
