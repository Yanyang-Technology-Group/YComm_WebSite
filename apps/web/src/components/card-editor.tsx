'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { apiFetch } from '../lib/api';

interface AdminCard {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string;
  kind: string;
  redirectUrl: string | null;
  w: number;
  h: number;
  visibility: string;
  position: number;
}

interface DragState {
  cardId: string;
  handle: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}

const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const;
const UNIT_W = 162; // 150px 列宽 + 12px 间距
const UNIT_H = 122; // 110px 行高 + 12px 间距

/** 下载区卡片门户后台编辑器：增删改 + 可视化拖拽缩放（四角 + 四边把手）。 */
export function CardsPanel() {
  const router = useRouter();
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const selected = cards.find((card) => card.id === selectedId) ?? null;

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const data = await apiFetch<{ cards: AdminCard[] }>('/api/admin/cards');
      setCards(data.cards);
    } catch {
      setCards([]);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void create(event.currentTarget);
  }

  async function create(form: HTMLFormElement) {
    const fd = new FormData(form);
    setMessage(null);
    const kind = String(fd.get('kind') ?? 'container');
    const payload: Record<string, unknown> = {
      title: String(fd.get('title') ?? ''),
      subtitle: String(fd.get('subtitle') ?? ''),
      kind,
      visibility: String(fd.get('visibility') ?? 'public'),
      parentId: fd.get('parentId') ? String(fd.get('parentId')) : null,
      redirectUrl: kind === 'redirect' ? String(fd.get('redirectUrl') ?? '') : null,
      w: 1,
      h: 1,
    };
    try {
      await apiFetch('/api/admin/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      form.reset();
      await refresh();
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '创建失败');
    }
  }

  async function saveSelected(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const fd = new FormData(event.currentTarget);
    setMessage(null);
    const kind = String(fd.get('kind') ?? 'container');
    try {
      await apiFetch(`/api/admin/cards/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: String(fd.get('title') ?? ''),
          subtitle: String(fd.get('subtitle') ?? ''),
          kind,
          visibility: String(fd.get('visibility') ?? 'public'),
          redirectUrl: kind === 'redirect' ? String(fd.get('redirectUrl') ?? '') : null,
        }),
      });
      await refresh();
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '保存失败');
    }
  }

  async function remove(card: AdminCard) {
    if (!window.confirm(`删除卡片「${card.title}」？其子卡片会一并删除。`)) return;
    try {
      await apiFetch(`/api/admin/cards/${card.id}`, { method: 'DELETE' });
      setSelectedId(null);
      await refresh();
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '删除失败');
    }
  }

  function startResize(event: PointerEvent<HTMLSpanElement>, card: AdminCard, handle: string) {
    event.preventDefault();
    event.stopPropagation();
    const next = { cardId: card.id, handle, startX: event.clientX, startY: event.clientY, startW: card.w, startH: card.h };
    dragRef.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent<HTMLSpanElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    let w = d.startW;
    let h = d.startH;
    if (d.handle.includes('e')) w = Math.round((d.startW * UNIT_W + dx) / UNIT_W);
    if (d.handle.includes('w')) w = Math.round((d.startW * UNIT_W - dx) / UNIT_W);
    if (d.handle.includes('s')) h = Math.round((d.startH * UNIT_H + dy) / UNIT_H);
    if (d.handle.includes('n')) h = Math.round((d.startH * UNIT_H - dy) / UNIT_H);
    w = Math.min(6, Math.max(1, w));
    h = Math.min(6, Math.max(1, h));
    setCards((prev) => prev.map((c) => (c.id === d.cardId ? { ...c, w, h } : c)));
  }

  async function endResize() {
    const d = dragRef.current;
    if (!d) return;
    const card = cards.find((c) => c.id === d.cardId);
    if (card) {
      try {
        await apiFetch(`/api/admin/cards/${card.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ w: card.w, h: card.h }),
        });
        router.refresh();
      } catch {
        /* 忽略保存失败，下次刷新可见 */
      }
    }
    dragRef.current = null;
  }

  const containers = cards.filter((c) => c.kind === 'container');

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.1rem', background: 'var(--surface)' }}>
      <h3 style={{ margin: 0 }}>下载区卡片门户</h3>
      <p style={{ margin: '0.25rem 0 0.8rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
        卡片可无限套娃；拖动卡片四周的圆点改尺寸（宽高按网格单位）；点击卡片编辑属性。
      </p>

      <form onSubmit={submit} style={{ display: 'grid', gap: '0.45rem', marginBottom: '1rem', maxWidth: 560 }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input name="title" placeholder="卡片标题" required style={{ flex: '1 1 160px', padding: '0.4rem' }} />
          <input name="subtitle" placeholder="副标题（可选）" style={{ flex: '1 1 160px', padding: '0.4rem' }} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select name="kind" style={{ padding: '0.4rem' }}>
            <option value="container">套娃（子卡片）</option>
            <option value="redirect">外链跳转</option>
            <option value="resources">资源列表</option>
          </select>
          <select name="visibility" style={{ padding: '0.4rem' }}>
            <option value="public">公开</option>
            <option value="login">需登录</option>
            <option value="staff">仅管理员</option>
          </select>
          <select name="parentId" style={{ padding: '0.4rem' }}>
            <option value="">根层</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                在「{c.title}」内
              </option>
            ))}
          </select>
        </div>
        <input name="redirectUrl" placeholder="外链地址（仅「外链跳转」时用）" style={{ padding: '0.4rem' }} />
        <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
          新增卡片
        </button>
      </form>

      {selected && (
        <form onSubmit={saveSelected} style={{ display: 'grid', gap: '0.45rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--accent-strong)', borderRadius: 12 }}>
          <strong>编辑：{selected.title}</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input name="title" defaultValue={selected.title} placeholder="标题" required style={{ flex: '1 1 160px', padding: '0.4rem' }} />
            <input name="subtitle" defaultValue={selected.subtitle} placeholder="副标题" style={{ flex: '1 1 160px', padding: '0.4rem' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select name="kind" defaultValue={selected.kind} style={{ padding: '0.4rem' }}>
              <option value="container">套娃（子卡片）</option>
              <option value="redirect">外链跳转</option>
              <option value="resources">资源列表</option>
            </select>
            <select name="visibility" defaultValue={selected.visibility} style={{ padding: '0.4rem' }}>
              <option value="public">公开</option>
              <option value="login">需登录</option>
              <option value="staff">仅管理员</option>
            </select>
          </div>
          <input name="redirectUrl" defaultValue={selected.redirectUrl ?? ''} placeholder="外链地址" style={{ padding: '0.4rem' }} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="primary">
              保存
            </button>
            <button type="button" onClick={() => void remove(selected)} style={{ color: '#dc2626' }}>
              删除
            </button>
          </div>
        </form>
      )}

      {message && <p style={{ color: message.includes('失败') ? '#dc2626' : 'var(--accent-strong)' }}>{message}</p>}

      {cards.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>还没有卡片，先新增一张。</p>
      ) : (
        <div className="card-editor-grid">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`card-editor-tile${selectedId === card.id ? ' selected' : ''}`}
              style={{ gridColumn: `span ${card.w}`, gridRow: `span ${card.h}` }}
              onClick={() => setSelectedId(card.id)}
            >
              <div className="ct-title">{card.title}</div>
              <div className="ct-meta">
                {card.kind} · {card.visibility} · {card.w}×{card.h}
              </div>
              {HANDLES.map((h) => (
                <span
                  key={h}
                  className={`resize-handle handle-${h}`}
                  onPointerDown={(e) => startResize(e, card, h)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
