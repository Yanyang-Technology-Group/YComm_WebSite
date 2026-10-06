/** Web-only UI preference, separate from the account's colour and light/dark mode. */
export type UiStyle = 'apple' | 'flat' | 'legacy';
export const UI_STYLE_KEY = 'ycomm_ui_style';
export const DEFAULT_UI_STYLE: UiStyle = 'flat';

export function normalizeUiStyle(value: string | null | undefined): UiStyle {
  return value === 'apple' || value === 'legacy' ? value : DEFAULT_UI_STYLE;
}

export function readStoredUiStyle(): UiStyle {
  try {
    return normalizeUiStyle(localStorage.getItem(UI_STYLE_KEY));
  } catch {
    return DEFAULT_UI_STYLE;
  }
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined;
export const UI_STYLE_CHANGE_EVENT = 'ycomm:ui-style-change';

export function applyUiStyle(style: UiStyle, { animate = false } = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  try {
    localStorage.setItem(UI_STYLE_KEY, style);
  } catch {
    // The choice still applies for this page when browser storage is unavailable.
  }
  if (root.dataset.uiStyle === style) return;
  if (transitionTimer !== undefined) clearTimeout(transitionTimer);
  transitionTimer = undefined;
  delete root.dataset.uiTransition;
  // Commit synchronously: native view transitions can retain an old snapshot
  // or defer the update while React already changes the selected option.
  root.dataset.uiStyle = style;
  window.dispatchEvent(new Event(UI_STYLE_CHANGE_EVENT));
  if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  void root.offsetWidth;
  root.dataset.uiTransition = 'fallback';
  transitionTimer = setTimeout(() => {
    delete root.dataset.uiTransition;
    transitionTimer = undefined;
  }, 350);
}

/** Runs before page content is painted; existing explicit choices stay compatible. */
export const UI_STYLE_BOOT_SCRIPT = `(function(){var r=document.documentElement;r.dataset.uiStyle='${DEFAULT_UI_STYLE}';try{var s=localStorage.getItem('${UI_STYLE_KEY}');if(s==='apple'||s==='legacy')r.dataset.uiStyle=s;}catch(e){}})();`;
