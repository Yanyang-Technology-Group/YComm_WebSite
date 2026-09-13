import Link from 'next/link';
import { cookies } from 'next/headers';
import { app } from '@ycomm/api';
import { LogoutButton } from './logout-button';

interface MePayload {
  user?: { username: string; role: string } | null;
}

/**
 * Header session indicator. Same discipline as every server component: reach
 * the backend only through `app.request(...)` — here carrying the incoming
 * cookie, which is how the in-process call learns who is signed in.
 */
export async function SessionNav() {
  let user: { username: string; role: string } | null = null;

  try {
    const cookieHeader = (await cookies()).toString();
    const response = await app.request('/api/auth/me', {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    if (response.ok) {
      const json = (await response.json()) as MePayload;
      user = json.user ?? null;
    }
  } catch {
    user = null;
  }

  if (!user) {
    return (
      <>
        <Link href="/login" className="nav-auth">
          登录
        </Link>
        <Link href="/register" className="nav-auth nav-auth-strong">
          注册
        </Link>
      </>
    );
  }

  return (
    <>
      <span className="nav-user">{user.username}</span>
      <LogoutButton />
    </>
  );
}
