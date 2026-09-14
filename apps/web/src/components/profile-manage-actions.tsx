'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/session';
import { SanctionDialog, type SanctionKind } from './sanction-dialog';

/**
 * 主页上的「管理面板 → 操作」入口（#6/#7）：
 * - 仅管理员/站长可见；管理员不能管理管理员（对管理员目标仅站长可见）。
 * - 点「管理面板」弹出管理窗口，操作统一叫「操作」。
 */
export function ProfileManageActions({
  targetId,
  targetUsername,
  targetDisplayName,
  targetRole,
}: {
  targetId: string;
  targetUsername: string;
  targetDisplayName: string | null;
  targetRole: 'member' | 'admin' | 'owner';
}) {
  const router = useRouter();
  const [myRole, setMyRole] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<{ kind: SanctionKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSession().then((user) => setMyRole(user?.role ?? null));
  }, []);

  const staff = myRole === 'admin' || myRole === 'owner';
  const allowed = staff && targetRole !== 'owner' && (myRole === 'owner' || targetRole !== 'admin');

  if (!allowed) return null;

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${targetId}${path}`, {
        method: path === '/role' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      setDialog(null);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="text-btn" onClick={() => setOpen(true)}>
        管理面板
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">
              管理面板 · {targetDisplayName || targetUsername}
              <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                {' '}
                @{targetUsername}
              </span>
            </p>

            <p className="section-title" style={{ marginTop: 0 }}>操作</p>
            {error && <p style={{ color: '#dc2626', margin: '0 0 0.6rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button type="button" disabled={busy} onClick={() => setDialog({ kind: 'ban' })}>
                封禁…
              </button>
              <button type="button" disabled={busy} onClick={() => setDialog({ kind: 'mute' })}>
                禁言…
              </button>
              <button type="button" disabled={busy} onClick={() => void act('/unban')}>
                解封
              </button>
              <button type="button" disabled={busy} onClick={() => void act('/unmute')}>
                解除禁言
              </button>
              <Link href="/admin/users" className="text-btn">
                完整管理列表 →
              </Link>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <SanctionDialog
          kind={dialog.kind}
          target={{ id: targetId, username: targetUsername, displayName: targetDisplayName ?? undefined }}
          busy={busy}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={({ until, reason }) =>
            void act(dialog.kind === 'ban' ? '/ban' : '/mute', { until, reason })
          }
        />
      )}
    </>
  );
}