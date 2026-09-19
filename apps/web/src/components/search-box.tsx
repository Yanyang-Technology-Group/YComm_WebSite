'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

interface TopicHit {
  id: string;
  title: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  createdAt: string;
}
/** 论坛结果按板块分组：一组一个板块。 */
interface ForumGroupHit {
  boardId: string;
  boardSlug: string;
  boardName: string;
  topics: TopicHit[];
}
interface UserHit {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: 'member' | 'admin' | 'owner';
  level: number;
  bio: string;
}
interface DownloadHit {
  id: string;
  title: string;
  subtitle: string;
}
interface SearchData {
  forum: ForumGroupHit[];
  users: UserHit[];
  downloads: DownloadHit[];
}

/** 搜索范围：全站 / 论坛（按板块分组）/ 下载 / 用户。 */
const SCOPES = [
  { id: 'all', label: '全站' },
  { id: 'forum', label: '论坛' },
  { id: 'downloads', label: '下载' },
  { id: 'users', label: '用户' },
] as const;

const EMPTY: SearchData = { forum: [], users: [], downloads: [] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把命中的文字用橙色高亮（mark.search-hit）。 */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const parts: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark key={index++} className="search-hit">
        {match[0]}
      </mark>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const ROLE_LABEL: Record<string, string> = { owner: '站长', admin: '管理员', member: '成员' };

/** 导航栏搜索框：范围选择（全站/论坛/下载/用户）+ 下拉结果 + 橙色高亮；论坛结果按板块分组。 */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<string>('all');
  const [data, setData] = useState<SearchData>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 路由变化时收起下拉。
  useEffect(() => {
    setOpen(false);
    setQ('');
  }, [pathname]);

  // 点击外部 / Esc 收起。
  useEffect(() => {
    function onDocDown(event: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // 防抖搜索。
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void apiFetch<SearchData>(`/api/forum/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}`)
        .then((result) => {
          setData({
            forum: result.forum ?? [],
            users: result.users ?? [],
            downloads: result.downloads ?? [],
          });
          setOpen(true);
        })
        .catch(() => setData(EMPTY))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, scope]);

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  const query = q.trim();
  const forumCount = data.forum.reduce((sum, group) => sum + group.topics.length, 0);
  const total = forumCount + data.users.length + data.downloads.length;
  const scoped = scope !== 'all';
  const showForum = !scoped || scope === 'forum';
  const showUsers = !scoped || scope === 'users';
  const showDownloads = !scoped || scope === 'downloads';

  return (
    <div ref={boxRef} className="search-box">
      <select
        className="search-scope"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
        aria-label="搜索范围"
      >
        {SCOPES.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      <input
        type="search"
        className="search-input"
        placeholder="搜索全站…"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          if (event.target.value.trim()) setOpen(true);
        }}
        onFocus={() => {
          if (q.trim()) setOpen(true);
        }}
        aria-label="搜索"
      />
      {open && query && (
        <div className="search-drop">
          {loading && <p className="search-hint">搜索中…</p>}
          {!loading && total === 0 && <p className="search-hint">没有找到与「{query}」相关的结果。</p>}

          {/* 论坛：按板块分组 */}
          {!loading &&
            showForum &&
            data.forum.map((group) => (
              <section className="search-section" key={group.boardId}>
                <p className="search-section-title">
                  论坛 · {group.boardName}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {' '}
                    （{group.topics.length}）
                  </span>
                </p>
                {group.topics.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    className="search-row"
                    onClick={() => go(`/forum/${group.boardSlug}/${topic.id}`)}
                  >
                    <span className="search-row-main">
                      <Highlight text={topic.title} query={query} />
                    </span>
                    <span className="search-row-meta">{topic.authorDisplayName ?? topic.authorUsername ?? '访客'}</span>
                  </button>
                ))}
              </section>
            ))}

          {!loading && showUsers && data.users.length > 0 && (
            <section className="search-section">
              <p className="search-section-title">用户</p>
              {data.users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="search-row"
                  onClick={() => go(`/users/${encodeURIComponent(user.username)}`)}
                >
                  <span className="search-row-main">
                    <Highlight text={user.displayName} query={query} />
                    <span className="muted" style={{ fontSize: '0.82rem' }}>
                      {' '}
                      @<Highlight text={user.username} query={query} />
                    </span>
                  </span>
                  <span className="search-row-meta">
                    Lv{user.level} · {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                </button>
              ))}
            </section>
          )}

          {!loading && showDownloads && data.downloads.length > 0 && (
            <section className="search-section">
              <p className="search-section-title">下载</p>
              {data.downloads.map((card) => (
                <button key={card.id} type="button" className="search-row" onClick={() => go(`/downloads/card/${card.id}`)}>
                  <span className="search-row-main">
                    <Highlight text={card.title} query={query} />
                  </span>
                  {card.subtitle && (
                    <span className="search-row-meta">
                      <Highlight text={card.subtitle} query={query} />
                    </span>
                  )}
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}