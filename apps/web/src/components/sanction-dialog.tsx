'use client';

import { useEffect, useState } from 'react';

/**
 * 封禁 / 禁言弹窗：时长用「xx 月 xx 时 xx 分」三段填写，全为 0 即永久。
 *
 * 管理后台的用户列表和论坛页面的「封禁/禁言」按钮共用同一个组件，保证两边
 * 交互与文案完全一致。
 */

export type SanctionKind = 'ban' | 'mute';

export interface SanctionTarget {
  id: string;
  username: string;
  displayName?: string;
}

export interface DurationParts {
  months: number;
  hours: number;
  minutes: number;
}

const ZERO: DurationParts = { months: 0, hours: 0, minutes: 0 };

/** 加月份并夹住日期（1/31 + 1 月 = 2/28，而不是 3/3）。 */
function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

/** 把「月/时/分」换算成到期时间；全为 0 返回 null（= 永久）。 */
export function untilFromParts(parts: DurationParts): string | null {
  const months = Math.max(0, Math.floor(parts.months || 0));
  const hours = Math.max(0, Math.floor(parts.hours || 0));
  const minutes = Math.max(0, Math.floor(parts.minutes || 0));
  if (months === 0 && hours === 0 && minutes === 0) return null;
  let date = addMonths(new Date(), months);
  date = new Date(date.getTime() + hours * 3_600_000 + minutes * 60_000);
  return date.toISOString();
}

/** 人类可读的时长文案：「2 月 3 时 5 分」。 */
export function durationLabel(parts: DurationParts): string {
  const chunks: string[] = [];
  if (parts.months > 0) chunks.push(`${parts.months} 月`);
  if (parts.hours > 0) chunks.push(`${parts.hours} 时`);
  if (parts.minutes > 0) chunks.push(`${parts.minutes} 分`);
  return chunks.length > 0 ? chunks.join(' ') : '永久';
}

/**
 * 剩余时间文案。`until === null` 对已生效的封禁/禁言意味着永久；对未生效的
 * 返回 null 表示无需展示。
 */
export function remainingLabel(until: string | null | undefined): string | null {
  if (until === undefined) return null;
  if (until === null) return '永久';
  const ms = new Date(until).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return '已到期';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const chunks: string[] = [];
  if (days > 0) chunks.push(`${days} 天`);
  if (hours > 0) chunks.push(`${hours} 时`);
  if (minutes > 0 && days === 0) chunks.push(`${minutes} 分`);
  return `剩余 ${chunks.join(' ')}`;
}

export function SanctionDialog({
  kind,
  target,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  kind: SanctionKind;
  target: SanctionTarget;
  onClose: () => void;
  onSubmit: (input: { until: string | null; reason: string }) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  const [parts, setParts] = useState<DurationParts>(ZERO);
  const [reason, setReason] = useState(kind === 'ban' ? '由管理员封禁' : '由管理员禁言');

  useEffect(() => {
    setParts(ZERO);
    setReason(kind === 'ban' ? '由管理员封禁' : '由管理员禁言');
  }, [kind, target.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = kind === 'ban' ? '封禁用户' : '禁言用户';
  const field = (key: keyof DurationParts, label: string) => (
    <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
      {label}
      <input
        type="number"
        min={0}
        max={key === 'months' ? 120 : 999}
        value={parts[key]}
        onChange={(event) =>
          setParts({ ...parts, [key]: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })
        }
        style={{ width: 90, padding: '0.35rem 0.45rem' }}
      />
    </label>
  );

  return (
    <div className="modal-backdrop modal-layer-top" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="modal-title">
          {title} · {target.displayName || target.username}
          <span className="muted"> @{target.username}</span>
        </p>
        <p className="muted" style={{ margin: '0 0 0.75rem' }}>
          时长按「月 / 时 / 分」填写，<strong>全部填 0 即为永久</strong>。
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {field('months', '月')}
          {field('hours', '时')}
          {field('minutes', '分')}
        </div>
        <p style={{ margin: '0.6rem 0' }}>
          实际时长：<strong>{durationLabel(parts)}</strong>
        </p>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          原因（可选）
          <input
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            style={{ padding: '0.35rem 0.45rem' }}
          />
        </label>
        {error && <p style={{ color: '#dc2626', margin: '0.6rem 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void onSubmit({ until: untilFromParts(parts), reason })}
          >
            {busy ? '处理中…' : `确认${kind === 'ban' ? '封禁' : '禁言'}`}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
