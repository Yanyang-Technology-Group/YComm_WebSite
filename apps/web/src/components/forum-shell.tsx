'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { NotificationList } from './notification-list';

interface BoardNav {
  slug: string;
  name: string;
  description: string;
}

const COL_MIN = 160;
const COL_MAX = 380;

/**
 * 论坛三栏外壳（可自定义宽度）：
 * 左 = 板块导航（切换板块）；中 = 内容；右 = 通知/快捷栏。
 * 拖动两条分隔条可调整栏宽（虚线引导 + 拉伸光标），宽度存 localStorage。
 */
export function ForumShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [boards, setBoards] = useState<BoardNav[]>([]);
  /** 左栏宽 / 右栏宽（px）；null = 用 CSS 默认。 */
  const [leftW, setLeftW] = useState<number | null>(null);
  const [rightW, setRightW] = useState<number | null>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'left' | 'right' | null>(null);

  useEffect(() => {
    void apiFetch<{ boards: BoardNav[] }>('/api/forum/boards')
      .then((data) => setBoards(data.boards))
      .catch(() => setBoards([]));
    try {
      const saved = localStorage.getItem('ycomm_forum_cols');
      if (saved) {
        const parsed = JSON.parse(saved) as { left?: number; right?: number };
        setLeftW(typeof parsed.left === 'number' ? parsed.left : null);
        setRightW(typeof parsed.right === 'number' ? parsed.right : null);
      }
    } catch {
      /* 忽略损坏的存储 */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function clamp(value: number): number {
      return Math.min(COL_MAX, Math.max(COL_MIN, Math.round(value)));
    }

    function onMove(event: PointerEvent) {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (dragRef.current === 'left') {
        setLeftW(clamp(x));
      } else if (dragRef.current === 'right') {
        setRightW(clamp(rect.right - event.clientX));
      }
    }

    function onUp() {
      setDragging(null);
      document.body.style.cursor = '';
      try {
        localStorage.setItem('ycomm_forum_cols', JSON.stringify({ left: leftW, right: rightW }));
      } catch {
        /* 忽略 */
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  function startDrag(which: 'left' | 'right') {
    dragRef.current = which;
    setDragging(which);
    document.body.style.cursor = 'col-resize';
  }

  const leftStyle = leftW !== null ? { width: `${leftW}px`, minWidth: COL_MIN } : undefined;
  const rightStyle = rightW !== null ? { width: `${rightW}px`, minWidth: COL_MIN } : undefined;
  const isBoardPage = /^\/forum\/[^/]+\/?$/.test(pathname);

  return (
    <div ref={shellRef} className={`forum-shell${dragging ? ' resizing' : ''}`}>
      <aside className="fcol fcol-left" style={leftStyle}>
        <p className="app-nav-title">板块</p>
        {boards.map((board) => {
          const active = pathname === `/forum/${board.slug}`;
          return (
            <Link key={board.slug} href={`/forum/${board.slug}`} className={`app-nav-link${active ? ' active' : ''}`}>
              {board.name}
            </Link>
          );
        })}
        <Link href="/forum" className={`app-nav-link${pathname === '/forum' ? ' active' : ''}`}>
          全部版块
        </Link>
      </aside>

      <button type="button" className="fcol-resizer fcol-resizer-left" aria-label="调整左栏宽度" onPointerDown={() => startDrag('left')} />

      <main className="fcol fcol-main">{children}</main>

      <button type="button" className="fcol-resizer fcol-resizer-right" aria-label="调整右栏宽度" onPointerDown={() => startDrag('right')} />

      <aside className="fcol fcol-right" style={rightStyle}>
        <p className="app-nav-title">通知中心</p>
        <NotificationList compact />
        <p className="app-nav-title">快捷</p>
        {isBoardPage && (
          <Link href="/forum" className="app-nav-link">
            返回全部版块
          </Link>
        )}
      </aside>
    </div>
  );
}