/** Web-only UI preference, separate from the account's colour and light/dark mode. */
export type UiStyle = 'daisyui' | 'flat' | 'legacy';
export const UI_STYLE_KEY = 'ycomm_ui_style';
export const DEFAULT_UI_STYLE: UiStyle = 'daisyui';

export function normalizeUiStyle(value: string | null | undefined): UiStyle {
  return value === 'flat' || value === 'legacy' ? value : DEFAULT_UI_STYLE;
}

export function readStoredUiStyle(): UiStyle {
  try {
    return normalizeUiStyle(localStorage.getItem(UI_STYLE_KEY));
  } catch {
    return DEFAULT_UI_STYLE;
  }
}

let currentTransition: ViewTransition | undefined;
let transitionTimer: ReturnType<typeof setTimeout> | undefined;
let styleRevision = 0;

export function applyUiStyle(style: UiStyle, { animate = false } = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  try {
    localStorage.setItem(UI_STYLE_KEY, style);
  } catch {
    // The choice still applies for this page when browser storage is unavailable.
  }
  const revision = ++styleRevision;
  currentTransition?.skipTransition();
  currentTransition = undefined;
  if (transitionTimer !== undefined) clearTimeout(transitionTimer);
  transitionTimer = undefined;
  delete root.dataset.uiTransition;
  if (root.dataset.uiStyle === style) return;

  // A skipped transition can still invoke its deferred update callback.
  const update = () => {
    if (revision === styleRevision) root.dataset.uiStyle = style;
  };
  if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  if (document.startViewTransition) {
    const transition = document.startViewTransition(update);
    currentTransition = transition;
    void transition.ready.catch(() => {});
    void transition.finished.finally(() => {
      if (currentTransition === transition) currentTransition = undefined;
    }).catch(() => {});
  } else {
    void root.offsetWidth;
    root.dataset.uiTransition = 'fallback';
    update();
    transitionTimer = setTimeout(() => {
      delete root.dataset.uiTransition;
      transitionTimer = undefined;
    }, 350);
  }
}

/** Runs before page content is painted; existing explicit choices stay compatible. */
export const UI_STYLE_BOOT_SCRIPT = `(function(){var r=document.documentElement;r.dataset.uiStyle='${DEFAULT_UI_STYLE}';try{var s=localStorage.getItem('${UI_STYLE_KEY}');if(s==='flat'||s==='legacy')r.dataset.uiStyle=s;}catch(e){}})();`;
