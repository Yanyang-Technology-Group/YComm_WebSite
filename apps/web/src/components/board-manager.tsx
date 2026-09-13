'use client';

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

interface AdminBoard {
  id: string;
  slug: string;
  name: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
  visibility: 'public' | 'login' | 'invite';
  minLevel: number;
  requireInvite: boolean;
  archivedAt: string | null;
  createdAt: string;
}

const VIS_LABELS: Record<AdminBoard['visibility'], string> = {
  public: '所有人可读',
  login: '需登录',
  invite: '需邀请码',
};

export function BoardManager() {
  const [boards, setBoards] = useState<AdminBoard[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await apiFetch<{ boards: AdminBoard[] }>('/api/admin/boards');
      setBoards(data.boards);
    } catch (caught) {
      setMsg(caught instanceof Error ? caught.message : '加载失败');
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (caught) {
      setMsg(caught instanceof Error ? caught.message : '操作失败');
    }
  }

  function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch('/api/admin/boards', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: String(fd.get('slug') ?? '').trim(),
            name: String(fd.get('name') ?? '').trim(),
            description: String(fd.get('description') ?? '').trim(),
            visibility: String(fd.get('visibility') ?? 'public'),
            sortOrder: Number(fd.get('sortOrder') ?? 100) || 100,
          }),
        }),
      '版块已创建',
    );
    e.currentTarget.reset();
  }

  function startEdit(board: AdminBoard) {
    setEditingId(board.id);
    setDraft({
      name: board.name,
      description: board.description,
      sortOrder: String(board.sortOrder),
      visibility: board.visibility,
    });
  }

  function saveEdit(board: AdminBoard) {
    void run(
      () =>
        apiFetch(`/api/admin/boards/${board.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: draft.name?.trim() || board.name,
            description: draft.description?.trim() ?? board.description,
            sortOrder: Number(draft.sortOrder) || board.sortOrder,
            visibility: draft.visibility,
          }),
        }),
      '已保存',
    );
    setEditingId(null);
  }

  function remove(board: AdminBoard) {
    if (!window.confirm(`归档删除版块「${board.name}」？（主题与回帖数据保留）`)) return;
    void run(() => apiFetch(`/api/admin/boards/${board.id}`, { method: 'DELETE' }), '已归档删除');
  }

  function restore(board: AdminBoard) {
    void run(() => apiFetch(`/api/admin/boards/${board.id}/restore`, { method: 'POST' }), '已恢复上线');
  }

  const visible = boards.filter((board) => !board.archivedAt);
  const archived = boards.filter((board) => board.archivedAt);

  const inputStyle: CSSProperties = { padding: '0.45rem 0.6rem' };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      {msg && (
        <p style={{ color: msg.startsWith('已') || msg.includes('已') ? '#16a34a' : '#dc2626', margin: 0 }}>
          {msg}
        </p>
      )}

      <form onSubmit={submitCreate} className="panel" style={{ maxWidth: 520 }}>
        <p className="panel-title">新建版块</p>
        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
          <input name="slug" placeholder="slug（小写字母/数字/连字符）" required style={inputStyle} />
          <input name="name" placeholder="版块名称（如：综合讨论）" required style={inputStyle} />
          <input name="description" placeholder="版块描述" style={{ ...inputStyle, gridColumn: '1 / -1' }} />
          <select name="visibility" defaultValue="public" style={inputStyle}>
            <option value="public">所有人可读</option>
            <option value="login">需登录</option>
            <option value="invite">需邀请码</option>
          </select>
          <input name="sortOrder" type="number" placeholder="排序（越小越靠前）" defaultValue={100} style={inputStyle} />
        </div>
        <button type="submit" className="primary" style={{ marginTop: '0.6rem' }}>
          创建版块
        </button>
      </form>

      <section>
        <h2 className="section-title">当前版块（{visible.length}）</h2>
        {visible.length === 0 && <p className="muted">还没有版块，先在上面创建一个。</p>}
        {visible.map((board) => (
          <div key={board.id} className="card" style={{ display: 'grid', gap: '0.55rem' }}>
            {editingId === board.id ? (
              <>
                <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
                  <input
                    value={draft.name ?? ''}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    style={inputStyle}
                    aria-label="版块名称"
                  />
                  <select
                    value={draft.visibility ?? board.visibility}
                    onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}
                    style={inputStyle}
                    aria-label="访问设置"
                  >
                    <option value="public">所有人可读</option>
                    <option value="login">需登录</option>
                    <option value="invite">需邀请码</option>
                  </select>
                  <input
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="描述"
                    style={{ ...inputStyle, gridColumn: '1 / -1' }}
                    aria-label="描述"
                  />
                  <input
                    value={draft.sortOrder ?? '100'}
                    onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                    type="number"
                    style={inputStyle}
                    aria-label="排序"
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="primary" onClick={() => saveEdit(board)}>
                      保存
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{board.name}</strong>
                  <span className="muted" style={{ marginLeft: '0.5rem', fontFamily: 'monospace' }}>
                    /{board.slug}
                  </span>
                  {board.description && (
                    <div className="muted" style={{ marginTop: '0.15rem' }}>
                      {board.description}
                    </div>
                  )}
                  <div className="badge">{VIS_LABELS[board.visibility]}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="muted">排序 {board.sortOrder}</span>
                  <button type="button" onClick={() => startEdit(board)}>
                    编辑
                  </button>
                  <button type="button" onClick={() => remove(board)} style={{ color: '#dc2626' }}>
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      {archived.length > 0 && (
        <section>
          <h2 className="section-title">已归档（{archived.length}）</h2>
          {archived.map((board) => (
            <div key={board.id} className="card" style={{ opacity: 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <strong>{board.name}</strong>
                  <span className="muted" style={{ marginLeft: '0.5rem', fontFamily: 'monospace' }}>
                    /{board.slug}
                  </span>
                  <span className="badge">已归档</span>
                </div>
                <button type="button" onClick={() => restore(board)}>
                  恢复
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}