'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/time';

interface SessionView {
  id: string;
  /** 由 User-Agent 推断的展示名（仅用于显示）。 */
  device: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

interface TrustedDevice {
  id: string;
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * 登录设备管理（控制台 → 账号安全）：
 * 列出当前账号的有效登录会话（一次登录 = 一条会话），可退出其他设备；
 * 另列出已确认的设备指纹 —— 撤销后那台设备下次登录要重新用邮箱确认。
 * 当前会话不提供远程退出按钮 —— 用右上角「退出登录」。
 */
export function LoginDevicesPanel() {
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [currentTrusted, setCurrentTrusted] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoadError(null);
    try {
      const data = await apiFetch<{ sessions: SessionView[] }>('/api/auth/sessions');
      setSessions(data.sessions);
      const trusted = await apiFetch<{ devices: TrustedDevice[]; currentDeviceTrusted: boolean }>(
        '/api/auth/trusted-devices',
      );
      setDevices(trusted.devices);
      setCurrentTrusted(trusted.currentDeviceTrusted);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '加载失败');
    }
  }

  async function revokeDevice(device: TrustedDevice) {
    if (
      !window.confirm(
        `撤销对「${device.label}」的信任？该设备上的登录会立刻失效，下次登录需要用邮箱重新确认。`,
      )
    ) {
      return;
    }
    setBusyId(device.id);
    setFeedback(null);
    try {
      await apiFetch(`/api/auth/trusted-devices/${encodeURIComponent(device.id)}`, { method: 'DELETE' });
      await refresh();
      setFeedback({ text: '已撤销该设备。', isError: false });
    } catch (caught) {
      setFeedback({ text: caught instanceof Error ? caught.message : '撤销失败', isError: true });
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOne(session: SessionView) {
    if (!window.confirm(`退出「${session.device}」上的登录？该设备需要重新登录。`)) return;
    setBusyId(session.id);
    setFeedback(null);
    try {
      await apiFetch(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      await refresh();
      setFeedback({ text: '已退出该设备。', isError: false });
    } catch (caught) {
      setFeedback({ text: caught instanceof Error ? caught.message : '退出失败', isError: true });
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    if (!window.confirm('退出其他所有设备的登录？它们都需要重新登录，当前设备不受影响。')) return;
    setBusy(true);
    setFeedback(null);
    try {
      const data = await apiFetch<{ revokedCount: number }>('/api/auth/sessions/revoke-others', {
        method: 'POST',
      });
      await refresh();
      setFeedback({
        text: data.revokedCount > 0 ? `已退出其他 ${data.revokedCount} 个设备。` : '没有其他需要退出的设备。',
        isError: false,
      });
    } catch (caught) {
      setFeedback({ text: caught instanceof Error ? caught.message : '操作失败', isError: true });
    } finally {
      setBusy(false);
    }
  }

  const others = (sessions ?? []).filter((session) => !session.isCurrent);

  return (
    <div className="panel" style={{ marginBottom: 0, maxWidth: 760 }}>
      <p className="panel-title">登录设备管理</p>
      <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
        一次登录就是一条会话（同一台设备上的不同浏览器或 App 分别列出）。这里显示你当前有效的登录；
        退出其他设备后，对应设备需要重新登录。当前设备请用页面右上角的「退出登录」。
      </p>

      {loadError && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, color: '#dc2626' }}>加载失败：{loadError}</p>
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}

      {sessions === null && !loadError && <p className="muted">加载中…</p>}

      {sessions !== null && !loadError && (
        <>
          {others.length > 0 && (
            <div style={{ marginBottom: '0.6rem' }}>
              <button type="button" onClick={() => void revokeOthers()} disabled={busy || busyId !== null} style={{ color: '#dc2626' }}>
                {busy ? '处理中…' : '退出所有其他设备'}
              </button>
            </div>
          )}

          {feedback && (
            <p style={{ color: feedback.isError ? '#dc2626' : 'var(--accent-strong)' }}>{feedback.text}</p>
          )}

          {sessions.length === 0 ? (
            <p className="muted">没有有效的登录会话。</p>
          ) : (
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>设备</th>
                    <th style={thStyle}>IP</th>
                    <th style={thStyle}>登录时间</th>
                    <th style={thStyle}>最近活跃</th>
                    <th style={thStyle}>过期时间</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td style={tdStyle}>
                        {session.device}
                        {session.isCurrent && (
                          <span
                            style={{
                              marginLeft: '0.4rem',
                              fontSize: '0.75rem',
                              padding: '0.1rem 0.4rem',
                              borderRadius: 6,
                              background: 'var(--accent-soft)',
                              color: 'var(--accent-strong)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            当前设备
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>{session.ip ?? '未知'}</td>
                      <td style={tdStyle}>{formatDateTime(session.createdAt)}</td>
                      <td style={tdStyle}>{session.lastUsedAt ? formatDateTime(session.lastUsedAt) : '暂无记录'}</td>
                      <td style={tdStyle}>{formatDateTime(session.expiresAt)}</td>
                      <td style={tdStyle}>
                        {!session.isCurrent && (
                          <button
                            type="button"
                            onClick={() => void revokeOne(session)}
                            disabled={busy || busyId !== null}
                            style={{ color: '#dc2626' }}
                          >
                            {busyId === session.id ? '处理中…' : '退出此设备'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 受信任设备：新设备登录要先在邮箱里确认一次，确认过的设备列在这里 */}
      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '1.2rem 0 0.9rem' }} />
      <p className="panel-title" style={{ fontSize: '1rem' }}>
        受信任设备
      </p>
      <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
        新设备第一次登录时，我们会在邮件里让你确认一次；确认过的设备记在这里。撤销之后，那台设备上的登录会立刻失效，
        下次登录要重新用邮箱确认。
        {!currentTrusted && '（当前设备还没确认，请查收确认邮件。）'}
      </p>

      {devices === null ? (
        <p className="muted">加载中…</p>
      ) : devices.length === 0 ? (
        <p className="muted">还没有已确认的设备。</p>
      ) : (
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={thStyle}>设备</th>
                <th style={thStyle}>首次确认</th>
                <th style={thStyle}>最近使用</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td style={tdStyle}>{device.label || '未知设备'}</td>
                  <td style={tdStyle}>{formatDateTime(device.firstSeenAt)}</td>
                  <td style={tdStyle}>{formatDateTime(device.lastSeenAt)}</td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => void revokeDevice(device)}
                      disabled={busy || busyId !== null}
                      style={{ color: '#dc2626' }}
                    >
                      {busyId === device.id ? '处理中…' : '撤销信任'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border)' };
const tdStyle: React.CSSProperties = { padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border)' };
