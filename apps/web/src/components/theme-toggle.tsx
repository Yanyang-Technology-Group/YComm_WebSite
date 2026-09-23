'use client';

import { useEffect, useState } from 'react';
import { playAnim } from '../lib/anim';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/session';

/**
 * 主题选择：上面选颜色，下面选明暗（深色 / 浅色）。
 * 底色用 light-dark() 由 color-scheme 决定，所以「深色/浅色」只是改 <html> 的 color-scheme。
 * 「跟随系统」不再是可选项：只有账号从未设置过时才按系统深浅走一次，之后由用户选定的明暗固定。
 */
export const THEME_FAMILIES = [
  { id: 'azure', label: '晏阳蓝', dark: '#24466e', light: '#bcd3f0' },
  { id: 'red', label: '中国红', dark: '#5c1414', light: '#f0a9a4' },
  { id: 'pink', label: '猛男粉', dark: '#5c2c38', light: '#f3c2cb' },
  { id: 'mint', label: '纳西妲绿', dark: '#2a4a2c', light: '#c4e3b8' },
  { id: 'orange', label: '活力橙', dark: '#66370f', light: '#ffd2a1' },
] as const;

export type ThemeFamilyId = (typeof THEME_FAMILIES)[number]['id'];

/** 「无」= 不加任何强调色，用纯系统灰（深色深灰 / 浅色浅灰）。 */
export type ThemeChoice = ThemeFamilyId | 'none';

/**
 * 明暗：dark 固定深色 / light 固定浅色 / auto 跟随系统（仅作为「从未设置过」时的默认值，
 * 不出现在选项里 —— 用户一旦选了深色或浅色就固定下来）。
 */
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

/** 灰调已经撤掉，历史上选过灰调的账号统一按「无」显示与高亮。 */
function normalizeColour(value: string | undefined): ThemeChoice | null {
  if (value === 'slate') return 'none';
  return isValidColour(value) ? value : null;
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

  // 以「当前实际生效的主题」为准（根布局的首帧脚本 + ThemeSync 已经把账号主题写进 <html>），
  // 直接读 dataset，避免本地缓存与账号主题不一致时选错高亮项。
  const domColour = normalizeColour(document.documentElement.dataset.themeColour);
  const domMode = document.documentElement.dataset.themeMode;
  if (domColour && isValidMode(domMode)) {
    return { colour: domColour, mode: domMode };
  }

  try {
    const pair = localStorage.getItem(PAIR_KEY);
    if (pair && !localStorage.getItem(COLOUR_KEY)) {
      const parsed = JSON.parse(pair) as { light?: string; dark?: string };
      const colour = normalizeColour(parsed.dark) ?? normalizeColour(parsed.light) ?? DEFAULT_COLOUR;
      return { colour, mode: 'auto' };
    }
    const legacy = localStorage.getItem(OLD_KEY);
    if (legacy && !localStorage.getItem(COLOUR_KEY)) {
      return { colour: normalizeColour(legacy) ?? DEFAULT_COLOUR, mode: 'auto' };
    }
    const savedColour = localStorage.getItem(COLOUR_KEY);
    const savedMode = localStorage.getItem(MODE_KEY);
    return {
      colour: normalizeColour(savedColour ?? undefined) ?? DEFAULT_COLOUR,
      mode: isValidMode(savedMode ?? undefined) ? (savedMode as ThemeMode) : DEFAULT_MODE,
    };
  } catch {
    /* 忽略损坏的存储 */
  }
  return { colour: DEFAULT_COLOUR, mode: DEFAULT_MODE };
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

/** 明暗选项：只有深色 / 浅色（「跟随系统」仅作为从未设置时的默认，不列出来）。 */
const MODES: { id: ThemeMode; label: string; icon: string; hint: string }[] = [
  { id: 'dark', label: '深色', icon: '☾', hint: '固定深色底' },
  { id: 'light', label: '浅色', icon: '☀', hint: '固定浅色底' },
];

/** 浏览器本地缓存的主题（游客也用，先上色避免闪白）。 */
export function readStoredTheme(): { colour: ThemeChoice; mode: ThemeMode } {
  if (typeof localStorage === 'undefined') return { colour: DEFAULT_COLOUR, mode: DEFAULT_MODE };
  try {
    const colour = localStorage.getItem(COLOUR_KEY) ?? undefined;
    const mode = localStorage.getItem(MODE_KEY) ?? undefined;
    return {
      colour: normalizeColour(colour) ?? DEFAULT_COLOUR,
      mode: isValidMode(mode) ? mode : DEFAULT_MODE,
    };
  } catch {
    return { colour: DEFAULT_COLOUR, mode: DEFAULT_MODE };
  }
}

/** 把主题存进账号（按账号生效，换设备登录也是同一套）；游客只存本地。 */
async function persistTheme(colour: ThemeChoice, mode: ThemeMode): Promise<void> {
  try {
    const session = await getSession();
    if (!session) return;
    await apiFetch('/api/auth/theme', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colour, mode }),
    });
  } catch {
    /* 保存失败不影响本次已生效的主题 */
  }
}

/**
 * 退出登录：回到默认（晏阳蓝 + 跟随系统），
 * 不把上一个账号的配色留给同一台电脑上的下一个人。
 */
export function resetThemeToDefault(): void {
  applyTheme(DEFAULT_COLOUR, DEFAULT_MODE);
}

/**
 * 主题同步（挂在根布局，全站生效）：
 * 1) 先用浏览器缓存立刻上色（避免闪烁）；
 * 2) 已登录时以「账号里的主题」为准 —— 换设备、换账号登录都会切到该账号自己的配色；
 *    从未设置过的新账号 → 用默认「晏阳蓝 + 跟随系统」。
 */
export function ThemeSync() {
  useEffect(() => {
    const stored = readStoredTheme();
    applyTheme(stored.colour, stored.mode);

    let active = true;
    void getSession().then((session) => {
      if (!active || !session) return; // 未登录：保持本地缓存
      const colour = normalizeColour(session.themeColour ?? undefined) ?? DEFAULT_COLOUR;
      const mode = isValidMode(session.themeMode ?? undefined) ? (session.themeMode as ThemeMode) : DEFAULT_MODE;
      applyTheme(colour, mode);
    });
    return () => {
      active = false;
    };
  }, []);

  return null;
}

/**
 * 主题选择器（控制台 → 外观主题）：
 * 1. 上面选颜色（晏阳蓝 / 猛男粉 / 纳西妲绿 / 活力橙 / 无）；
 * 2. 下面选明暗：深色 / 浅色（从未设置过时才跟随系统）。
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
    void persistTheme(next, mode);
  }

  function chooseMode(next: ThemeMode) {
    playAnim('theme');
    applyTheme(colour, next);
    setMode(next);
    void persistTheme(colour, next);
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
        {colour === 'none' && (
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            已选「无」：不加任何强调色（历史上选的「灰调」也按这里显示）。
          </p>
        )}
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
        {mode === 'auto' && (
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            当前按系统深浅显示（还没固定过）；点「深色」或「浅色」就会固定下来。
          </p>
        )}
      </div>
    </div>
  );
}