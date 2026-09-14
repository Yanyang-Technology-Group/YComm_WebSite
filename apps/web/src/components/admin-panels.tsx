'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CaptchaConfig } from '@ycomm/kernel';
import { REGISTRATION } from '@ycomm/config';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/session';
import { CaptchaField } from './captcha-field';
import { CaptchaGateModal } from './captcha-gate-modal';
import { remainingLabel, SanctionDialog, type SanctionKind } from './sanction-dialog';

const row: React.CSSProperties = {
  border: '1px solid #e4e4e7',
  borderRadius: 10,
  padding: '0.75rem 1rem',
  marginBottom: '0.5rem',
  background: '#fff',
};

/** 角色徽章：颜色一眼分清。 */
const ROLE_META: Record<string, { label: string; className: string }> = {
  member: { label: '成员', className: 'badge-role-member' },
  admin: { label: '管理员', className: 'badge-role-admin' },
  owner: { label: '站长', className: 'badge-role-owner' },
};

const STATE_META: Record<string, { label: string; className: string }> = {
  active: { label: '正常', className: 'badge-state-active' },
  unverified: { label: '未验证邮箱', className: 'badge-state-unverified' },
  muted: { label: '禁言中', className: 'badge-state-muted' },
  banned: { label: '封禁中', className: 'badge-state-banned' },
  deleting: { label: '注销确认中', className: 'badge-state-deleting' },
  deleted: { label: '已注销', className: 'badge-state-deleted' },
};

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  state: string;
  level: number;
  createdAt: string;
  avatarPath?: string | null;
  /** 封禁/禁言到期时间；null = 永久或未生效。 */
  mutedUntil?: string | null;
  bannedUntil?: string | null;
  muteReason?: string | null;
  banReason?: string | null;
  /** 详情扩展字段。 */
  githubUsername?: string | null;
  lastLoginAt?: string | null;
  inviteCodeUsed?: string | null;
  postCount?: number;
  likeReceivedCount?: number;
}

/** 已生效的封禁/禁言剩余时间文案，未生效返回 null。 */
function sanctionRemaining(user: AdminUser): string | null {
  if (user.state === 'banned') return `封禁${remainingLabel(user.bannedUntil ?? null)}`;
  if (user.state === 'muted') return `禁言${remainingLabel(user.mutedUntil ?? null)}`;
  return null;
}

/**
 * 用户列表：角色/状态用彩色徽章；只有站长能管理管理员（改角色/禁言/封禁/注销/改密码），
 * 且注销、改密码都需要人机验证。
 */
