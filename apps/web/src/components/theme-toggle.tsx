'use client';

import { useEffect, useState } from 'react';
import { playAnim } from '../lib/anim';

export const THEMES = [
  { id: 'azure', label: '晏阳蓝', swatch: '#5da4fa', desc: '默认 · 清爽通透' },
  { id: 'pink', label: '猛男粉', swatch: '#FF9999', desc: '温柔可爱' },
  { id: 'mint', label: '草神绿', swatch: '#B2FF66', desc: '清新自然' },
  { id: 'light', label: '浅色', swatch: '#f4f4f5', desc: '简洁明亮' },
  { id: 'dark', label: '深色', swatch: '#23272f', desc: '夜间护眼' },
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
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (saved && THEMES.some((theme) => theme.id === saved)) return saved;
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
  return (document.documentElement.dataset.theme as ThemeId) || 'azure';
}

/**
 * 主题选择器 —— 放在个人控制台里。
 * 每个主题一张可点选的卡片：色块 + 名称 + 说明，选中的带高亮对勾。
 */
export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>('azure');

  useEffect(() => {
    setTheme(initialTheme());
  }, []);

  function choose(next: ThemeId) {
    if (next !== theme) playAnim('theme');
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div className="theme-picker">
      {THEMES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={`theme-option${theme === entry.id ? ' active' : ''}`}
          onClick={() => choose(entry.id)}
          aria-pressed={theme === entry.id}
        >
          <span className="theme-swatch" style={{ background: entry.swatch }} />
          <span className="theme-meta">
            <span className="theme-label">
              {entry.label}
              {theme === entry.id ? ' ✓' : ''}
            </span>
            <span className="theme-desc">{entry.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}