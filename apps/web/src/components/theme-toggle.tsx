'use client';

import { useEffect, useState } from 'react';
import { playAnim } from '../lib/anim';

/**
 * 主题选择：上面选颜色（一个色系同时用于深浅两档），下面选明暗
 * （深色 / 浅色 / 跟随系统）。底色用 light-dark() 由 color-scheme 自动切换，
 * 所以「固定深色 / 固定浅色 / 跟随系统」都只是改 <html> 的 color-scheme。
 */
export const THEME_FAMILIES = [
  { id: 'azure', label: '晏阳蓝', dark: '#24466e', light: '#bcd3f0' },
  { id: 'pink', label: '猛男粉', dark: '#5c2c38', light: '#f3c2cb' },
  { id: 'mint', label: '草神绿', dark: '#2a4a2c', light: '#c4e3b8' },
  { id: 'orange', label: '活力橙', dark: '#66370f', light: '#ffd2a1' },
  { id: 'slate', label: '灰调', dark: '#3a3f47', light: '#d8d9dc' },
] as const;

export type ThemeFamilyId = (typeof THEME_FAMILIES)[number]['id'];

/** 「无」= 不加任何强调色，用纯系统灰（深色深灰 / 浅色浅灰）。 */
export type ThemeChoice = ThemeFamilyId | 'none';

/** 明暗：跟随系统 / 固定深色 / 固定浅色。 */
export type ThemeMode = 'auto' | 'dark' | 'light';

const COLOUR_KEY = 'ycomm_theme_colour';
const MODE_KEY = 'ycomm_theme_mode';
const PAIR_KEY = 'ycomm_theme_pair';
const OLD_KEY = 'ycomm_theme';

const DEFAULT_COLOUR: ThemeChoice = 'azure';
const DEFAULT_MODE: ThemeMode = 'auto';

function attrFor(choice: ThemeChoice): string {
  // 「无」映射到灰调色系（即系统默认灰组合）。
  return choice === 'none' ? 'slate' : choice;
}

function isValidColour(value: string | undefined): value is ThemeChoice {
  return value === 'none' || THEME_FAMILIES.some((family) => family.id === value);
}

function isValidMode(value: string | undefined): value is ThemeMode {
  return value === 'auto' || value === 'dark' || value === 'light';
}

