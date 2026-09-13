/**
 * 页面 / 主题切换的统一动效触发器。
 *
 * 动效本身写在 CSS 里（globals.css 的 `data-anim` 段）：一层主题色渐变幕布
 * 扫过全屏 + 页面组件「坠落又弹回」。这里只负责在 <html> 上挂/摘标记，
 * 摘掉后再次挂上之前会强制一次回流，所以连续切换主题也能重新播放。
 */

export type AnimKind = 'route' | 'theme';

const ATTR = 'data-anim';
/** 略长于 CSS 动画时长，保证动画播完再清理标记。 */
const CLEAR_AFTER_MS = 1100;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function playAnim(kind: AnimKind): void {
  if (typeof document === 'undefined') return;
  // 尊重系统的「减少动态效果」设置。
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.documentElement;
  root.removeAttribute(ATTR);
  // 读一次布局属性 → 强制回流，让同名动画可以重放。
  void root.offsetWidth;
  root.setAttribute(ATTR, kind);

  if (clearTimer !== undefined) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => root.removeAttribute(ATTR), CLEAR_AFTER_MS);
}
