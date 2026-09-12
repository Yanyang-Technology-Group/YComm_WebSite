/** Client-side API helper — same-origin fetch keeps the session cookie along. */

export interface ApiErrorLike {
  code?: string;
  message?: string;
  meta?: { issues?: { path: string; message: string }[] };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const json = (await response.json().catch(() => null)) as
    | { ok: boolean; data?: T; error?: ApiErrorLike }
    | null;
  if (!response.ok || !json?.ok) {
    const error = json?.error;
    const issues = error?.meta?.issues;
    if (issues?.[0]) throw new Error(issues[0].message);
    const map: Record<string, string> = {
      UNAUTHENTICATED: '请先登录',
      ACCESS_LOGIN_REQUIRED: '请先登录',
      FORBIDDEN: '权限不足',
      NOT_FOUND: '不存在',
      RATE_LIMITED: '请求过于频繁，请稍后再试',
      ACCOUNT_BANNED: '账号已被封禁',
      ACCOUNT_MUTED: '账号被禁言',
      ACCOUNT_UNVERIFIED: '请先验证邮箱',
    };
    throw new Error(map[error?.code ?? ''] ?? error?.message ?? '请求失败');
  }
  return json.data as T;
}