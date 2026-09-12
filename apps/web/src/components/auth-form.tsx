'use client';

import { useRouter } from 'next/navigation';
import { useTransition, useState, type FormEvent } from 'react';

export type AuthFormKind = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

interface ApiError {
  code?: string;
  message?: string;
  meta?: { issues?: { path: string; message: string }[]; retryAfterSeconds?: number };
}

/**
 * One form for all five auth flows. Pure client component: it talks to
 * `/api/auth/*` through the browser (cookies ride along), which is the same
 * boundary the server components use — nothing here touches the database or the
 * domain packages.
 */
export function AuthForm({
  kind,
  token,
}: {
  kind: AuthFormKind;
  token?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const title: Record<AuthFormKind, string> = {
    login: '登录',
    register: '注册',
    forgot: '找回密码',
    reset: '设置新密码',
    verify: '验证邮箱',
  };

  function renderError(apiError: ApiError | null | undefined): string {
    const error = apiError ?? { code: 'UNKNOWN' };
    const issues = error.meta?.issues;
    if (issues && issues.length > 0 && issues[0]) return issues[0].message;

    const map: Record<string, string> = {
      VALIDATION_FAILED: '输入有误',
      UNAUTHENTICATED: '用户名或密码错误',
      ACCESS_LOGIN_REQUIRED: '请先登录',
      ACCOUNT_BANNED: '账号已被封禁',
      ACCOUNT_MUTED: '账号处于禁言状态',
      ACCOUNT_UNVERIFIED: '请先验证邮箱',
      CONFLICT: error.message ?? '操作冲突',
      NOT_INITIALIZED: '站点尚未初始化，请先创建站长账号',
      REGISTRATION_CLOSED: '注册暂未开放',
      RATE_LIMITED: '请求过于频繁，请稍后再试',
      INTERNAL: '服务器开小差了，请稍后再试',
    };
    return map[error.code ?? ''] ?? error.message ?? '操作失败';
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') payload[key] = value;
    }
    if (token) payload.token = token;

    const path =
      kind === 'login'
        ? '/api/auth/login'
        : kind === 'register'
          ? '/api/auth/register'
          : kind === 'forgot'
            ? '/api/auth/forgot-password'
            : kind === 'reset'
              ? '/api/auth/reset-password'
              : '/api/auth/verify-email';

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok: boolean; data?: unknown; error?: ApiError }
        | null;
      if (!json || !json.ok) {
        setError(renderError(json?.error));
        return;
      }

      if (kind === 'login') {
        startTransition(() => router.push('/'));
        router.refresh();
        return;
      }
      if (kind === 'register') {
        setNotice('注册成功！若邮箱未被注册，验证邮件已发送，请查收。');
        return;
      }
      if (kind === 'verify') {
        setNotice('邮箱验证成功！');
        setTimeout(() => startTransition(() => router.push('/login')), 800);
        return;
      }
      if (kind === 'reset') {
        setNotice('密码已重置，请使用新密码登录。');
        setTimeout(() => startTransition(() => router.push('/login')), 800);
        return;
      }
      setNotice('如果该邮箱存在，重置邮件已发送，请查收。');
    } catch {
      setError('网络异常，请重试');
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 360, display: 'grid', gap: '0.75rem' }}>
      <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{title[kind]}</h1>

      {kind === 'login' && (
        <>
          <input name="login" placeholder="用户名或邮箱" required autoComplete="username" />
          <input
            name="password"
            type="password"
            placeholder="密码"
            required
            autoComplete="current-password"
          />
        </>
      )}

      {kind === 'register' && (
        <>
          <input name="username" placeholder="用户名（3-20 位字母/数字/_-）" required autoComplete="username" />
          <input name="email" type="email" placeholder="邮箱" required autoComplete="email" />
          <input
            name="password"
            type="password"
            placeholder="密码（至少 10 位）"
            required
            autoComplete="new-password"
          />
          <input name="inviteCode" placeholder="邀请码（可选）" autoComplete="off" />
        </>
      )}

      {kind === 'forgot' && <input name="email" type="email" placeholder="注册邮箱" required />}

      {kind === 'reset' && (
        <input
          name="password"
          type="password"
          placeholder="新密码（至少 10 位）"
          required
          autoComplete="new-password"
        />
      )}

      {kind === 'verify' && (
        <p style={{ color: '#52525b', margin: 0 }}>点击下方按钮完成邮箱验证。</p>
      )}

      {error && (
        <p role="alert" style={{ color: '#dc2626', margin: 0, fontSize: '0.9rem' }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: '#16a34a', margin: 0, fontSize: '0.9rem' }}>
          {notice}
        </p>
      )}

      <button type="submit" disabled={pending} style={{ padding: '0.5rem' }}>
        {pending ? '处理中…' : title[kind]}
      </button>
    </form>
  );
}