'use client';

import { useEffect, useState, type ButtonHTMLAttributes } from 'react';
import { Button as AppleButton } from '@extrastu/nuphy-ui';
import { playAnim } from '../lib/anim';
import { apiFetch } from '../lib/api';
import { showToast } from '../lib/toast';
import { getSession } from '../lib/session';
import { AppearancePicker } from './appearance-picker';
import { useUiStyle } from '../lib/use-ui-style';
import { applyTheme, THEME_FAMILIES, type ThemeChoice, type ThemeFamilyId, type ThemeMode } from '../lib/theme-preference';

export { THEME_FAMILIES };
export type { ThemeChoice, ThemeFamilyId, ThemeMode };

function PreferenceButton({ apple, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { apple: boolean }) {
  return apple
    ? <AppleButton variant="secondary" {...props}>{children}</AppleButton>
    : <button {...props}>{children}</button>;
}

/**
 * 主题选择：上面选颜色，下面选明暗（深色 / 浅色）。
 * 底色用 light-dark() 由 color-scheme 决定，所以「深色/浅色」只是改 <html> 的 color-scheme。
 * 「跟随系统」不再是可选项：只有账号从未设置过时才按系统深浅走一次，之后由用户选定的明暗固定。
 */
const COLOUR_KEY = 'ycomm_theme_colour';
const MODE_KEY = 'ycomm_theme_mode';
const PAIR_KEY = 'ycomm_theme_pair';
const OLD_KEY = 'ycomm_theme';

const DEFAULT_COLOUR: ThemeChoice = 'azure';
const DEFAULT_MODE: ThemeMode = 'auto';

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

/** 把主题存进账号（按账号生效，换设备登录也是同一套）；游客只存本地。 */
async function persistTheme(colour: ThemeChoice, mode: ThemeMode): Promise<void> {
  try {
    const session = await getSession();
    if (!session) {
      if (localStorage.getItem(COLOUR_KEY) === colour && localStorage.getItem(MODE_KEY) === mode) showToast('主题保存成功');
      return;
    }
    await apiFetch('/api/auth/theme', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colour, mode }),
    });
    showToast('主题保存成功');
  } catch {
    /* 保存失败不影响本次已生效的主题 */
  }
}

/**
 * 主题选择器（控制台 → 外观主题）：
 * 1. 上面选颜色（晏阳蓝 / 猛男粉 / 纳西妲绿 / 活力橙 / 无）；
 * 2. 下面选明暗：深色 / 浅色（从未设置过时才跟随系统）。
 */
export function ThemePicker() {
  const apple = useUiStyle() === 'apple';
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
      <AppearancePicker />
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
              <PreferenceButton
                apple={apple}
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
              </PreferenceButton>
            );
          })}
          <PreferenceButton
            apple={apple}
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
          </PreferenceButton>
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
              <PreferenceButton
                apple={apple}
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
              </PreferenceButton>
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
