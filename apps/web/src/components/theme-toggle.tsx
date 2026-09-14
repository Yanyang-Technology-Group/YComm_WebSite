'use client';

import { useEffect, useState } from 'react';
import { playAnim } from '../lib/anim';

/**
 * Edge 式主题选择：深色一档 + 浅色一档，各选一个色系，按系统深浅自动切换。
 * 深色档基础统一用深灰（不偏蓝），色系只决定强调色；浅色档统一浅灰底。
 */
export const THEME_FAMILIES = [
  { id: 'azure', label: '晏阳蓝', dark: '#24466e', light: '#bcd3f0' },
  { id: 'pink', label: '猛男粉', dark: '#5c2c38', light: '#f3c2cb' },
  { id: 'mint', label: '草神绿', dark: '#2a4a2c', light: '#c4e3b8' },
  { id: 'orange', label: '活力橙', dark: '#66370f', light: '#ffd2a1' },
  { id: 'slate', label: '灰调', dark: '#3a3f47', light: '#d8d9dc' },
] as const;

export type ThemeFamilyId = (typeof THEME_FAMILIES)[number]['id'];

const STORAGE_KEY = 'ycomm_theme_pair';
const OLD_KEY = 'ycomm_theme';

interface Pair {
  light: ThemeFamilyId;
  dark: ThemeFamilyId;
}

const DEFAULT_PAIR: Pair = { light: 'azure', dark: 'azure' };

/** 把用户本地深浅两档写入 <html> 两个属性，并持久化。 */
export function applyThemePair(pair: Pair): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.lightTheme = pair.light;
  document.documentElement.dataset.darkTheme = pair.dark;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
}

function initialPair(): Pair {
  if (typeof document === 'undefined') return DEFAULT_PAIR;
  try {
    // 旧版单个主题（azure/pink/mint/light/dark）迁移到配对。
    const legacy = localStorage.getItem(OLD_KEY);
    if (legacy && !localStorage.getItem(STORAGE_KEY)) {
      const id = THEME_FAMILIES.some((family) => family.id === legacy) ? (legacy as ThemeFamilyId) : 'azure';
      return { light: id, dark: id };
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Pair>;
      if (parsed.light && parsed.dark) {
        const light = THEME_FAMILIES.some((family) => family.id === parsed.light) ? parsed.light : 'azure';
        const dark = THEME_FAMILIES.some((family) => family.id === parsed.dark) ? parsed.dark : 'azure';
        return { light, dark };
      }
    }
  } catch {
    /* 忽略损坏的存储 */
  }
  const light = document.documentElement.dataset.lightTheme as ThemeFamilyId | undefined;
  const dark = document.documentElement.dataset.darkTheme as ThemeFamilyId | undefined;
  return {
    light: THEME_FAMILIES.some((family) => family.id === light) ? (light as ThemeFamilyId) : 'azure',
    dark: THEME_FAMILIES.some((family) => family.id === dark) ? (dark as ThemeFamilyId) : 'azure',
  };
}

function FamilySwatch({ mode, family }: { mode: 'dark' | 'light'; family: (typeof THEME_FAMILIES)[number] }) {
  return (
    <span
      className="theme-swatch"
      style={{ background: family[mode], boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
    />
  );
}

/**
 * 主题选择器（放控制台 → 外观主题）：
 * 上面一行 = 深色色系，下面一行 = 浅色色系，各勾一个；系统深色时用深色档，浅色时用浅色档。
 */
export function ThemePicker() {
  const [pair, setPair] = useState<Pair>(DEFAULT_PAIR);

  useEffect(() => {
    setPair(initialPair());
  }, []);

  function choose(mode: 'dark' | 'light', family: ThemeFamilyId) {
    const next = { ...pair, [mode]: family };
    playAnim('theme');
    applyThemePair(next);
    setPair(next);
  }

  const row = (mode: 'dark' | 'light', title: string, desc: string) => (
    <div>
      <p style={{ margin: '0 0 0.4rem' }}>
        <strong>{title}</strong>{' '}
        <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>
          {desc}
        </span>
      </p>
      <div className="theme-picker" style={{ flexWrap: 'wrap' }}>
        {THEME_FAMILIES.map((family) => {
          const active = pair[mode] === family.id;
          return (
            <button
              key={family.id}
              type="button"
              className={`theme-option${active ? ' active' : ''}`}
              onClick={() => choose(mode, family.id)}
              aria-pressed={active}
            >
              <FamilySwatch mode={mode} family={family} />
              <span className="theme-label">
                {mode === 'dark' ? '深色' : '浅色'} {family.label}
                {active ? ' ✓' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: '1.1rem' }}>
      {row('dark', '深色档', '系统为深色模式时使用（基础为深灰）')}
      {row('light', '浅色档', '系统为浅色模式时使用（基础为浅灰）')}
    </div>
  );
}