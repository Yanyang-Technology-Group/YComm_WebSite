'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorIp: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** 已知动作的中文说明；未知动作原样显示，方便排查。 */
const ACTION_LABELS: Record<string, string> = {
  'admin.user.role_changed': '变更用户角色',
  'admin.user.banned': '封禁用户',
  'admin.user.unbanned': '解除封禁',
  'admin.user.muted': '禁言用户',
  'admin.user.unmuted': '解除禁言',
  'admin.user.deleted': '立即注销账号',
  'admin.settings.updated': '修改站点设置',
  'admin.invite.created': '创建注册码',
  'admin.invite.deleted': '删除注册码',
  'admin.card.created': '新增下载卡片',
  'admin.card.updated': '修改下载卡片',
  'admin.card.deleted': '删除下载卡片',
  'admin.card.approved': '通过下载卡片审核',
  'admin.card.rejected': '拒绝下载卡片',
  'admin.user.password_reset': '站长重置用户密码',
  'auth.password_set': '创建账号密码',
  'auth.oauth_bind': '绑定 GitHub 登录',
  'user.follow': '关注用户',
  'user.unfollow': '取消关注',
  'admin.board.created': '新增版块',
  'admin.board.updated': '修改版块',
  'admin.board.archived': '归档版块',
  'admin.board.restored': '恢复版块',
  'admin.topic.pin': '置顶主题',
  'admin.topic.unpin': '取消置顶',
  'admin.topic.lock': '锁定主题',
  'admin.topic.unlock': '解锁主题',
  'admin.topic.move': '移动主题',
  'admin.topic.delete': '删除主题',
  'admin.topic.deleted': '删除他人主题',
  'admin.post.deleted': '删除他人帖子',
  'moderation.approve': '审核通过',
  'moderation.reject': '审核驳回',
  'auth.login': '密码登录',
  'auth.oauth_login': 'GitHub 登录',
  'user.registered': '注册账号',
  'user.email_verified': '验证邮箱',
  'account.deletion_requested': '申请注销账号',
  'account.deletion_cancelled': '取消注销',
  'owner.password_recovered': '站长重置密码',
  'forum.post.deleted_own': '删除自己的帖子',
  'forum.topic.deleted_own': '删除自己的主题',
};

const TARGET_LABELS: Record<string, string> = {
  user: '用户',
  board: '版块',
  topic: '主题',
  post: '帖子',
  download_card: '下载卡片',
  download_resource: '下载资源',
  download_link: '下载链接',
  invite_code: '注册码',
};

/** 审计类别筛选：值会作为 action 前缀传给 API。 */
const FILTERS = [
  { value: '', label: '全部动作' },
  { value: 'admin.', label: '管理动作' },
  { value: 'moderation.', label: '内容审核' },
  { value: 'forum.', label: '论坛自助' },
  { value: 'auth.', label: '登录' },
  { value: 'user.', label: '注册/验证' },
  { value: 'account.', label: '注销相关' },
] as const;

const PAGE_SIZE = 50;

/** meta 里没用的空值不显示；值太长就截断。 */
function formatMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text || text === '{}' || text === '[]') continue;
    parts.push(`${key}=${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
  }
  return parts.join(' · ');
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFilter: string, nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (nextFilter) query.set('action', nextFilter);
      const data = await apiFetch<{ entries: AuditEntry[]; total: number }>(
        `/api/admin/audit?${query.toString()}`,
      );
      setEntries(data.entries);
      setTotal(data.total);
    } catch (caught) {
      setEntries([]);
      setTotal(0);
      setError(caught instanceof Error ? caught.message : '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter, offset);
  }, [filter, offset, load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filter}
          onChange={(event) => {
            setOffset(0);
            setFilter(event.target.value);
          }}
          style={{ padding: '0.4rem' }}
          aria-label="日志类别"
        >
          {FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void load(filter, offset)} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
        <span className="muted" style={{ fontSize: '0.9rem' }}>
          共 {total} 条
        </span>
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {entries.length === 0 && !loading ? (
        <p className="muted">暂无日志记录。</p>
      ) : (
        <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>时间</th>
                <th style={thStyle}>操作者</th>
                <th style={thStyle}>动作</th>
                <th style={thStyle}>对象</th>
                <th style={thStyle}>详情</th>
                <th style={thStyle}>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const detail = formatMeta(entry.meta);
                return (
                  <tr key={entry.id}>
                    <td style={tdStyle}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</td>
                    <td style={tdStyle}>
                      {entry.actorUsername ? (
                        <>
                          {entry.actorDisplayName || entry.actorUsername}
                          <span className="muted"> @{entry.actorUsername}</span>
                        </>
                      ) : (
                        <span className="muted">系统</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {ACTION_LABELS[entry.action] ?? entry.action}
                      <div className="muted" style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>
                        {entry.action}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {entry.targetType ? `${TARGET_LABELS[entry.targetType] ?? entry.targetType}` : '—'}
                      {entry.targetId && (
                        <div className="muted" style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>
                          {entry.targetId.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 320, wordBreak: 'break-all' }}>{detail || '—'}</td>
                    <td style={tdStyle}>{entry.actorIp || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            上一页
          </button>
          <span className="muted">
            第 {page} / {pages} 页
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.3rem 0.5rem',
  borderBottom: '1px solid var(--border)',
};
const tdStyle: React.CSSProperties = {
  padding: '0.45rem 0.5rem',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
};
