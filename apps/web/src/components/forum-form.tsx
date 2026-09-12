'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

function Notice({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p style={{ color: '#dc2626', fontSize: '0.9rem' }}>{error}</p>;
  if (notice) return <p style={{ color: '#16a34a', fontSize: '0.9rem' }}>{notice}</p>;
  return null;
}

const field: React.CSSProperties = { padding: '0.4rem', fontSize: '0.95rem' };

export function NewTopicForm({ boardSlug }: { boardSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      <textarea name="content" placeholder="内容（支持 Markdown）" required rows={6} style={field} />
      <Notice error={error} notice={null} />
      <button type="submit" disabled={pending} style={{ width: 120, padding: '0.4rem' }}>
        {pending ? '发布中…' : '发布主题'}
      </button>
    </form>
  );
}

export function ReplyForm({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      <textarea name="content" placeholder="回复内容（支持 Markdown）" required rows={4} style={field} />
      <Notice error={error} notice={null} />
      <button type="submit" disabled={pending} style={{ width: 100, padding: '0.4rem' }}>
        {pending ? '发送中…' : '回复'}
      </button>
    </form>
  );
}

export function LikeButton({ postId, initialLiked }: { postId: string; initialLiked: boolean }) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
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
    <button type="button" onClick={() => void toggle()} disabled={busy} style={{ cursor: 'pointer' }}>
      {liked ? '♥ 已赞' : '♡ 点赞'}
    </button>
  );
}