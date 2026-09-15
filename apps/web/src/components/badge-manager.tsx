'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface BadgeView {
  id: string;
  name: string;
  colorFrom: string;
  colorTo: string;
}

const DEFAULT_FROM = '#ff9a3c';
const DEFAULT_TO = '#e0522f';

/** 可视化预览：渐变色胶囊。 */
export function BadgePill({ name, colorFrom, colorTo }: { name: string; colorFrom: string; colorTo: string }) {
  return (
    <span
      className="user-badge"
      style={{ background: `linear-gradient(135deg, ${colorFrom}, ${colorTo})` }}
    >
      {name}
    </span>
  );
}

/**
 * 徽章管理面板（/admin/badges）：
 * 创建徽章（文字 + 渐变两色，实时预览）、删除；分配的入口在「用户管理 → 管理面板」。
 */
export function BadgeManagerPanel() {
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [name, setName] = useState('');
  const [colorFrom, setColorFrom] = useState(DEFAULT_FROM);
  const [colorTo, setColorTo] = useState(DEFAULT_TO);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const data = await apiFetch<{ badges: BadgeView[] }>('/api/admin/badges');
      setBadges(data.badges);
    } catch {
      setBadges([]);
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/admin/badges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), colorFrom, colorTo }),
      });
      setName('');
      await refresh();
      setMessage('徽章已创建。去「用户管理 → 管理面板」给它分配用户。');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove(badge: BadgeView) {
    if (!window.confirm(`删除徽章「${badge.name}」？已分配的会一并移除。`)) return;
    setMessage(null);
    try {
      await apiFetch(`/api/admin/badges/${badge.id}`, { method: 'DELETE' });
      await refresh();
      setMessage('已删除。');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '删除失败');
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        徽章是叠加在用户名旁边的渐变色胶囊（一人可挂多个）。分配在「用户管理 → 管理面板 → 徽章」里做。
      </p>

      <form
        onSubmit={create}
        className="panel"
        style={{ display: 'grid', gap: '0.6rem', marginBottom: '1.25rem', padding: '1rem' }}
      >
        <p className="section-title" style={{ marginTop: 0 }}>新建徽章</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="徽章文字（最多 20 字）"
            maxLength={20}
            required
            style={{ flex: '1 1 200px', padding: '0.45rem' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
            起点色
            <input type="color" value={colorFrom} onChange={(event) => setColorFrom(event.target.value)} style={{ width: 40, height: 32, padding: 0, border: 'none' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
            终点色
            <input type="color" value={colorTo} onChange={(event) => setColorTo(event.target.value)} style={{ width: 40, height: 32, padding: 0, border: 'none' }} />
          </label>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            创建
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
          实时预览：
          {name.trim() ? <BadgePill name={name.trim()} colorFrom={colorFrom} colorTo={colorTo} /> : <span className="muted">输入文字后在这里预览</span>}
        </div>
      </form>

      {message && <p style={{ color: message.includes('失败') ? '#dc2626' : 'var(--accent-strong)' }}>{message}</p>}

      <p className="section-title">已创建的徽章（{badges.length}）</p>
      {badges.length === 0 ? (
        <p className="muted">还没有徽章，先在上面创建一个吧。</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {badges.map((badge) => (
            <div key={badge.id} className="panel" style={{ padding: '0.7rem 0.9rem', marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
              <BadgePill name={badge.name} colorFrom={badge.colorFrom} colorTo={badge.colorTo} />
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {badge.colorFrom} → {badge.colorTo}
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" style={{ color: '#dc2626' }} onClick={() => void remove(badge)}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}