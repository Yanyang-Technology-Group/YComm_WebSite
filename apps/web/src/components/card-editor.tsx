'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/session';

interface AdminCard {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string;
  subtitleUrl: string | null;
  kind: string;
  redirectUrl: string | null;
  w: number;
  h: number;
  visibility: string;
  position: number;
  /** pending 待站长审核 / approved 已通过 / rejected 已拒绝。 */
  status: string;
}

interface DragState {
  cardId: string;
  handle: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  /** 拖动过程中的实时尺寸（松手时用它落库）。 */
  w: number;
  h: number;
}

/** 可见度中文标签（与选择框保持一致）。 */
const VISIBILITY_LABELS: Record<string, string> = {
  public: '公开',
  login: '需登录',
  invite: '需注册码',
  staff: '仅管理员',
};

const VISIBILITY_OPTIONS = ['public', 'login', 'invite', 'staff'] as const;

/** 卡片审核状态文案与颜色（复用徽章类）。 */
const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: '待站长审核', className: 'badge-warn' },
  approved: { label: '已通过', className: 'badge-ok' },
  rejected: { label: '已拒绝', className: 'badge-err' },
};

const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const;
const UNIT_W = 162; // 150px 列宽 + 12px 间距
const UNIT_H = 122; // 110px 行高 + 12px 间距

