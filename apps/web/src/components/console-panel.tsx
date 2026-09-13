'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

interface Profile {
  id: string;
  username: string;
  displayName: string;
  role: string;
  level: number;
  state: string;
  avatarPath: string | null;
  bio: string;
  email: string;
  inviteBound: boolean;
  inviteCode: string | null;
}

interface MyTopic {
  id: string;
  title: string;
  reply_count: number;
  view_count: number;
  created_at: string;
  board_slug: string;
}

interface MyPost {
  id: string;
  content_md: string;
  created_at: string;
  topic_id: string;
  topic_title: string;
  board_slug: string;
}

interface MyResource {
  id: string;
  title: string;
  status: string;
  source_type: string;
  version_label: string | null;
  download_count: number;
  created_at: string;
}

type Tab = 'profile' | 'content' | 'security';

export function ConsolePanel() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [topics, setTopics] = useState<MyTopic[]>([]);
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [resources, setResources] = useState<MyResource[]>([]);
  const [tab, setTab] = useState<Tab>('profile');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await apiFetch<{ user: Profile }>('/api/auth/profile');
      setProfile(data.user);
    } catch {
      setProfile(null);
    }
    try {
      const data = await apiFetch<{ topics: MyTopic[] }>('/api/auth/me/topics');
      setTopics(data.topics);
    } catch {
      setTopics([]);
    }
    try {
      const data = await apiFetch<{ posts: MyPost[] }>('/api/auth/me/posts');
      setPosts(data.posts);
    } catch {
      setPosts([]);
    }
    try {
      const data = await apiFetch<{ resources: MyResource[] }>('/api/auth/me/resources');
      setResources(data.resources);
    } catch {
      setResources([]);
    }
  }

  async function run(fn: () => Promise<void>, okMessage: string) {
    setMsg(null);
    try {
      await fn();
      setMsg(okMessage);
      await load();
      router.refresh();
    } catch (caught) {
      setMsg(caught instanceof Error ? caught.message : '操作失败');
    }
  }

  function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const avatarPath = String(fd.get('avatarPath') ?? '').trim();
    void run(
      () =>
        apiFetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            displayName: String(fd.get('displayName') ?? ''),
            bio: String(fd.get('bio') ?? ''),
            avatarPath: avatarPath || null,
          }),
        }),
      '资料已保存',
    );
  }

  function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            currentPassword: String(fd.get('currentPassword') ?? ''),
            newPassword: String(fd.get('newPassword') ?? ''),
          }),
        }),
      '密码已修改',
    );
  }

  function submitEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch('/api/auth/change-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: String(fd.get('email') ?? '') }),
        }),
      '邮箱已修改',
    );
  }

  function submitInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch('/api/auth/bind-invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: String(fd.get('code') ?? '') }),
        }),
      '注册码已绑定',
    );
  }

  if (!profile) {
    return <p className="muted">请先登录。</p>;
  }

  return (
    <div>
      <h1 className="page-title">个人控制台</h1>
      <p className="muted">
        @{profile.username} · {profile.role} · Lv{profile.level}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {(['profile', 'content', 'security'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t === 'profile' ? '资料' : t === 'content' ? '我的内容' : '安全'}
          </button>
        ))}
      </div>

      {msg && <p style={{ color: msg.startsWith('已') || msg.includes('已') ? 'var(--accent-strong)' : '#dc2626' }}>{msg}</p>}

      {tab === 'profile' && (
        <div style={{ display: 'grid', gap: '1rem', maxWidth: 560 }}>
          <form onSubmit={submitProfile} className="panel">
            <p className="panel-title">编辑资料</p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <input name="displayName" defaultValue={profile.displayName} placeholder="昵称" maxLength={40} />
              <input name="avatarPath" defaultValue={profile.avatarPath ?? ''} placeholder="头像图片 URL" />
              <textarea name="bio" defaultValue={profile.bio} placeholder="签名 / 简介" rows={3} maxLength={500} />
              <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                保存资料
              </button>
            </div>
          </form>

          <form onSubmit={submitEmail} className="panel">
            <p className="panel-title">邮箱</p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <p className="muted" style={{ margin: 0 }}>当前：{profile.email}</p>
              <input name="email" placeholder="新邮箱" type="email" />
              <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                修改邮箱
              </button>
            </div>
          </form>

          <form onSubmit={submitInvite} className="panel">
            <p className="panel-title">注册码绑定</p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {profile.inviteBound ? (
                <p className="muted" style={{ margin: 0 }}>
                  已绑定注册码{profile.inviteCode ? `：${profile.inviteCode}` : ''}（绑定后不可更改）
                </p>
              ) : (
                <>
                  <input name="code" placeholder="注册码" maxLength={10} />
                  <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                    绑定
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === 'content' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <section>
            <h2 className="section-title">我的主题（{topics.length}）</h2>
            {topics.length === 0 && <p className="muted">暂无主题。</p>}
            {topics.map((t) => (
              <Link key={t.id} href={`/forum/${t.board_slug}/${t.id}`} className="card topic-link">
                <strong>{t.title}</strong>
                <span className="muted" style={{ marginLeft: '0.5rem' }}>
                  {t.reply_count} 回复 · {t.view_count} 浏览
                </span>
              </Link>
            ))}
          </section>

          <section>
            <h2 className="section-title">我的回帖（{posts.length}）</h2>
            {posts.length === 0 && <p className="muted">暂无回帖。</p>}
            {posts.map((p) => (
              <Link key={p.id} href={`/forum/${p.board_slug}/${p.topic_id}`} className="card topic-link">
                <div className="muted">回帖于「{p.topic_title}」</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>
                  {p.content_md.length > 120 ? `${p.content_md.slice(0, 120)}…` : p.content_md}
                </div>
              </Link>
            ))}
          </section>

          <section>
            <h2 className="section-title">我的资源（{resources.length}）</h2>
            {resources.length === 0 && <p className="muted">暂无资源。</p>}
            {resources.map((r) => (
              <Link key={r.id} href={`/downloads/${r.id}`} className="card topic-link">
                <strong>{r.title}</strong>
                <span className="muted" style={{ marginLeft: '0.5rem' }}>
                  [{r.status} · {r.source_type === 'external' ? '外链' : '本站文件'} · 下载 {r.download_count}]
                </span>
              </Link>
            ))}
          </section>
        </div>
      )}

      {tab === 'security' && (
        <form onSubmit={submitPassword} className="panel" style={{ maxWidth: 400 }}>
          <p className="panel-title">修改密码</p>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <input name="currentPassword" type="password" placeholder="当前密码" required />
            <input name="newPassword" type="password" placeholder="新密码（至少 10 位）" required minLength={10} />
            <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
              修改密码
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
