'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

const row: React.CSSProperties = {
  border: '1px solid #e4e4e7',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  marginBottom: '0.5rem',
  background: '#fff',
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
}

export function UsersPanel({ initial }: { initial: { users: AdminUser[]; total: number } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(user: AdminUser, path: string, body?: unknown) {
    setBusy(user.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {initial.users.map((user) => (
        <div key={user.id} style={row}>
          <strong>{user.displayName}</strong> <span style={{ color: '#71717a' }}>@{user.username}</span>{' '}
          <span style={{ color: '#71717a' }}>{user.email}</span>
          <span style={{ marginLeft: '0.5rem' }}>
            [{user.role} · {user.state} · Lv{user.level}]
          </span>
          <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {user.role !== 'admin' && (
              <button disabled={busy === user.id} onClick={() => void act(user, '/role', { role: 'admin' })}>
                设为管理员
              </button>
            )}
            {user.role === 'admin' && (
              <button disabled={busy === user.id} onClick={() => void act(user, '/role', { role: 'member' })}>
                取消管理员
              </button>
            )}
            {user.state !== 'banned' ? (
              <button disabled={busy === user.id} onClick={() => void act(user, '/ban', { reason: '由管理员封禁' })}>
                封禁
              </button>
            ) : (
              <button disabled={busy === user.id} onClick={() => void act(user, '/unban')}>
                解封
              </button>
            )}
            {user.state !== 'muted' ? (
              <button
                disabled={busy === user.id}
                onClick={() =>
                  void act(user, '/mute', {
                    until: new Date(Date.now() + 7 * 86400_000).toISOString(),
                    reason: '由管理员禁言',
                  })
                }
              >
                禁言 7 天
              </button>
            ) : (
              <button disabled={busy === user.id} onClick={() => void act(user, '/unmute')}>
                解除禁言
              </button>
            )}
          </div>
        </div>
      ))}
      <p style={{ color: '#71717a' }}>共 {initial.total} 位用户（本页 {initial.users.length}）</p>
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