'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { REGISTRATION } from '@ycomm/config';
import { apiFetch } from '../lib/api';
import { ThemePicker } from './theme-toggle';
import { ImagePicker } from './image-picker';
import { remainingLabel } from './sanction-dialog';

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
  /** 是否设置了密码；GitHub 登录创建的账号没有密码，不能改密。 */
  hasPassword: boolean;
  /** 封禁/禁言信息：处罚期间不允许自助注销。 */
  mutedUntil?: string | null;
  muteReason?: string | null;
  bannedUntil?: string | null;
  banReason?: string | null;
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

type Section = 'profile' | 'content' | 'security' | 'appearance';

const SECTION_LABELS: Record<Section, string> = {
  profile: '个人资料',
  content: '我的内容',
  security: '账号安全',
  appearance: '外观主题',
};

/**
 * 控制台（dashboard）：左侧导航 + 右侧内容（类 wiki），管理员侧栏并入站务入口。
 * 登录态由客户端自检；未登录显示提示。
 */
export function DashboardPanel() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [topics, setTopics] = useState<MyTopic[]>([]);
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [resources, setResources] = useState<MyResource[]>([]);
  const [section, setSection] = useState<Section>('profile');
  const [msg, setMsg] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await apiFetch<{ user: Profile }>('/api/auth/profile');
      setProfile(data.user);
      setAvatarPath(data.user.avatarPath ?? '');
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
    return (
      <div className="panel">
        <p className="panel-title">控制台</p>
        <p className="muted" style={{ margin: 0 }}>
          请先登录：<Link href="/login">前往登录</Link>
        </p>
      </div>
    );
  }

  const staff = profile.role === 'admin' || profile.role === 'owner';

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-nav">
        <div className="dashboard-nav-group">
          <p className="dashboard-nav-title">个人</p>
          {(['profile', 'content', 'security', 'appearance'] as Section[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`dashboard-nav-link${section === key ? ' active' : ''}`}
              onClick={() => setSection(key)}
            >
              {SECTION_LABELS[key]}
            </button>
          ))}
        </div>

        {staff && (
          <div className="dashboard-nav-group">
            <p className="dashboard-nav-title">管理</p>
            <Link href="/admin" className="dashboard-nav-link">
              管理后台
            </Link>
            <Link href="/admin/users" className="dashboard-nav-link">
              用户管理
            </Link>
            <Link href="/admin/boards" className="dashboard-nav-link">
              版块管理
            </Link>
            <Link href="/admin/cards" className="dashboard-nav-link">
              下载区卡片
            </Link>
            <Link href="/admin/moderation" className="dashboard-nav-link">
              审核队列
            </Link>
            <Link href="/admin/resources" className="dashboard-nav-link">
              资源管理
            </Link>
            <Link href="/admin/audit" className="dashboard-nav-link">
              操作日志
            </Link>
            <Link href="/admin/settings" className="dashboard-nav-link">
              违禁词与注册码
            </Link>
          </div>
        )}
      </aside>

      <div className="dashboard-content">
        <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
          控制台
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          @{profile.username} · {profile.role} · Lv{profile.level}
        </p>

        {msg && (
          <p
            style={{
              color: msg.startsWith('已') || msg.includes('已') ? 'var(--accent-strong)' : '#dc2626',
            }}
          >
            {msg}
          </p>
        )}

        {section === 'profile' && (
          <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 560 }}>
            <form onSubmit={submitProfile} className="panel">
              <p className="panel-title">编辑资料</p>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <input name="displayName" defaultValue={profile.displayName} placeholder="昵称" maxLength={40} />
                <input
                  name="avatarPath"
                  value={avatarPath}
                  onChange={(event) => setAvatarPath(event.target.value)}
                  placeholder="头像图片 URL（也可直接上传）"
                />
                <ImagePicker label="🖼 上传头像" onPicked={setAvatarPath} />
                <textarea name="bio" defaultValue={profile.bio} placeholder="签名 / 简介" rows={3} maxLength={500} />
                <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                  保存资料
                </button>
              </div>
            </form>

            <form onSubmit={submitEmail} className="panel">
              <p className="panel-title">邮箱</p>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <p className="muted" style={{ margin: 0 }}>
                  当前：{profile.email}
                </p>
                <input name="email" placeholder="新邮箱" type="email" />
                <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                  修改邮箱
                </button>
              </div>
            </form>

            <form onSubmit={submitInvite} className="panel">
              <p className="panel-title">注册码绑定</p>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
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

        {section === 'content' && (
          <div style={{ display: 'grid', gap: '1.5rem' }}>
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

        {section === 'security' && (
          <div style={{ display: 'grid', gap: '1rem', maxWidth: 520 }}>
            {profile.hasPassword ? (
              <form onSubmit={submitPassword} className="panel" style={{ marginBottom: 0 }}>
                <p className="panel-title">修改密码</p>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <input name="currentPassword" type="password" placeholder="当前密码" required />
                  <input
                    name="newPassword"
                    type="password"
                    placeholder={`新密码（${REGISTRATION.passwordHint}）`}
                    required
                    minLength={REGISTRATION.minPasswordLength}
                  />
                  <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                    修改密码
                  </button>
                </div>
              </form>
            ) : (
              <div className="panel" style={{ marginBottom: 0 }}>
                <p className="panel-title">修改密码</p>
                <p style={{ margin: 0 }}>
                  你的账号是通过 <strong>GitHub 登录</strong>创建的，没有设置密码，因此无法修改密码。
                </p>
                <p className="muted" style={{ margin: '0.5rem 0 0' }}>
                  请继续使用 GitHub 登录；想用密码登录请先退出，再用注册功能创建带密码的账号。
                </p>
              </div>
            )}

            <div className="panel" style={{ marginBottom: 0 }}>
              <p className="panel-title">注销账号</p>
              {profile.state === 'banned' || profile.state === 'muted' ? (
                <>
                  <p style={{ margin: '0 0 0.5rem', color: '#dc2626' }}>
                    {profile.state === 'banned' ? '账号处于封禁状态' : '账号处于禁言状态'}
                    {remainingLabel(
                      profile.state === 'banned' ? profile.bannedUntil ?? null : profile.mutedUntil ?? null,
                    )
                      ? `（${remainingLabel(
                          profile.state === 'banned' ? profile.bannedUntil ?? null : profile.mutedUntil ?? null,
                        )}）`
                      : ''}
                    ，暂时无法注销账号。
                  </p>
                  <p className="muted" style={{ margin: 0 }}>
                    处罚原因：{profile.banReason || profile.muteReason || '未填写'}。处罚结束后就可以正常申请注销了。
                  </p>
                </>
              ) : profile.state === 'deleting' ? (
                <>
                  <p style={{ margin: '0 0 0.5rem' }}>
                    账号正在<strong>注销冷静期</strong>：到期未取消将永久注销，且无法恢复。
                  </p>
                  <p className="muted" style={{ margin: '0 0 0.75rem' }}>
                    3 天内登录或点下方按钮都可以取消注销。
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      void run(() => apiFetch('/api/auth/cancel-deletion', { method: 'POST' }), '已取消注销')
                    }
                  >
                    取消注销
                  </button>
                </>
              ) : (
                <>
                  <p style={{ margin: '0 0 0.5rem' }}>
                    注销需要<strong>邮箱验证</strong>：我们会向你的注册邮箱发送确认链接。
                  </p>
                  <p className="muted" style={{ margin: '0 0 0.75rem' }}>
                    确认后进入 3 天冷静期，期间重新登录即可取消；到期未登录则永久注销。
                  </p>
                  <button
                    type="button"
                    style={{ color: '#dc2626' }}
                    onClick={() =>
                      void run(
                        () => apiFetch('/api/auth/delete-account', { method: 'POST' }),
                        '注销确认邮件已发送，请查收邮箱并点击确认链接',
                      )
                    }
                  >
                    申请注销账号
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {section === 'appearance' && (
          <div className="panel" style={{ marginBottom: 0 }}>
            <p className="panel-title">外观 · 主题颜色</p>
            <ThemePicker />
          </div>
        )}
      </div>
    </div>
  );
}