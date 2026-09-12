'use client';

import { useEffect, useState } from 'react';

export const THEMES = [
  { id: 'azure', label: '蔚蓝', swatch: '#1d6fd1' },
  { id: 'pink', label: '粉', swatch: '#d4558a' },
  { id: 'mint', label: '清新绿', swatch: '#14996b' },
  { id: 'light', label: '浅色', swatch: '#f5f5f5' },
  { id: 'dark', label: '深色', swatch: '#22262f' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'ycomm_theme';

/** 用户本地主题：写入 <html data-theme> 与 localStorage，只影响自己。 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
}

function initialTheme(): ThemeId {
  if (typeof document === 'undefined') return 'azure';
  const stored = document.documentElement.dataset.theme as ThemeId | undefined;
  if (stored && THEMES.some((theme) => theme.id === stored)) return stored;
  return 'azure';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeId>('azure');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTheme(initialTheme());
  }, []);

  function choose(next: ThemeId) {
    applyTheme(next);
    setTheme(next);
    setOpen(false);
  }

  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="主题颜色"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          background: 'none',
          border: '1px solid rgba(255,255,255,0.25)',
          color: 'var(--header-text)',
          borderRadius: 999,
          padding: '0.2rem 0.6rem',
          fontSize: '0.85rem',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: 999,
            background: THEMES.find((entry) => entry.id === theme)?.swatch ?? '#1d6fd1',
          }}
        />
        主题
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            zIndex: 50,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: '0.4rem',
            display: 'grid',
            gap: '0.15rem',
            minWidth: 130,
          }}
        >
          {THEMES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => choose(entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'none',
                border: 'none',
                color: 'var(--text)',
                padding: '0.35rem 0.6rem',
                textAlign: 'left',
                fontSize: '0.9rem',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: entry.swatch,
                }}
              />
              {entry.label}
              {theme === entry.id ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}