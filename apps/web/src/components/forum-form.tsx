'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { getSession, type SessionUser } from '../lib/session';
import { ImagePicker } from './image-picker';

function Notice({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p style={{ color: '#dc2626', fontSize: '0.9rem' }}>{error}</p>;
  if (notice) return <p style={{ color: '#16a34a', fontSize: '0.9rem' }}>{notice}</p>;
  return null;
}

const field: React.CSSProperties = { padding: '0.4rem', fontSize: '0.95rem' };

/** 在 textarea 光标处插入文本。 */
function insertAtCursor(el: HTMLTextAreaElement | null, snippet: string): void {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.value = el.value.slice(0, start) + snippet + el.value.slice(end);
  el.focus();
  const caret = start + snippet.length;
  el.selectionStart = caret;
  el.selectionEnd = caret;
}

export function NewTopicForm({ boardSlug }: { boardSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get('title') ?? ''),
      content: String(form.get('content') ?? ''),
    };
    try {
      const data = await apiFetch<{ topic: { id: string }; needsReview: boolean }>(
        `/api/forum/boards/${boardSlug}/topics`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      );
      startTransition(() => router.push(`/forum/${boardSlug}/${data.topic.id}`));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: '0.5rem', maxWidth: 560 }}>
      <input name="title" placeholder="标题" required maxLength={120} style={field} />
      <textarea
        ref={contentRef}
        name="content"
        placeholder="内容（支持 Markdown，可插入图片）"
        required
        rows={6}
        style={field}
      />
      <Notice error={error} notice={null} />
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={pending} style={{ width: 120, padding: '0.4rem' }}>
          {pending ? '发布中…' : '发布主题'}
        </button>
        <ImagePicker label="🖼 插入图片" onPicked={(url) => insertAtCursor(contentRef.current, `\n![](${url})\n`)} />
      </div>
    </form>
  );
}

export function ReplyForm({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const content = String(form.get('content') ?? '');
    try {
      await apiFetch<{ post: { id: string } }>(`/api/forum/topics/${topicId}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      form.set('content', '');
      event.currentTarget.reset();
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: '0.5rem', maxWidth: 640 }}>
      <textarea
        ref={contentRef}
        name="content"
        placeholder="回复内容（支持 Markdown，可插入图片）"
        required
        rows={4}
        style={field}
      />
      <Notice error={error} notice={null} />
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={pending} style={{ width: 100, padding: '0.4rem' }}>
          {pending ? '发送中…' : '回复'}
        </button>
        <ImagePicker label="🖼 插入图片" onPicked={(url) => insertAtCursor(contentRef.current, `\n![](${url})\n`)} />
      </div>
    </form>
  );
}

export function LikeButton({ postId, initialLiked }: { postId: string; initialLiked: boolean }) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy] = useState(false);
  /** null=已确定未登录；undefined=还没查；SessionUser=已登录。 */
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  useEffect(() => {
    void getSession().then(setUser);
  }, []);

  async function toggle() {
    if (busy) return;
    // 没登录：明确提示请先登录（引导去登录页），不发出请求。
    if (!user) {
      const fresh = await getSession(true);
      setUser(fresh);
      if (!fresh) {
        setShowLoginPrompt(true);
        return;
      }
    }
    setBusy(true);
    try {
      await apiFetch(`/api/forum/posts/${postId}/${liked ? 'unlike' : 'like'}`, { method: 'POST' });
      setLiked(!liked);
      router.refresh();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`icon-btn${liked ? ' liked' : ''}`}
        title={liked ? '取消点赞' : '点赞'}
        aria-label={liked ? '取消点赞' : '点赞'}
      >
        {liked ? '♥' : '♡'}
      </button>

      {showLoginPrompt && (
        <div className="modal-backdrop" onClick={() => setShowLoginPrompt(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title">请先登录</p>
            <p className="modal-text">登录后才可以给帖子点赞。</p>
            <div className="modal-actions">
              <Link
                href="/login"
                style={{
                  padding: '0.55rem 1.2rem',
                  borderRadius: 8,
                  background: 'var(--accent-strong)',
                  color: '#fff',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                前往登录
              </Link>
              <button type="button" className="modal-skip" onClick={() => setShowLoginPrompt(false)}>
                先看看
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 转发：把当前页面链接复制到剪贴板（纯图标按钮）；登录用户同时上报分享通知给楼主。 */
export function ShareButton({ text, topicId }: { text?: string; topicId?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      // 分享事件上报：通知楼主（失败静默，不打断复制）。
      if (topicId) {
        void apiFetch(`/api/forum/topics/${topicId}/share`, { method: 'POST' }).catch(() => {
          /* 忽略 */
        });
      }
    } catch {
      alert('复制失败，请手动复制地址栏链接');
    }
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => void share()}
      title={text ?? '转发（复制链接）'}
      aria-label={text ?? '转发（复制链接）'}
    >
      {copied ? '✓' : '↗'}
    </button>
  );
}

/** 当前登录用户（id + role）；客户端专用，避免每个按钮重复请求。 */
async function currentUser(): Promise<{ id: string; role: string } | null> {
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: { user?: { id?: string; role?: string } | null } };
    const user = json.data?.user;
    return user?.id ? { id: user.id, role: user.role ?? 'member' } : null;
  } catch {
    return null;
  }
}

/** 帖子删除按钮：自己的帖子、或管理员/站长可删任意帖子（权限由 API 二次把关）。 */
export function DeletePostButton({ postId, authorId }: { postId: string; authorId: string | null }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void currentUser().then((user) => {
      if (!active || !user) return;
      if (user.id === authorId || user.role === 'admin' || user.role === 'owner') setVisible(true);
    });
    return () => {
      active = false;
    };
  }, [postId, authorId]);

  async function remove() {
    if (!window.confirm('删除这条帖子？删除后不可恢复。')) return;
    setBusy(true);
    try {
      await apiFetch(`/api/forum/posts/${postId}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      className="text-btn danger"
    >
      {busy ? '删除中…' : '删除'}
    </button>
  );
}

/** 主题删除按钮：自己的主题、或管理员/站长可删任意主题；删除后回版块。 */
export function DeleteTopicButton({
  topicId,
  authorId,
  boardSlug,
}: {
  topicId: string;
  authorId: string | null;
  boardSlug: string;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void currentUser().then((user) => {
      if (!active || !user) return;
      if (user.id === authorId || user.role === 'admin' || user.role === 'owner') setVisible(true);
    });
    return () => {
      active = false;
    };
  }, [topicId, authorId]);

  async function remove() {
    if (!window.confirm('删除这个主题？主题与全部回复将一并删除，不可恢复。')) return;
    setBusy(true);
    try {
      await apiFetch(`/api/forum/topics/${topicId}`, { method: 'DELETE' });
      router.push(`/forum/${boardSlug}`);
      router.refresh();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      className="text-btn danger"
    >
      {busy ? '删除中…' : '删除主题'}
    </button>
  );
}

/** 左下角固定「发新主题」浮钮：点击弹出发布框。 */
export function NewTopicFab({ boardSlug }: { boardSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fab-bottom-left" onClick={() => setOpen(true)}>
        ✏ 发新主题
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" style={{ textAlign: 'left' }} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
            <h2 className="modal-title">发新主题</h2>
            <NewTopicForm boardSlug={boardSlug} />
          </div>
        </div>
      )}
    </>
  );
}