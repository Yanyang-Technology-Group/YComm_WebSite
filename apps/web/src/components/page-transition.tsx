'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { playAnim } from '../lib/anim';

/**
 * 每次路由变化播放一次「渐变幕布 + 组件坠落回弹」。
 *
 * 服务端渲染的 children 原样透传，不改变任何页面逻辑；动效全部由 CSS
 * (`data-anim="route"`) 驱动，JS 只负责切换标记。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    playAnim('route');
  }, [pathname]);

  return <div className="page-anim">{children}</div>;
}