export function UsersPanel({
  initial,
  captcha,
}: {
  initial: { users: AdminUser[]; total: number };
  captcha: CaptchaConfig | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  /** 正在弹窗设置时长的目标：封禁或禁言。 */
  const [dialog, setDialog] = useState<{ kind: SanctionKind; user: AdminUser } | null>(null);
  /** 站长注销账号时的人机验证弹窗。 */
  const [deleteDialog, setDeleteDialog] = useState<AdminUser | null>(null);
  /** 站长改密码：step 1 提示 → step 2 再次确认 + 新密码 + 验证码。 */
  const [pwDialog, setPwDialog] = useState<{ user: AdminUser; step: 1 | 2; password: string } | null>(null);
  /** 「管理面板」弹窗（操作入口）。 */
  const [manageFor, setManageFor] = useState<AdminUser | null>(null);
  /** 「详情」弹窗（用户具体数据）。 */
  const [detailFor, setDetailFor] = useState<AdminUser | null>(null);

  useEffect(() => {
    void getSession().then((user) => setMyRole(user?.role ?? null));
  }, []);

  const isOwner = myRole === 'owner';

  async function act(user: AdminUser, path: string, body?: unknown, method: 'PATCH' | 'POST' = 'POST') {
    setBusy(user.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      setDialog(null);
      setDeleteDialog(null);
      setPwDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  /** 站长直接注销账号（立即生效，无冷静期；要人机验证）。 */
  async function removeAccount(user: AdminUser, captchaToken: string | undefined) {
    setBusy(user.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ captchaToken }),
      });
      setDeleteDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '注销失败');
    } finally {
      setBusy(null);
    }
  }

  /** 站长更改用户密码（两次提示 + 验证码），改完该用户所有会话失效。 */
  async function doResetPassword(user: AdminUser, captchaToken: string | undefined) {
    if (!pwDialog) return;
    setBusy(user.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: pwDialog.password, captchaToken }),
      });
      setPwDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '改密失败');
    } finally {
      setBusy(null);
    }
  }

  /** 管理员不能动管理员：这些管理动作只有站长能碰。 */
  function canManage(user: AdminUser): boolean {
    if (user.role === 'owner') return false;
    if (user.role === 'admin') return isOwner;
    return true;
  }

  return (
    <div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {initial.users.map((user) => {
        const remaining = sanctionRemaining(user);
        const manage = canManage(user);
        const roleMeta = ROLE_META[user.role] ?? { label: user.role, className: '' };
        const stateMeta = STATE_META[user.state] ?? { label: user.state, className: '' };
        const homeHref = `/users/${encodeURIComponent(user.username)}`;
        return (
          <div key={user.id} className="panel" style={{ padding: '0.85rem 1rem', marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* 头像 */}
              {user.avatarPath ? (
                <Link href={homeHref}>
                  <img src={user.avatarPath} alt={user.username} className="avatar" style={{ width: 44, height: 44 }} loading="lazy" />
                </Link>
              ) : (
                <Link href={homeHref}>
                  <span className="avatar avatar-fallback" style={{ width: 44, height: 44, fontSize: '1.1rem' }}>
                    {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                  </span>
                </Link>
              )}
              {/* 昵称 + id */}
              <div style={{ minWidth: 0 }}>
                <Link className="uname" href={homeHref}>
                  {user.displayName || user.username}
                </Link>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  @{user.username} · {user.email}
                </div>
              </div>
              {/* 状态/权限/等级徽章 */}
              <span className={`badge ${roleMeta.className}`}>{roleMeta.label}</span>
              <span className={`badge ${stateMeta.className}`}>{stateMeta.label}</span>
              <span className="badge badge-neutral">Lv{user.level}</span>
              {remaining && (
                <span className="badge badge-state-banned">
                  {remaining}
                  {user.banReason || user.muteReason ? `（${user.banReason || user.muteReason}）` : ''}
                </span>
              )}
              {/* 右侧：管理 / 详情（管理员只能看和管理成员；管理员仅站长可见） */}
              {manage && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy === user.id} onClick={() => setManageFor(user)}>
                    管理
                  </button>
                  <button type="button" disabled={busy === user.id} onClick={() => setDetailFor(user)}>
                    详情
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <p className="muted">共 {initial.total} 位用户（本页 {initial.users.length}）· 管理员只能被站长管理</p>

      {dialog && (
        <SanctionDialog
          kind={dialog.kind}
          target={dialog.user}
          busy={busy === dialog.user.id}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={({ until, reason }) =>
            void act(dialog.user, dialog.kind === 'ban' ? '/ban' : '/mute', { until, reason })
          }
        />
      )}

      {deleteDialog && (
        <CaptchaGateModal
          title={`注销「${deleteDialog.username}」`}
          description="立即生效、无 3 天冷静期，且不可恢复。请先完成人机验证，确认后该账号将永久注销。"
          confirmLabel="确认注销"
          captcha={captcha}
          busy={busy === deleteDialog.id}
          error={error}
          onClose={() => setDeleteDialog(null)}
          onConfirm={(captchaToken) => void removeAccount(deleteDialog, captchaToken)}
        />
      )}

      {pwDialog && pwDialog.step === 1 && (
        <div className="modal-backdrop modal-layer-top" onClick={() => setPwDialog(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">更改「{pwDialog.user.username}」的密码</p>
            <p className="muted" style={{ margin: '0 0 0.9rem', fontSize: '0.9rem' }}>
              设置后该用户<strong>所有会话立即失效</strong>，必须用新密码重新登录。账号此前如果只有
              GitHub 登录，设置密码后即可用账号密码登录。
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="primary" onClick={() => setPwDialog({ ...pwDialog, step: 2 })}>
                继续
              </button>
              <button type="button" onClick={() => setPwDialog(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {pwDialog && pwDialog.step === 2 && (
        <form
          className="modal-backdrop modal-layer-top"
          onSubmit={(event) => {
            event.preventDefault();
            const fd = new FormData(event.currentTarget);
            void doResetPassword(pwDialog.user, (fd.get('captchaToken') as string | null) ?? undefined);
          }}
        >
          <div className="modal-card">
            <p className="modal-title">再次确认：设置新密码</p>
            <p className="muted" style={{ margin: '0 0 0.8rem', fontSize: '0.9rem' }}>
              请再次确认要为「{pwDialog.user.username}」设置以下新密码，并完成人机验证。
            </p>
            <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.85rem', marginBottom: '0.8rem' }}>
              新密码（{REGISTRATION.passwordHint}）
              <input
                type="text"
                value={pwDialog.password}
                onChange={(event) => setPwDialog({ ...pwDialog, password: event.target.value })}
                minLength={REGISTRATION.minPasswordLength}
                style={{ padding: '0.4rem' }}
                autoFocus
              />
            </label>
            {captcha && (
              <div style={{ marginBottom: '0.9rem' }}>
                <CaptchaField script={captcha.script} widgetApi={captcha.widgetApi} />
              </div>
            )}
            {error && <p style={{ color: '#dc2626', margin: '0 0 0.6rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="submit"
                className="primary"
                disabled={busy === pwDialog.user.id || !pwDialog.password}
              >
                {busy === pwDialog.user.id ? '处理中…' : '确认设置新密码'}
              </button>
              <button type="button" onClick={() => setPwDialog(null)} disabled={busy === pwDialog.user.id}>
                取消
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 管理面板：操作都在这里（管理员只对成员可用，管理员仅站长可用） */}
      {manageFor && (
        <div className="modal-backdrop" onClick={() => setManageFor(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">
              管理面板 · {manageFor.displayName || manageFor.username}
              <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                {' '}
                @{manageFor.username}
              </span>
            </p>

            <p className="section-title" style={{ marginTop: 0 }}>操作</p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {manageFor.role === 'member' && isOwner && (
                <button type="button" onClick={() => void act(manageFor, '/role', { role: 'admin' }, 'PATCH')}>
                  设为管理员
                </button>
              )}
              {manageFor.role === 'admin' && isOwner && (
                <button type="button" onClick={() => void act(manageFor, '/role', { role: 'member' }, 'PATCH')}>
                  取消管理员
                </button>
              )}
              {manageFor.state !== 'banned' && (
                <button
                  type="button"
                  onClick={() => {
                    setDialog({ kind: 'ban', user: manageFor });
                    setManageFor(null);
                  }}
                >
                  封禁…
                </button>
              )}
              {manageFor.state === 'banned' && (
                <button type="button" onClick={() => void act(manageFor, '/unban')}>
                  解封
                </button>
              )}
              {manageFor.state !== 'muted' && manageFor.state !== 'banned' && (
                <button
                  type="button"
                  onClick={() => {
                    setDialog({ kind: 'mute', user: manageFor });
                    setManageFor(null);
                  }}
                >
                  禁言…
                </button>
              )}
              {manageFor.state === 'muted' && (
                <button type="button" onClick={() => void act(manageFor, '/unmute')}>
                  解除禁言
                </button>
              )}
              {isOwner && manageFor.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => {
                    setPwDialog({ user: manageFor, step: 1, password: '' });
                    setManageFor(null);
                  }}
                >
                  改密码…
                </button>
              )}
              {isOwner && manageFor.role !== 'owner' && (
                <button
                  type="button"
                  style={{ color: '#dc2626' }}
                  onClick={() => {
                    setDeleteDialog(manageFor);
                    setManageFor(null);
                  }}
                >
                  注销
                </button>
              )}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" onClick={() => setManageFor(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情：该用户的具体数据（管理员仅能看到成员，管理员仅站长可见） */}
      {detailFor && (
        <div className="modal-backdrop" onClick={() => setDetailFor(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">
              用户详情 · {detailFor.displayName || detailFor.username}
              <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                {' '}
                @{detailFor.username}
              </span>
            </p>
            <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.92rem' }}>
              <DetailRow label="头像">
                {detailFor.avatarPath ? (
                  <img src={detailFor.avatarPath} alt={detailFor.username} className="avatar" style={{ width: 48, height: 48 }} loading="lazy" />
                ) : (
                  <span className="avatar avatar-fallback" style={{ width: 48, height: 48 }}>
                    {(detailFor.displayName || detailFor.username).slice(0, 1).toUpperCase()}
                  </span>
                )}
              </DetailRow>
              <DetailRow label="昵称">{detailFor.displayName || '—'}</DetailRow>
              <DetailRow label="ID">@{detailFor.username}</DetailRow>
              <DetailRow label="邮箱">{detailFor.email}</DetailRow>
              <DetailRow label="GitHub">
                {detailFor.githubUsername ? `已绑定 @${detailFor.githubUsername}` : '未绑定'}
              </DetailRow>
              <DetailRow label="注册时间">
                {new Date(detailFor.createdAt).toLocaleString('zh-CN')}
              </DetailRow>
              <DetailRow label="最后登录">
                {detailFor.lastLoginAt ? new Date(detailFor.lastLoginAt).toLocaleString('zh-CN') : '未记录'}
              </DetailRow>
              <DetailRow label="目前状态">
                <span className={`badge ${(STATE_META[detailFor.state] ?? { className: 'badge-neutral' }).className}`}>
                  {(STATE_META[detailFor.state] ?? { label: detailFor.state }).label}
                </span>
              </DetailRow>
              <DetailRow label="权限">
                <span className={`badge ${(ROLE_META[detailFor.role] ?? { className: 'badge-neutral' }).className}`}>
                  {(ROLE_META[detailFor.role] ?? { label: detailFor.role }).label}
                </span>
              </DetailRow>
              <DetailRow label="等级">Lv{detailFor.level}</DetailRow>
              <DetailRow label="使用的注册码">{detailFor.inviteCodeUsed ?? '无'}</DetailRow>
              <DetailRow label="发帖 / 获赞">
                {detailFor.postCount ?? 0} 帖 · {detailFor.likeReceivedCount ?? 0} 赞
              </DetailRow>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" onClick={() => setDetailFor(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem' }}>
      <span className="muted" style={{ flexShrink: 0, width: 92 }}>
        {label}
      </span>
      <span style={{ minWidth: 0, wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

export interface ModerationItem {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  reporter_id: string | null;
  detail: string | null;
  created_at: string;
}

export function ModerationPanel({ items }: { items: ModerationItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(item: ModerationItem, decision: 'approve' | 'reject') {
    setBusy(item.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/moderation/${item.id}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <p style={{ color: '#71717a' }}>队列为空 🎉</p>;
  return (
    <div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {items.map((item) => (
        <div key={item.id} style={row}>
          <span style={{ fontWeight: 600 }}>{item.target_type}</span>{' '}
          <span style={{ color: '#71717a' }}>{item.reason}</span>
          {item.detail && <div style={{ color: '#71717a', fontSize: '0.85rem' }}>{item.detail}</div>}
          <code style={{ fontSize: '0.8rem' }}>{item.target_id}</code>
          <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem' }}>
            <button disabled={busy === item.id} onClick={() => void decide(item, 'approve')}>
              批准
            </button>
            <button disabled={busy === item.id} onClick={() => void decide(item, 'reject')}>
              驳回
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface AdminResource {
  id: string;
  title: string;
  status: string;
  sourceType: string;
  versionLabel: string | null;
  downloadCount: number;
  createdAt: string;
}

export interface InviteCodeItem {
  id: string;
  name: string | null;
  code: string;
  usedCount: number;
  maxUses: number | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface InviteUseUser {
  userId: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  state: string;
  usedAt: string | null;
}

/** 注册码管理：管理员创建（名称 + 注册码 ≤10 位）、查看列表、删除。 */
/** 注册码使用量着色：没怎么用 = 浅绿，完全用完 = 深红，中间连续渐变。 */
function usageStyle(used: number, max: number | null | undefined): React.CSSProperties {
  if (!max) return { background: 'transparent', color: 'var(--muted)' };
  const ratio = Math.min(1, used / Math.max(1, max));
  const hue = Math.round(120 * (1 - ratio)); // 120(绿) → 0(红)
  const saturation = 70 - ratio * 20;
  const lightness = 92 - ratio * 34; // 浅 → 深
  return {
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    color: ratio > 0.55 ? '#7f1d1d' : '#166534',
    fontWeight: 800,
  };
}

export function InviteCodesPanel() {
  const router = useRouter();
  const [items, setItems] = useState<InviteCodeItem[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [busy, setBusy] = useState<string | false>(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 弹窗：查看使用某注册码的用户。 */
  const [usesFor, setUsesFor] = useState<InviteCodeItem | null>(null);
  const [uses, setUses] = useState<InviteUseUser[] | null>(null);
  const [usesLoading, setUsesLoading] = useState(false);
  const [usesError, setUsesError] = useState<string | null>(null);

  async function openUses(entry: InviteCodeItem) {
    setUsesFor(entry);
    setUses(null);
    setUsesError(null);
    setUsesLoading(true);
    try {
      const data = await apiFetch<{ users: InviteUseUser[] }>(`/api/admin/invites/${entry.id}/uses`);
      setUses(data.users);
    } catch (caught) {
      setUsesError(caught instanceof Error ? caught.message : '加载失败');
    } finally {
      setUsesLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ inviteCodes: InviteCodeItem[] }>('/api/admin/invites');
        setItems(data.inviteCodes);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  async function create() {
    setBusy('create');
    setMessage(null);
    try {
      await apiFetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, code: code || undefined, maxUses: Number(maxUses) || 1 }),
      });
      setMessage(`注册码已创建${code ? '' : '（自动生成）'}`);
      setName('');
      setCode('');
      setMaxUses('1');
      const data = await apiFetch<{ inviteCodes: InviteCodeItem[] }>('/api/admin/invites');
      setItems(data.inviteCodes);
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/invites/${id}`, { method: 'DELETE' });
      setItems((previous) => previous.filter((entry) => entry.id !== id));
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={row}>
      <h3 style={{ margin: 0 }}>注册码</h3>
      <p style={{ margin: '0.25rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
        注册码 2-10 位（字母/数字/_-），留空自动生成；可用于注册或解锁受限内容。
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          placeholder="名称（如：技术群 2025 年 9 月）"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          style={{ padding: '0.4rem', flex: '1 1 200px' }}
        />
        <input
          placeholder="注册码（≤10 位，可留空）"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          maxLength={10}
          style={{ padding: '0.4rem', flex: '0 1 160px' }}
        />
        <input
          type="number"
          min={1}
          placeholder="最多绑定账号数（默认 1）"
          value={maxUses}
          onChange={(event) => setMaxUses(event.target.value)}
          style={{ padding: '0.4rem', flex: '0 1 130px' }}
        />
        <button type="button" onClick={() => void create()} disabled={busy !== false}>
          {busy === false ? '创建' : '处理中…'}
        </button>
      </div>
      {message && <p style={{ color: message.includes('失败') ? '#dc2626' : 'var(--accent)', margin: '0.4rem 0' }}>{message}</p>}
      {items.length > 0 && (
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>注册码</th>
                <th style={thStyle}>已用/上限</th>
                <th style={thStyle}>创建时间</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td style={tdStyle}>{entry.name ?? '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{entry.code}</td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      className="badge"
                      style={{ ...usageStyle(entry.usedCount, entry.maxUses), border: 'none', cursor: 'pointer' }}
                      title="点开查看使用了这个注册码的用户"
                      onClick={() => void openUses(entry)}
                    >
                      {entry.usedCount}/{entry.maxUses ?? '∞'}
                    </button>
                  </td>
                  <td style={tdStyle}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</td>
                  <td style={tdStyle}>
                    <button type="button" onClick={() => void remove(entry.id)} disabled={busy === entry.id} style={{ color: '#dc2626' }}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {usesFor && (
        <div className="modal-backdrop" onClick={() => setUsesFor(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">
              注册码「{usesFor.code}」的使用者
              <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                {' '}
                · {usesFor.usedCount} 人
              </span>
            </p>
            {usesLoading && <p className="muted">加载中…</p>}
            {usesError && <p style={{ color: '#dc2626' }}>{usesError}</p>}
            {!usesLoading && !usesError && uses && (
              uses.length === 0 ? (
                <p className="muted">还没有人使用这个注册码。</p>
              ) : (
                <div style={{ display: 'grid', gap: '0.45rem', maxHeight: 320, overflowY: 'auto' }}>
                  {uses.map((user) => (
                    <div key={user.userId} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      {user.avatarPath ? (
                        <img src={user.avatarPath} alt={user.displayName} className="avatar avatar-sm" loading="lazy" />
                      ) : (
                        <span className="avatar avatar-sm avatar-fallback">
                          {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span>
                        <Link className="uname" href={`/users/${encodeURIComponent(user.username)}`}>
                          {user.displayName || user.username}
                        </Link>
                        <span className="muted" style={{ fontSize: '0.82rem' }}>
                          {' '}
                          @{user.username}
                          {user.usedAt ? ` · ${new Date(user.usedAt).toLocaleString('zh-CN')}` : ''}
                          {user.state === 'deleted' ? ' · 已注销' : ''}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}
            <div style={{ marginTop: '1rem' }}>
              <button type="button" onClick={() => setUsesFor(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border)' };
const tdStyle: React.CSSProperties = { padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border)' };

/** 违禁词管理：管理员维护，含违禁词的内容在发布时被拦截。 */
export function BannedWordsPanel() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ settings: { key: string; value: unknown }[] }>('/api/admin/settings');
        const banned = data.settings.find((entry) => entry.key === 'bannedWords');
        const words = Array.isArray(banned?.value) ? (banned.value as string[]) : [];
        setValue(words.join('\n'));
      } catch {
        /* 忽略读取失败，仅显示空 */
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    const words = value.split('\n').map((word) => word.trim()).filter(Boolean);
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'bannedWords', value: words }),
      });
      setMessage(`已保存 ${words.length} 个违禁词`);
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={row}>
      <h3 style={{ margin: 0 }}>违禁词</h3>
      <p style={{ margin: '0.25rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
        每行一个；发表的主题与回复若包含违禁词将被直接拦截。
      </p>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={6}
        style={{ width: '100%', padding: '0.4rem', fontFamily: 'monospace' }}
        placeholder={'例如：\n广告词\n垃圾内容'}
      />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
        {message && <span style={{ color: message.startsWith('已保存') ? 'var(--accent)' : '#dc2626' }}>{message}</span>}
      </div>
    </div>
  );
}

export function ResourcesPanel({
  categories,
  initial,
}: {
  categories: { slug: string; name: string }[];
  initial: { resources: AdminResource[] };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const data = await apiFetch<{ resource: { id: string } }>('/api/downloads/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          categorySlug: String(form.get('categorySlug') ?? ''),
          title: String(form.get('title') ?? ''),
          summary: String(form.get('summary') ?? ''),
          description: String(form.get('description') ?? ''),
          sourceType: 'local',
        }),
      });
      const file = form.get('file');
      if (file instanceof File && file.size > 0) {
        const upload = new FormData();
        upload.append('file', file);
        await apiFetch(`/api/downloads/resources/${data.resource.id}/upload`, { method: 'POST', body: upload });
      }
      event.currentTarget.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={createResource} style={{ display: 'grid', gap: '0.4rem', maxWidth: 560, marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0 }}>发布资源（管理员上传，站长审核后生效）</h3>
        <select name="categorySlug" style={{ padding: '0.4rem' }}>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <input name="title" placeholder="标题" required style={{ padding: '0.4rem' }} />
        <input name="summary" placeholder="一句话简介" style={{ padding: '0.4rem' }} />
        <textarea name="description" placeholder="详细介绍（Markdown）" rows={4} style={{ padding: '0.4rem' }} />
        <input name="file" type="file" style={{ padding: '0.3rem' }} />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" disabled={busy}>
            {busy ? '上传中…' : '发布'}
          </button>
        </div>
        {error && <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
      </form>

      <h3 style={{ margin: '0 0 0.5rem' }}>全部资源</h3>
      {initial.resources.map((resource) => (
        <div key={resource.id} style={row}>
          <strong>{resource.title}</strong>{' '}
          <span style={{ color: '#71717a' }}>
            [{resource.status} · {resource.sourceType} · 下载 {resource.downloadCount}]
          </span>
        </div>
      ))}
    </div>
  );
}