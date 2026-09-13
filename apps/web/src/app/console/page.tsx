import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { app } from '@ycomm/api';
import { ConsolePanel } from '../../components/console-panel';

export const metadata: Metadata = { title: '个人控制台' };
export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const signedIn = await isSignedIn();
  if (!signedIn) redirect('/login');
  return <ConsolePanel />;
}

async function isSignedIn(): Promise<boolean> {
  try {
    const cookieHeader = (await cookies()).toString();
    const response = await app.request('/api/auth/me', {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    if (!response.ok) return false;
    const json = (await response.json()) as { user?: unknown };
    return json.user != null;
  } catch {
    return false;
  }
}
