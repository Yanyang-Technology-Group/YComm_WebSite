export const THEME_FAMILIES = [
  { id: 'azure', label: '晏阳蓝', dark: '#24466e', light: '#bcd3f0' },
  { id: 'red', label: '玫瑰红', dark: '#b30000', light: '#ff0000' },
  { id: 'pink', label: '猛男粉', dark: '#5c2c38', light: '#f3c2cb' },
  { id: 'mint', label: '纳西妲绿', dark: '#2a4a2c', light: '#c4e3b8' },
  { id: 'orange', label: '活力橙', dark: '#66370f', light: '#ffd2a1' },
] as const;

export type ThemeFamilyId = (typeof THEME_FAMILIES)[number]['id'];
export type ThemeChoice = ThemeFamilyId | 'none';
export type ThemeMode = 'auto' | 'dark' | 'light';

const COLOUR_KEY = 'ycomm_theme_colour';
const MODE_KEY = 'ycomm_theme_mode';
const PAIR_KEY = 'ycomm_theme_pair';
const OLD_KEY = 'ycomm_theme';
const DEFAULT_COLOUR: ThemeChoice = 'azure';
const DEFAULT_MODE: ThemeMode = 'auto';

function attrFor(choice: ThemeChoice): string {
  return choice === 'none' ? 'slate' : choice;
}

function isValidColour(value: string | undefined): value is ThemeChoice {
  return value === 'none' || value === 'slate' || THEME_FAMILIES.some((family) => family.id === value);
}

function normalizeColour(value: string | undefined): ThemeChoice | null {
  if (value === 'slate') return 'none';
  return isValidColour(value) ? value : null;
}

function isValidMode(value: string | undefined): value is ThemeMode {
  return value === 'auto' || value === 'dark' || value === 'light';
}

export function applyTheme(colour: ThemeChoice, mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.themeColour = attrFor(colour);
  root.dataset.themeMode = mode;
  try {
    localStorage.setItem(COLOUR_KEY, colour);
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* The current page still uses the selected settings. */
  }
}

export function readStoredTheme(): { colour: ThemeChoice; mode: ThemeMode } {
  if (typeof localStorage === 'undefined') return { colour: DEFAULT_COLOUR, mode: DEFAULT_MODE };
  try {
    const pair = localStorage.getItem(PAIR_KEY);
    if (pair && !localStorage.getItem(COLOUR_KEY)) {
      const parsed = JSON.parse(pair) as { light?: string; dark?: string };
      return { colour: normalizeColour(parsed.dark) ?? normalizeColour(parsed.light) ?? DEFAULT_COLOUR, mode: 'auto' };
    }
    const legacy = localStorage.getItem(OLD_KEY);
    if (legacy && !localStorage.getItem(COLOUR_KEY)) return { colour: normalizeColour(legacy) ?? DEFAULT_COLOUR, mode: 'auto' };
    return {
      colour: normalizeColour(localStorage.getItem(COLOUR_KEY) ?? undefined) ?? DEFAULT_COLOUR,
      mode: isValidMode(localStorage.getItem(MODE_KEY) ?? undefined) ? (localStorage.getItem(MODE_KEY) as ThemeMode) : DEFAULT_MODE,
    };
  } catch {
    return { colour: DEFAULT_COLOUR, mode: DEFAULT_MODE };
  }
}

export function resetThemeToDefault(): void {
  applyTheme(DEFAULT_COLOUR, DEFAULT_MODE);
}