/** 下载区卡片门户后台编辑器：增删改 + 无限套娃（树形展示）+ 可视化拖拽缩放。 */
export function CardsPanel() {
  const router = useRouter();
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 新增卡片时默认放进哪张卡片里（点「+ 子卡片」会带过来）。 */
  const [newParentId, setNewParentId] = useState('');
  /** 正在拖拽改尺寸的卡片 id（null = 没在拖）。 */
  const [resizingId, setResizingId] = useState<string | null>(null);
  /** 折叠起来的容器卡片 id（只影响编辑器里的子卡片展示，伸缩式）。 */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [myRole, setMyRole] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const selected = cards.find((card) => card.id === selectedId) ?? null;
  const containers = cards.filter((card) => card.kind === 'container');
  const isOwner = myRole === 'owner';

  useEffect(() => {
    void getSession().then((user) => setMyRole(user?.role ?? null));
  }, []);

  /** 某张卡片的全部子孙（用于防止把卡片拖进自己的子卡片里形成环）。 */
  function descendantIds(cardId: string): Set<string> {
    const found = new Set<string>();
    const walk = (id: string) => {
      for (const child of cards.filter((card) => card.parentId === id)) {
        if (found.has(child.id)) continue;
        found.add(child.id);
        walk(child.id);
      }
    };
    walk(cardId);
    return found;
  }

  /** 可以作为父卡片的候选：容器类，且不能是自己或自己的子孙。 */
  function parentCandidates(excludeId?: string): AdminCard[] {
    const blocked = excludeId ? descendantIds(excludeId) : new Set<string>();
    return containers.filter((card) => card.id !== excludeId && !blocked.has(card.id));
  }

  function parentTitle(parentId: string | null): string | null {
    if (!parentId) return null;
    return cards.find((card) => card.id === parentId)?.title ?? null;
  }

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
      subtitleUrl: String(fd.get('subtitleUrl') ?? '').trim() || null,
      kind,
      visibility: String(fd.get('visibility') ?? 'public'),
      parentId: newParentId || null,
      redirectUrl: kind === 'redirect' ? String(fd.get('redirectUrl') ?? '') : null,
      w: 1,
      h: 1,
    };
    try {
      const created = await apiFetch<{ card: AdminCard }>('/api/admin/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      form.reset();
      setNewParentId('');
      await refresh();
      router.refresh();
      setMessage(
        created.card.status === 'pending'
          ? '已创建，站长审核通过后才会出现在下载区'
          : '已创建并通过审核（站长）',
      );
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
          subtitleUrl: String(fd.get('subtitleUrl') ?? '').trim() || null,
          kind,
          visibility: String(fd.get('visibility') ?? 'public'),
          // 允许把已有卡片移动到另一张卡片里（真正的「套娃」开关）。
          parentId: fd.get('parentId') ? String(fd.get('parentId')) : null,
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

  /**
   * 拖拽改尺寸。
   *
   * 用 window 上的 pointermove/pointerup，而不是把手元素自己的事件：这样即使
   * 指针移出把手、离开卡片、甚至离开视口，拖动依然跟随，松手也一定能落库。
   */
  useEffect(() => {
    if (!resizingId) return;

    function onMove(event: PointerEvent) {
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
      if (w === d.w && h === d.h) return;
      d.w = w;
      d.h = h;
      setCards((prev) => prev.map((card) => (card.id === d.cardId ? { ...card, w, h } : card)));
    }

    function onUp() {
      const d = dragRef.current;
      setResizingId(null);
      dragRef.current = null;
      if (!d || (d.w === d.startW && d.h === d.startH)) return;
      void apiFetch(`/api/admin/cards/${d.cardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ w: d.w, h: d.h }),
      })
        .then(() => router.refresh())
        .catch(() => {
          /* 保存失败不回滚，下次刷新仍是服务端的值 */
        });
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizingId, router]);

  function startResize(event: ReactPointerEvent<HTMLSpanElement>, card: AdminCard, handle: string) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      cardId: card.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startW: card.w,
      startH: card.h,
      w: card.w,
      h: card.h,
    };
    setSelectedId(card.id);
    setResizingId(card.id);
  }

  /** 编辑框里的数字宽高：不想拖拽时直接填。 */
  async function saveSize(card: AdminCard, w: number, h: number) {
    const nextW = Math.min(6, Math.max(1, Math.round(w) || 1));
    const nextH = Math.min(6, Math.max(1, Math.round(h) || 1));
    setCards((prev) => prev.map((entry) => (entry.id === card.id ? { ...entry, w: nextW, h: nextH } : entry)));
    try {
      await apiFetch(`/api/admin/cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ w: nextW, h: nextH }),
      });
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '尺寸保存失败');
    }
  }

  /** 折叠/展开某张容器卡片的子层（伸缩式）。 */
  function toggleCollapse(cardId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function setAllCollapsed(collapsed: boolean) {
    const parentsWithChildren = new Set<string>(
      cards.filter((card) => card.parentId !== null).map((card) => card.parentId as string),
    );
    setCollapsedIds(collapsed ? parentsWithChildren : new Set());
  }

  /** 站长审核卡片：通过即公开可见。 */
  async function review(card: AdminCard, decision: 'approve' | 'reject') {
    setMessage(null);
    try {
      await apiFetch(`/api/admin/cards/${card.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      setMessage(decision === 'approve' ? `「${card.title}」已通过审核，现在对外可见` : `「${card.title}」已拒绝`);
      await refresh();
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '审核失败');
    }
  }

  /**
   * 树形渲染：每一层单独一个网格，子层带缩进和「属于哪张卡片」的标题。
   * 容器卡片可以折叠/展开它的子层（伸缩式）。
   */
  function renderLevel(parentId: string | null, depth: number): React.ReactNode {
    const items = cards.filter((card) => card.parentId === parentId);
    const subContainers = items.filter((card) => card.kind === 'container');

    return (
      <div key={parentId ?? 'root'} style={{ display: 'grid', gap: '0.6rem' }}>
        {depth > 0 && !collapsedIds.has(parentId as string) && (
          <p className="card-editor-level-title" style={{ marginLeft: (depth - 1) * 18 }}>
            「{parentTitle(parentId)}」内的子卡片 · 第 {depth} 层（{items.length}）
          </p>
        )}

        {items.length > 0 ? (
          <div className="card-editor-grid" style={{ marginLeft: (depth - 1) * 18 > 0 ? (depth - 1) * 18 : undefined }}>
            {items.map((card) => {
              const childCount = cards.filter((entry) => entry.parentId === card.id).length;
              const statusMeta = STATUS_META[card.status] ?? { label: card.status, className: 'badge-neutral' };
              return (
                <div
                  key={card.id}
                  className={`card-editor-tile${selectedId === card.id ? ' selected' : ''}${resizingId === card.id ? ' resizing' : ''}`}
                  style={{ gridColumn: `span ${card.w}`, gridRow: `span ${card.h}` }}
                  onClick={() => setSelectedId(card.id)}
                >
                  <div className="ct-title">{card.title}</div>
                  <div className="ct-meta">
                    {card.kind} · {VISIBILITY_LABELS[card.visibility] ?? card.visibility} · {card.w}×{card.h}
                    <span className={`badge ${statusMeta.className}`} style={{ marginLeft: '0.35rem' }}>
                      {statusMeta.label}
                    </span>
                  </div>
                  {card.kind !== 'container' && <div className="ct-meta">（不能再往里放卡片）</div>}
                  <button
                    type="button"
                    className="ct-add-child"
                    title="在这张卡片里新增子卡片"
                    onClick={(event) => {
                      event.stopPropagation();
                      setNewParentId(card.id);
                      setSelectedId(card.id);
                      titleRef.current?.focus();
                    }}
                  >
                    + 子卡片
                  </button>
                  {/* 伸缩式：容器卡片可展开/折叠子层 */}
                  {card.kind === 'container' && childCount > 0 && (
                    <button
                      type="button"
                      className="ct-collapse"
                      title={collapsedIds.has(card.id) ? '展开子卡片' : '折叠子卡片'}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapse(card.id);
                      }}
                    >
                      {collapsedIds.has(card.id) ? `▸ ${childCount}` : `▾ ${childCount}`}
                    </button>
                  )}
                  {HANDLES.map((h) => (
                    <span
                      key={h}
                      className={`resize-handle handle-${h}`}
                      title="拖动调整大小"
                      onPointerDown={(e) => startResize(e, card, h)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          depth === 0 && <p style={{ color: 'var(--muted)' }}>还没有卡片，先新增一张。</p>
        )}

        {/* 折叠的子层不渲染；审核通过/拒绝按钮在选中卡片的编辑框里 */}
        {!collapsedIds.has(parentId as string) &&
          subContainers.map((child) => renderLevel(child.id, depth + 1))}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.1rem', background: 'var(--surface)' }}>
      <h3 style={{ margin: 0 }}>下载区卡片门户</h3>
      <p style={{ margin: '0.25rem 0 0.8rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
        卡片无限套娃（子卡片可折叠/展开）；管理员新建的卡片要<strong>站长审核</strong>后才对外可见。
        点击卡片可编辑并移动层级，拖动圆点改尺寸。
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <button type="button" onClick={() => setAllCollapsed(true)}>全部折叠</button>
        <button type="button" onClick={() => setAllCollapsed(false)}>全部展开</button>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {isOwner ? '你是站长：待审核卡片可直接通过/拒绝' : '你是管理员：新卡片待站长审核'}
        </span>
      </div>

      <form onSubmit={submit} style={{ display: 'grid', gap: '0.45rem', marginBottom: '1rem', maxWidth: 620 }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            ref={titleRef}
            name="title"
            placeholder="卡片标题"
            required
            style={{ flex: '1 1 160px', padding: '0.4rem' }}
          />
          <input name="subtitle" placeholder="副标题（可选）" style={{ flex: '1 1 160px', padding: '0.4rem' }} />
          <input name="subtitleUrl" placeholder="简介文字跳转链接（可选，https://…）" style={{ flex: '1 1 200px', padding: '0.4rem' }} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select name="kind" style={{ padding: '0.4rem' }}>
            <option value="container">套娃（可放子卡片）</option>
            <option value="redirect">外链跳转</option>
            <option value="resources">资源列表</option>
          </select>
          <select name="visibility" style={{ padding: '0.4rem' }}>
            {VISIBILITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {VISIBILITY_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            name="parentId"
            value={newParentId}
            onChange={(event) => setNewParentId(event.target.value)}
            style={{ padding: '0.4rem' }}
            aria-label="放进哪张卡片"
          >
            <option value="">根层（下载区首页）</option>
            {parentCandidates().map((card) => (
              <option key={card.id} value={card.id}>
                在「{card.title}」内
              </option>
            ))}
          </select>
        </div>
        <input name="redirectUrl" placeholder="外链地址（仅「外链跳转」时用）" style={{ padding: '0.4rem' }} />
        <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
          {newParentId ? `新增子卡片到「${parentTitle(newParentId)}」` : '新增卡片'}
        </button>
      </form>

      {selected && (
        <form
          key={selected.id}
          onSubmit={saveSelected}
          style={{ display: 'grid', gap: '0.45rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--accent-strong)', borderRadius: 12 }}
        >
          <strong>编辑：{selected.title}</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input name="title" defaultValue={selected.title} placeholder="标题" required style={{ flex: '1 1 160px', padding: '0.4rem' }} />
            <input name="subtitle" defaultValue={selected.subtitle} placeholder="副标题" style={{ flex: '1 1 160px', padding: '0.4rem' }} />
            <input name="subtitleUrl" defaultValue={selected.subtitleUrl ?? ''} placeholder="简介文字跳转链接（可选）" style={{ flex: '1 1 200px', padding: '0.4rem' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select name="kind" defaultValue={selected.kind} style={{ padding: '0.4rem' }}>
              <option value="container">套娃（可放子卡片）</option>
              <option value="redirect">外链跳转</option>
              <option value="resources">资源列表</option>
            </select>
            <select name="visibility" defaultValue={selected.visibility} style={{ padding: '0.4rem' }}>
              {VISIBILITY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {VISIBILITY_LABELS[value]}
                </option>
              ))}
            </select>
            <select
              name="parentId"
              defaultValue={selected.parentId ?? ''}
              style={{ padding: '0.4rem' }}
              aria-label="所属卡片"
            >
              <option value="">根层（下载区首页）</option>
              {parentCandidates(selected.id).map((card) => (
                <option key={card.id} value={card.id}>
                  移动到「{card.title}」内
                </option>
              ))}
            </select>
          </div>
          <input name="redirectUrl" defaultValue={selected.redirectUrl ?? ''} placeholder="外链地址" style={{ padding: '0.4rem' }} />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              宽
              <input
                type="number"
                min={1}
                max={6}
                value={selected.w}
                onChange={(event) => void saveSize(selected, Number(event.target.value), selected.h)}
                style={{ width: 64, padding: '0.3rem 0.4rem' }}
              />
            </label>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              高
              <input
                type="number"
                min={1}
                max={6}
                value={selected.h}
                onChange={(event) => void saveSize(selected, selected.w, Number(event.target.value))}
                style={{ width: 64, padding: '0.3rem 0.4rem' }}
              />
            </label>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              （1–6 个网格单位，也可直接拖动卡片四周的圆点）
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="submit" className="primary">
              保存
            </button>
            <button type="button" onClick={() => void remove(selected)} style={{ color: '#dc2626' }}>
              删除
            </button>
            {isOwner && selected.status === 'pending' && (
              <>
                <button type="button" className="primary" onClick={() => void review(selected, 'approve')}>
                  通过审核
                </button>
                <button type="button" style={{ color: '#dc2626' }} onClick={() => void review(selected, 'reject')}>
                  拒绝
                </button>
              </>
            )}
            {!isOwner && selected.status === 'pending' && (
              <span className="muted" style={{ alignSelf: 'center', fontSize: '0.8rem' }}>
                待站长审核
              </span>
            )}
          </div>
        </form>
      )}

      {message && <p style={{ color: message.includes('失败') ? '#dc2626' : 'var(--accent-strong)' }}>{message}</p>}

      {renderLevel(null, 0)}
    </div>
  );
}