/** 把选中的颜色 + 明暗写入 <html> 三个属性，并持久化。 */
export function applyTheme(colour: ThemeChoice, mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.themeColour = attrFor(colour);
  root.dataset.themeMode = mode;
  try {
    localStorage.setItem(COLOUR_KEY, colour);
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
}

/** 兼容旧数据：Edge 配对（深浅两档各一色）→ 颜色取深色档（无则浅色档），明暗跟随系统。 */
function initial(): { colour: ThemeChoice; mode: ThemeMode } {
  if (typeof document === 'undefined') return { colour: DEFAULT_COLOUR, mode: DEFAULT_MODE };
  try {
    const pair = localStorage.getItem(PAIR_KEY);
    if (pair && !localStorage.getItem(COLOUR_KEY)) {
      const parsed = JSON.parse(pair) as { light?: string; dark?: string };
      const colour = isValidColour(parsed.dark)
        ? (parsed.dark as ThemeChoice)
        : isValidColour(parsed.light)
          ? (parsed.light as ThemeChoice)
          : DEFAULT_COLOUR;
      return { colour, mode: 'auto' };
    }
    const legacy = localStorage.getItem(OLD_KEY);
    if (legacy && !localStorage.getItem(COLOUR_KEY)) {
      return { colour: isValidColour(legacy) ? (legacy as ThemeChoice) : DEFAULT_COLOUR, mode: 'auto' };
    }
    const savedColour = localStorage.getItem(COLOUR_KEY);
    const savedMode = localStorage.getItem(MODE_KEY);
    return {
      colour: isValidColour(savedColour ?? undefined) ? (savedColour as ThemeChoice) : DEFAULT_COLOUR,
      mode: isValidMode(savedMode ?? undefined) ? (savedMode as ThemeMode) : DEFAULT_MODE,
    };
  } catch {
    /* 忽略损坏的存储 */
  }
  return {
    colour: isValidColour(document.documentElement.dataset.themeColour)
      ? (document.documentElement.dataset.themeColour as ThemeChoice)
      : DEFAULT_COLOUR,
    mode: isValidMode(document.documentElement.dataset.themeMode)
      ? (document.documentElement.dataset.themeMode as ThemeMode)
      : DEFAULT_MODE,
  };
}

/** 色块：上下斜切展示该色系深浅两色。 */
function FamilySwatch({ family }: { family: (typeof THEME_FAMILIES)[number] }) {
  return (
    <span
      className="theme-swatch"
      style={{
        background: `linear-gradient(135deg, ${family.dark} 0 50%, ${family.light} 50% 100%)`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
      }}
    />
  );
}

/** 「无」：半黑半白对半切开，表示不加任何强调色。 */
function NoneSwatch() {
  return (
    <span
      className="theme-swatch"
      style={{ background: 'linear-gradient(90deg, #000 0 50%, #fff 50% 100%)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' }}
    />
  );
}

const MODES: { id: ThemeMode; label: string; icon: string; hint: string }[] = [
  { id: 'dark', label: '深色', icon: '☾', hint: '固定深色底' },
  { id: 'light', label: '浅色', icon: '☀', hint: '固定浅色底' },
  { id: 'auto', label: '跟随系统', icon: '↺', hint: '按系统深浅自动切换' },
];

/**
 * 主题选择器（控制台 → 外观主题）：
 * 1. 上面选颜色（深浅两档同一色系，可「无」）；
 * 2. 下面选明暗：深色 / 浅色 / 跟随系统。
 */
export function ThemePicker() {
  const [colour, setColour] = useState<ThemeChoice>(DEFAULT_COLOUR);
  const [mode, setMode] = useState<ThemeMode>(DEFAULT_MODE);

  useEffect(() => {
    const init = initial();
    setColour(init.colour);
    setMode(init.mode);
  }, []);

  function chooseColour(next: ThemeChoice) {
    playAnim('theme');
    applyTheme(next, mode);
    setColour(next);
  }

  function chooseMode(next: ThemeMode) {
    playAnim('theme');
    applyTheme(colour, next);
    setMode(next);
  }

  return (
    <div style={{ display: 'grid', gap: '1.1rem' }}>
      <div>
        <p style={{ margin: '0 0 0.4rem' }}>
          <strong>颜色风格</strong>{' '}
          <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>
            一个色系同时用于深浅两档；「无」= 纯灰不加强调色
          </span>
        </p>
        <div className="theme-picker" style={{ flexWrap: 'wrap' }}>
          {THEME_FAMILIES.map((family) => {
            const active = colour === family.id;
            return (
              <button
                key={family.id}
                type="button"
                className={`theme-option${active ? ' active' : ''}`}
                onClick={() => chooseColour(family.id)}
                aria-pressed={active}
              >
                <FamilySwatch family={family} />
                <span className="theme-label">
                  {family.label}
                  {active ? ' ✓' : ''}
                </span>
              </button>
            );
          })}
          <button
            key="none"
            type="button"
            className={`theme-option${colour === 'none' ? ' active' : ''}`}
            onClick={() => chooseColour('none')}
            aria-pressed={colour === 'none'}
          >
            <NoneSwatch />
            <span className="theme-label">
              无{colour === 'none' ? ' ✓' : ''}
            </span>
          </button>
        </div>
      </div>

      <div>
        <p style={{ margin: '0 0 0.4rem' }}>
          <strong>深色 / 浅色</strong>{' '}
          <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>
            决定页面用什么明暗底色
          </span>
        </p>
        <div className="theme-picker">
          {MODES.map((entry) => {
            const active = mode === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                className={`theme-mode-option${active ? ' active' : ''}`}
                onClick={() => chooseMode(entry.id)}
                aria-pressed={active}
              >
                <span className="theme-label">
                  {entry.icon} {entry.label}
                  {active ? ' ✓' : ''}
                </span>
                <span className="muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>
                  {entry.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}