'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

/** 关注 / 取消关注按钮；未登录点击提示请先登录。 */
export function FollowButton({
  username,
  initialFollowing,
  isSelf,
  disabled,
}: {
  username: string;
  initialFollowing: boolean;
  isSelf: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  if (isSelf) return null;

  async function toggle() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await apiFetch(`/api/users/${encodeURIComponent(username)}/${following ? 'unfollow' : 'follow'}`, {
        method: 'POST',
      });
      setFollowing(!following);
      router.refresh();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : '操作失败，请先登录后再关注');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || disabled}
      className={following ? undefined : 'primary'}
      style={{ cursor: 'pointer' }}
    >
      {busy ? '处理中…' : following ? '已关注' : '+ 关注'}
    </button>
  );
}