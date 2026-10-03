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
/** 侧栏最宽可拖到外壳的 90%（旧上限写死 380px，宽屏上根本不够用）。 */
const COL_MAX_RATIO = 0.9;
/** 中间正文区至少留出的宽度，避免两侧都拖到极限时把正文挤没。 */
const MAIN_MIN = 280;
/** 两条分隔条合计宽度（各 10px）。 */
const RESIZER_TOTAL = 20;
const LEFT_FALLBACK = 200;
const RIGHT_FALLBACK = 250;

/** 某一侧栏在当前外壳宽度下的最大宽度。 */
function maxColumnWidth(shellWidth: number, otherWidth: number): number {
  return Math.max(
    COL_MIN,
    Math.min(shellWidth * COL_MAX_RATIO, shellWidth - RESIZER_TOTAL - MAIN_MIN - otherWidth),
  );
}

function clampColumn(value: number, max: number): number {
  return Math.min(max, Math.max(COL_MIN, Math.round(value)));
}

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
  /** 始终指向最新的栏宽：pointerup 时用它写 localStorage（state 在监听器里是旧的）。 */
  const widthsRef = useRef<{ left: number | null; right: number | null }>({ left: null, right: null });

  useEffect(() => {
    widthsRef.current = { left: leftW, right: rightW };
  }, [leftW, rightW]);

  useEffect(() => {
    void apiFetch<{ boards: BoardNav[] }>('/api/forum/boards')
      .then((data) => setBoards(data.boards))
      .catch(() => setBoards([]));
    try {
      const saved = localStorage.getItem('ycomm_forum_cols');
      if (!saved) return;
      const parsed = JSON.parse(saved) as { left?: number; right?: number };
      const left = typeof parsed.left === 'number' ? parsed.left : null;
      const right = typeof parsed.right === 'number' ? parsed.right : null;
      // 存过的宽度可能超过当前窗口允许的上限（换小屏、改过上限），载入时先夹一次。
      const shellWidth = shellRef.current?.getBoundingClientRect().width ?? 0;
      if (shellWidth <= 0) {
        setLeftW(left);
        setRightW(right);
        return;
      }
      if (left !== null) setLeftW(clampColumn(left, maxColumnWidth(shellWidth, right ?? RIGHT_FALLBACK)));
      if (right !== null) setRightW(clampColumn(right, maxColumnWidth(shellWidth, left ?? LEFT_FALLBACK)));
    } catch {
      /* 忽略损坏的存储 */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function onMove(event: PointerEvent) {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (dragRef.current === 'left') {
        const width = clampColumn(x, maxColumnWidth(rect.width, widthsRef.current.right ?? RIGHT_FALLBACK));
        widthsRef.current.left = width;
        setLeftW(width);
      } else if (dragRef.current === 'right') {
        const width = clampColumn(rect.right - event.clientX, maxColumnWidth(rect.width, widthsRef.current.left ?? LEFT_FALLBACK));
        widthsRef.current.right = width;
        setRightW(width);
      }
    }

    function onUp() {
      setDragging(null);
      document.body.style.cursor = '';
      try {
        localStorage.setItem(
          'ycomm_forum_cols',
          JSON.stringify({ left: widthsRef.current.left, right: widthsRef.current.right }),
        );
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
