'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/session';
import { SanctionDialog, type SanctionKind } from './sanction-dialog';

/**
 * 帖子/主题作者旁的「封禁 / 禁言」入口（仅管理员与站长可见，且不能操作自己）。
 *
 * 点击后弹出时长设置弹窗（xx 月 xx 时 xx 分，全 0 为永久），直接调用管理接口，
 * 这样在论坛页面看到违规内容就能当场处理，不必再去后台用户列表里搜人。
 */
export function AuthorSanctions({
  userId,
  username,
  displayName,
}: {
  userId: string | null;
  username: string | null;
  displayName: string | null;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [kind, setKind] = useState<SanctionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSession().then((user) => {
      if (!active || !user || !userId || user.id === userId) return;
      if (user.role === 'admin' || user.role === 'owner') setAllowed(true);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (!allowed || !userId) return null;

  async function submit(input: { until: string | null; reason: string }) {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${userId}/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      setKind(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  const buttonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    padding: 0,
  };

  return (
    <>
      <button
        type="button"
        style={buttonStyle}
        onClick={() => {
          setError(null);
          setKind('ban');
        }}
      >
        封禁…
      </button>
      <button
        type="button"
        style={buttonStyle}
        onClick={() => {
          setError(null);
          setKind('mute');
        }}
      >
        禁言…
      </button>

      {kind && (
        <SanctionDialog
          kind={kind}
          target={{ id: userId, username: username ?? '用户', displayName: displayName ?? undefined }}
          busy={busy}
          error={error}
          onClose={() => setKind(null)}
          onSubmit={submit}
        />
      )}
    </>
  );
}
