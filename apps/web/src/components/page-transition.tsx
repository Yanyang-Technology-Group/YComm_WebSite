'use client';

/** 保留包装层供主题切换动效定位，路由切换不再强制回流或延迟显示正文。 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="page-anim">{children}</div>;
}
