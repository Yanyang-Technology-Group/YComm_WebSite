'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { BadgePill } from './badge-manager';

interface BadgeView {
  id: string;
  name: string;
  colorFrom: string;
  colorTo: string;
}

/**
 * 徽章分配（用户管理 → 管理面板里）：列出全部徽章，
 * 点一下分配 / 收回，实时切换。
 */
export function BadgeAssigner({ userId }: { userId: string }) {
  const [all, setAll] = useState<BadgeView[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch<{ badges: BadgeView[] }>('/api/admin/badges'),
      apiFetch<{ badges: BadgeView[] }>(`/api/admin/users/${userId}/badges`),
    ])
      .then(([allData, mineData]) => {
        if (!active) return;
        setAll(allData.badges);
        setMine(new Set(mineData.badges.map((badge) => badge.id)));
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  async function toggle(badge: BadgeView) {
    if (busy) return;
    setBusy(true);
    const has = mine.has(badge.id);
    try {
      await apiFetch(`/api/admin/users/${userId}/badges/${badge.id}`, {
        method: has ? 'DELETE' : 'POST',
      });
      setMine((prev) => {
        const next = new Set(prev);
        if (has) next.delete(badge.id);
        else next.add(badge.id);
        return next;
      });
    } catch {
      /* 保持原状 */
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="muted" style={{ fontSize: '0.85rem' }}>加载中…</p>;
  }

  if (all.length === 0) {
    return (
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        还没有徽章，去{' '}
        <Link href="/admin/badges" className="uname">
          徽章管理
        </Link>{' '}
        创建。
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      {all.map((badge) => {
        const has = mine.has(badge.id);
        return (
          <button
            key={badge.id}
            type="button"
            className={`badge-toggle${has ? ' active' : ''}`}
            onClick={() => void toggle(badge)}
            title={has ? `收回「${badge.name}」` : `分配「${badge.name}」`}
          >
            <BadgePill name={badge.name} colorFrom={badge.colorFrom} colorTo={badge.colorTo} />
            {has ? ' ✓' : ' ＋'}
          </button>
        );
      })}
    </div>
  );
}