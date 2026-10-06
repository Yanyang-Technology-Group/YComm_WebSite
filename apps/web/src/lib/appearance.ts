/** Web-only UI preference, separate from the account's colour and light/dark mode. */
export type UiStyle = 'flat' | 'legacy';
export const UI_STYLE_KEY = 'ycomm_ui_style';
export const DEFAULT_UI_STYLE: UiStyle = 'flat';

export function normalizeUiStyle(value: string | null | undefined): UiStyle {
  return value === 'legacy' ? 'legacy' : DEFAULT_UI_STYLE;
}

export function readStoredUiStyle(): UiStyle {
  try {
    return normalizeUiStyle(localStorage.getItem(UI_STYLE_KEY));
  } catch {
    return DEFAULT_UI_STYLE;
  }
}

export function applyUiStyle(style: UiStyle): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.uiStyle = style;
  try {
    localStorage.setItem(UI_STYLE_KEY, style);
  } catch {
    // The choice still applies for this page when browser storage is unavailable.
  }
}

/** Runs before page content is painted; missing/invalid preferences use Flat Design. */
export const UI_STYLE_BOOT_SCRIPT = `(function(){var r=document.documentElement;r.dataset.uiStyle='${DEFAULT_UI_STYLE}';try{if(localStorage.getItem('${UI_STYLE_KEY}')==='legacy')r.dataset.uiStyle='legacy';}catch(e){}})();`;
