'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../lib/api';
import { getSession, type SessionUser } from '../lib/session';
import { ImagePicker } from './image-picker';
import { UiInput, UiTextarea, UiButton } from './ui-controls';

function Notice({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p style={{ color: '#dc2626', fontSize: '0.9rem' }}>{error}</p>;
  if (notice) return <p style={{ color: '#16a34a', fontSize: '0.9rem' }}>{notice}</p>;
  return null;
}

const field: React.CSSProperties = { padding: '0.4rem', fontSize: '0.95rem' };
const localDateTimeValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

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

/**
 * 发新主题（整页，不再是弹窗）。
 *
 * 只保留「标题 → 正文 → 发布」三步：标题独占一行、正文拿到整栏宽度和高度，
 * 定时发布 / 插图 / 发布按钮全部收进正文下方的一行，页面尽量少装饰。
 */
export function NewTopicComposer({ boardSlug, boardName }: { boardSlug: string; boardName?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const content = String(form.get('content') ?? '').trim();
    if (title.length < 2) {
      setError('标题至少需要 2 个字');
      return;
    }
    if (!content) {
      setError('正文还不能为空');
      return;
    }
    let scheduledIso: string | undefined;
    if (schedule) {
      const when = scheduledAt ? new Date(scheduledAt) : null;
      if (!when || Number.isNaN(when.getTime())) {
        setError('请选择有效的发布时间');
        return;
      }
      scheduledIso = when.toISOString();
    }
    setBusy(true);
    try {
      const data = await apiFetch<{ topic: { id: string; status: string }; needsReview: boolean }>(
        `/api/forum/boards/${boardSlug}/topics`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, content, ...(scheduledIso ? { scheduledAt: scheduledIso } : {}) }),
        },
      );
      if (data.needsReview || data.topic.status === 'scheduled') {
        formRef.current?.reset();
        setSchedule(false);
        setScheduledAt('');
        setNotice(
          data.needsReview
            ? '已提交审核，通过后才会公开显示'
            : `已安排定时发布${scheduledIso ? `：${new Date(scheduledIso).toLocaleString()}` : ''}`,
        );
        return;
      }
      router.push(`/forum/${boardSlug}/${data.topic.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发布失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className="topic-composer" onSubmit={submit}>
      <UiInput
        className="topic-composer-title"
        name="title"
        placeholder="标题"
        required
        maxLength={120}
        autoFocus
      />
      <UiTextarea
        ref={contentRef}
        className="topic-composer-body"
        name="content"
        placeholder={`正文，支持 Markdown${boardName ? `（发布到 ${boardName}）` : ''}`}
        required
      />
      <div className="topic-composer-bar">
        <label className="topic-composer-check">
          <input
            type="checkbox"
            checked={schedule}
            disabled={busy}
            onChange={(event) => setSchedule(event.target.checked)}
          />
          定时发布
        </label>
        {schedule && (
          <input
            className="topic-composer-when"
            type="datetime-local"
            value={scheduledAt}
            required
            disabled={busy}
            min={localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000))}
            max={localDateTimeValue(new Date(new Date().setMonth(new Date().getMonth() + 3)))}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        )}
        <span className="topic-composer-gap" />
        <ImagePicker label="插入图片或视频" media="all" onPicked={(url) => insertAtCursor(contentRef.current, `\n![](${url})\n`)} />
        <UiButton type="submit" className="topic-composer-submit" disabled={busy}>
          {busy ? '发布中…' : '发布主题'}
        </UiButton>
      </div>
      <Notice error={error} notice={notice} />
    </form>
  );
}

export function ReplyForm({ topicId, posts = [] }: { topicId: string; posts?: { id: string; position: number; authorDisplayName: string | null; authorUsername: string | null }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [replyToPostId, setReplyToPostId] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const content = String(form.get('content') ?? '');
    try {
      await apiFetch<{ post: { id: string } }>(`/api/forum/topics/${topicId}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, ...(replyToPostId ? { replyToPostId } : {}) }),
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
      <select value={replyToPostId} onChange={(event) => setReplyToPostId(event.target.value)} style={field} aria-label="回复哪条帖子">
        <option value="">回复整个主题</option>
        {posts.map((post) => <option key={post.id} value={post.id}>回复 #{post.position} · {post.authorDisplayName ?? post.authorUsername ?? '访客'}</option>)}
      </select>
      <UiTextarea
        ref={contentRef}
        name="content"
        placeholder="回复内容（支持 Markdown，可插入图片）"
        required
        rows={4}
        style={field}
      />
      <Notice error={error} notice={null} />
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <UiButton type="submit" disabled={pending} style={{ width: 100, padding: '0.4rem' }}>
          {pending ? '发送中…' : '回复'}
        </UiButton>
        <ImagePicker label="🖼 插入图片/视频" media="all" onPicked={(url) => insertAtCursor(contentRef.current, `\n![](${url})\n`)} />
      </div>
    </form>
  );
}

export function LikeButton({ postId, initialLiked, initialCount = 0 }: { postId: string; initialLiked: boolean; initialCount?: number }) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
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
      setCount((value) => Math.max(0, value + (liked ? -1 : 1)));
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
        {liked ? '♥' : '♡'} {count}
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
export function ShareButton({ text, topicId, initialCount = 0 }: { text?: string; topicId?: string; initialCount?: number }) {
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState(initialCount);

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      if (topicId) setCount((value) => value + 1);
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
      {copied ? '✓' : '↗'} {count}
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

/** 左下角固定「发新主题」浮钮：跳到独立发布页（不再弹窗）。 */
export function NewTopicFab({ boardSlug }: { boardSlug: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const link = (
    <Link href={`/forum/${boardSlug}/new`} className="fab-bottom-left">
      ✏ 发新主题
    </Link>
  );

  return mounted ? createPortal(link, document.body) : link;
}
