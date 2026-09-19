'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/time';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * 开放 API 密钥管理（仅站长可见）：
 * 创建（明文只显示一次）/ 复制 / 撤销。
 * 使用方式：`Authorization: Bearer <key>`，身份等同站长本人。
 */
export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState('0');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const data = await apiFetch<{ keys: ApiKeyItem[] }>('/api/admin/api-keys');
      setKeys(data.keys);
    } catch {
      setKeys([]);
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    setCreated(null);
    try {
      const data = await apiFetch<{ apiKey: { key: string } }>('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          readOnly,
          expiresInDays: Number(expiresInDays) || 0,
        }),
      });
      setCreated(data.apiKey.key);
      setName('');
      setReadOnly(false);
      setExpiresInDays('0');
      await refresh();
      setMessage('密钥已创建 —— 明文只显示这一次，请立刻复制保存。');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKeyItem) {
    if (!window.confirm(`撤销密钥「${key.name}」？使用它的程序会立刻失效。`)) return;
    setMessage(null);
    try {
      await apiFetch(`/api/admin/api-keys/${key.id}`, { method: 'DELETE' });
      await refresh();
      setMessage('已撤销。');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '撤销失败');
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 复制失败时用户可手动选中复制 */
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        给脚本 / 外部系统用的密钥：请求时带 <code>Authorization: Bearer &lt;key&gt;</code>，
        身份等同<strong>站长本人</strong>（拥有全部权限）。撤销后立即失效。
      </p>

      <form onSubmit={create} className="panel" style={{ display: 'grid', gap: '0.6rem', padding: '1rem', marginBottom: '1rem' }}>
        <p className="section-title" style={{ marginTop: 0 }}>新建密钥</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名称（如：CI 自动建卡）"
            maxLength={60}
            required
            style={{ flex: '1 1 220px', padding: '0.45rem' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
            有效期（天，0=永久）
            <input
              type="number"
              min={0}
              max={3650}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              style={{ width: 90, padding: '0.35rem' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
            只读（只能 GET）
          </label>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            创建
          </button>
        </div>
      </form>

      {created && (
        <div className="panel" style={{ padding: '0.9rem 1rem', marginBottom: '1rem', borderColor: 'var(--accent-strong)' }}>
          <p style={{ margin: '0 0 0.4rem', fontWeight: 700 }}>新密钥（只显示这一次）</p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ wordBreak: 'break-all', background: 'var(--accent-soft)', padding: '0.35rem 0.5rem', borderRadius: 6 }}>
              {created}
            </code>
            <button type="button" onClick={() => void copy()}>
              {copied ? '✓ 已复制' : '复制'}
            </button>
          </div>
          <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.82rem' }}>
            示例：
            <code>curl -H "Authorization: Bearer {created.slice(0, 14)}…" https://community.yanyn.cn/api/admin/cards</code>
          </p>
        </div>
      )}

      {message && <p style={{ color: message.includes('失败') ? '#dc2626' : 'var(--accent-strong)' }}>{message}</p>}

      <p className="section-title">已有密钥（{keys.length}）</p>
      {keys.length === 0 ? (
        <p className="muted">还没有密钥。</p>
      ) : (
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>前缀</th>
                <th style={thStyle}>类型</th>
                <th style={thStyle}>最近使用</th>
                <th style={thStyle}>有效期</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expired = key.expiresAt ? new Date(key.expiresAt).getTime() < Date.now() : false;
                return (
                  <tr key={key.id}>
                    <td style={tdStyle}>{key.name}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{key.prefix}…</td>
                    <td style={tdStyle}>{key.readOnly ? '只读' : '读写'}</td>
                    <td style={tdStyle}>{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '未使用'}</td>
                    <td style={tdStyle}>{key.expiresAt ? formatDateTime(key.expiresAt) : '永久'}</td>
                    <td style={tdStyle}>
                      {key.revokedAt ? '已撤销' : expired ? '已过期' : '生效中'}
                    </td>
                    <td style={tdStyle}>
                      {!key.revokedAt && (
                        <button type="button" onClick={() => void revoke(key)} style={{ color: '#dc2626' }}>
                          撤销
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border)' };
const tdStyle: React.CSSProperties = { padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border)' };