'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CaptchaConfig } from '@ycomm/kernel';
import { REGISTRATION } from '@ycomm/config';
import { apiFetch } from '../lib/api';
import { AppNav } from './app-nav';
import { ThemePicker } from './theme-toggle';
import { ImagePicker } from './image-picker';
import { CaptchaGateModal } from './captcha-gate-modal';
import { MarkdownContent } from './markdown-content';
import { remainingLabel } from './sanction-dialog';
import { formatDateTime } from '../lib/time';

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
  /** 是否设置了密码；GitHub 登录创建的账号没有密码，可以创建。 */
  hasPassword: boolean;
  /** 绑定过的第三方登录来源。 */
  oauthProviders?: string[];
  /** 主页 Markdown 内容。 */
  homepageMd?: string;
  /** 关注 / 粉丝 / 主页列表可见度（隐私设置）。 */
  followingVisibility?: string;
  followersVisibility?: string;
  homepageVisibility?: string;
  /** 是否允许被别人搜到（默认 true）。 */
  searchable?: boolean;
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

type Section = 'profile' | 'content' | 'security' | 'privacy' | 'appearance';

const SECTIONS: readonly Section[] = ['profile', 'content', 'security', 'privacy', 'appearance'];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: '公开（所有人可见）' },
  { value: 'mutual', label: '互关可见' },
  { value: 'private', label: '仅自己可见' },
] as const;

type LoadStatus = 'loading' | 'ready' | 'error' | 'anon';

/**
 * 控制台：全站统一左侧导航 + 右侧内容。
 * 加载时有「图标 + 蓝色旋转圆环」；10 秒内没出来提示加载失败（可重试），
 * 而不是立刻误报「未登录」。
 */
export function DashboardPanel({ captcha }: { captcha: CaptchaConfig | null }) {
  const router = useRouter();
  const search = useSearchParams();
  const sectionParam = search.get('section');
  const section: Section = SECTIONS.includes(sectionParam as Section) ? (sectionParam as Section) : 'profile';

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [topics, setTopics] = useState<MyTopic[]>([]);
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [resources, setResources] = useState<MyResource[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState('');
  const [homepageMd, setHomepageMd] = useState('');
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  /** 先读资料：401 = 未登录；超过 10 秒 = 加载失败（网络/网关问题），可重试。 */
  async function load() {
    setStatus('loading');
    setMsg(null);
    try {
      const response = await fetch('/api/auth/profile', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (response.status === 401) {
        setStatus('anon');
        return;
      }
      if (!response.ok) throw new Error('bad response');
      const json = (await response.json()) as { data?: { user?: Profile } };
      const user = json.data?.user;
      if (!user) throw new Error('no user');
      setProfile(user);
      setAvatarPath(user.avatarPath ?? '');
      setHomepageMd(user.homepageMd ?? '');
      setStatus('ready');
      await loadContent();
    } catch {
      setStatus('error');
    }
  }

  async function loadContent() {
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
            homepageMd: String(fd.get('homepageMd') ?? ''),
          }),
        }),
      '资料已保存',
    );
  }

  /** 隐私设置：关注 / 粉丝 / 主页可见度 + 是否允许被搜到，一起保存。 */
  function submitPrivacy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            followingVisibility: String(fd.get('followingVisibility') ?? 'public'),
            followersVisibility: String(fd.get('followersVisibility') ?? 'public'),
            homepageVisibility: String(fd.get('homepageVisibility') ?? 'public'),
            searchable: fd.get('searchable') === 'on',
          }),
        }),
      '隐私设置已保存',
    );
  }

  function homepageVisibilityLabel(user: Profile): string {
    const map: Record<string, string> = {
      public: '（公开）',
      mutual: '（仅互关可见）',
      private: '（仅自己可见）',
    };
    return map[user.homepageVisibility ?? 'public'] ?? '';
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

  /** GitHub 账号没有密码 → 创建密码（创建后即可用账号密码登录）。 */
  function submitSetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch('/api/auth/set-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newPassword: String(fd.get('newPassword') ?? '') }),
        }),
      '密码已创建，现在可以用账号密码登录了（下次用 GitHub 也能登录）',
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

  /** 解绑 GitHub：调 API 后直接从 /me 刷新绑定状态。 */
  async function unlinkGithub() {
    if (!window.confirm('确定解绑 GitHub？解绑后这个 GitHub 账号就能重新绑定到别的账号了。')) return;
    setUnlinkBusy(true);
    try {
      const data = await apiFetch<{ oauthProviders: string[] }>('/api/auth/oauth/unlink', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      });
      setProfile((prev) => (prev ? { ...prev, oauthProviders: data.oauthProviders } : prev));
      setMsg(null);
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : '解绑失败');
    } finally {
      setUnlinkBusy(false);
    }
  }

  /** 注销也要人机验证。 */
  async function confirmDelete(captchaToken: string | undefined) {
    setDeleteBusy(true);
    try {
      await apiFetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ captchaToken }),
      });
      setDeletePrompt(false);
      setMsg('注销确认邮件已发送，请查收邮箱并点击确认链接');
    } catch (caught) {
      setMsg(caught instanceof Error ? caught.message : '注销失败');
    } finally {
      setDeleteBusy(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="app-shell">
        <AppNav />
        <div className="app-content">
          <div className="loading-center">
            <div className="loading-ring">
              <img src="/logo.png" alt="" className="loading-icon" />
            </div>
            <p className="muted" style={{ margin: 0 }}>
              正在加载控制台…
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="app-shell">
        <AppNav />
        <div className="app-content">
          <div className="panel loading-error">
            <p className="panel-title">加载失败</p>
            <p className="muted" style={{ margin: '0 0 1rem' }}>
              请检查网络或登录状态；如果持续这样，请联系管理员。
            </p>
            <button type="button" className="primary" onClick={() => void load()}>
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'anon' || !profile) {
    return (
      <div className="app-shell">
        <AppNav />
        <div className="app-content">
          <div className="panel">
            <p className="panel-title">控制台</p>
            <p className="muted" style={{ margin: 0 }}>
              请先登录：<Link href="/login">前往登录</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const githubBound = (profile.oauthProviders ?? []).includes('github');
  const bindNotice = search.get('bind');

  return (
    <div className="app-shell">
      <AppNav />
      <div className="app-content">
        <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
          控制台
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          @{profile.username} · {profile.role} · Lv{profile.level} ·{' '}
          <Link href={`/users/${encodeURIComponent(profile.username)}`}>查看我的主页 →</Link>
        </p>

        {bindNotice === 'done' && (
          <p style={{ color: '#16a34a' }}>GitHub 绑定成功，之后可以用这个 GitHub 账号直接登录。</p>
        )}
        {bindNotice === 'error' && (
          <p style={{ color: '#dc2626' }}>GitHub 绑定失败：这个 GitHub 账号可能已经绑定到其他用户。</p>
        )}

        {msg && (
          <p
            style={{
              color: msg.startsWith('已') || msg.includes('已') || msg.includes('成功') ? 'var(--accent-strong)' : '#dc2626',
            }}
          >
            {msg}
          </p>
        )}

        {section === 'profile' && (
          <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 620 }}>
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
                <textarea name="bio" defaultValue={profile.bio} placeholder="签名 / 简介" rows={2} maxLength={500} />
                <label style={{ fontSize: '0.85rem', display: 'grid', gap: '0.3rem' }}>
                  主页内容（Markdown，显示在你的公开主页上）
                  <textarea
                    name="homepageMd"
                    value={homepageMd}
                    onChange={(event) => setHomepageMd(event.target.value)}
                    placeholder={"支持 Markdown：# 标题、**加粗**、- 列表、![](图片链接) 等"}
                    rows={8}
                    maxLength={8000}
                  />
                </label>
                {/* 提前预览：边写边看渲染效果 */}
                <div style={{ fontSize: '0.85rem' }}>
                  <p className="muted" style={{ margin: '0 0 0.3rem' }}>
                    提前预览{homepageVisibilityLabel(profile)}：
                  </p>
                  <div
                    className="panel"
                    style={{
                      marginBottom: 0,
                      background: 'color-mix(in srgb, var(--accent) 4%, var(--surface))',
                      minHeight: 40,
                    }}
                  >
                    {homepageMd.trim() ? (
                      <MarkdownContent text={homepageMd} />
                    ) : (
                      <span className="muted">（还没写内容）</span>
                    )}
                  </div>
                </div>
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
                    {formatDateTime(t.created_at)} 发表 · {t.reply_count} 回复 · {t.view_count} 浏览
                  </span>
                </Link>
              ))}
            </section>

            <section>
              <h2 className="section-title">我的回帖（{posts.length}）</h2>
              {posts.length === 0 && <p className="muted">暂无回帖。</p>}
              {posts.map((p) => (
                <Link key={p.id} href={`/forum/${p.board_slug}/${p.topic_id}`} className="card topic-link">
                  <div className="muted">
                    {formatDateTime(p.created_at)} 回帖于「{p.topic_title}」
                  </div>
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
          <div style={{ display: 'grid', gap: '1rem', maxWidth: 560 }}>
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
              <form onSubmit={submitSetPassword} className="panel" style={{ marginBottom: 0 }}>
                <p className="panel-title">创建密码</p>
                <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                  你的账号通过 GitHub 登录创建，还没有密码。创建后就能用<strong>用户名/邮箱 + 密码</strong>
                  登录，GitHub 登录也仍然可用。
                </p>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <input
                    name="newPassword"
                    type="password"
                    placeholder={`新密码（${REGISTRATION.passwordHint}）`}
                    required
                    minLength={REGISTRATION.minPasswordLength}
                  />
                  <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                    创建密码
                  </button>
                </div>
              </form>
            )}

            <div className="panel" style={{ marginBottom: 0 }}>
              <p className="panel-title">GitHub 绑定</p>
              {githubBound ? (
                <>
                  <p className="muted" style={{ margin: '0 0 0.5rem' }}>
                    已绑定 GitHub，可用 GitHub 一键登录。
                  </p>
                  <button
                    type="button"
                    onClick={() => void unlinkGithub()}
                    disabled={unlinkBusy}
                    title="解绑后这个 GitHub 账号可以重新绑定到别的账号"
                  >
                    {unlinkBusy ? '解绑中…' : '解绑 GitHub'}
                  </button>
                  <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>
                    解绑后仍可用用户名/邮箱 + 密码登录；该 GitHub 账号也可以重新绑定到其他账号。
                    {!profile.hasPassword && '（你的账号还没有密码，请先在「账号安全」创建密码再解绑）'}
                  </p>
                </>
              ) : (
                <>
                  <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                    绑定后无需再输账号密码，点一下 GitHub 就能登录（绑定你自己的 GitHub 账号，别绑别人的）。
                  </p>
                  <a className="primary" href="/api/auth/github?bind=1" style={{ display: 'inline-block', padding: '0.5rem 1.1rem', borderRadius: 8, background: 'var(--accent-strong)', color: '#fff', fontWeight: 600, textDecoration: 'none' }}>
                    绑定 GitHub
                  </a>
                </>
              )}
            </div>

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
                  <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
                    注销需要<strong>邮箱验证</strong>；确认后进入 3 天冷静期，期间重新登录即可取消。此操作需要完成人机验证。
                  </p>
                  <button type="button" style={{ color: '#dc2626' }} onClick={() => setDeletePrompt(true)}>
                    申请注销账号
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {section === 'privacy' && (
          <form onSubmit={submitPrivacy} className="panel" style={{ maxWidth: 560 }}>
            <p className="panel-title">隐私设置</p>
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
              三个可见度分开设置：谁可以看到你的关注列表、粉丝列表，以及主页内容。
            </p>
            <div style={{ display: 'grid', gap: '0.8rem' }}>
              <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.9rem' }}>
                关注列表可见度
                <select name="followingVisibility" defaultValue={profile.followingVisibility ?? 'public'}>
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.9rem' }}>
                粉丝列表可见度
                <select name="followersVisibility" defaultValue={profile.followersVisibility ?? 'public'}>
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.9rem' }}>
                主页可见度
                <select name="homepageVisibility" defaultValue={profile.homepageVisibility ?? 'public'}>
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* 能否被搜到：默认开着；关掉后导航栏搜索/用户搜索都找不到你（主页链接仍可直接访问） */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input type="checkbox" name="searchable" defaultChecked={profile.searchable !== false} />
                允许别人在搜索里找到我
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  （默认开启；关掉后搜索不到你，但主页链接仍可访问）
                </span>
              </label>
              <button type="submit" className="primary" style={{ alignSelf: 'flex-start' }}>
                保存隐私设置
              </button>
            </div>
          </form>
        )}

        {section === 'appearance' && (
          <div className="panel" style={{ marginBottom: 0 }}>
            <p className="panel-title">外观 · 主题颜色</p>
            <ThemePicker />
          </div>
        )}
      </div>

      {deletePrompt && (
        <CaptchaGateModal
          title="申请注销账号"
          description="我们会向你的注册邮箱发送确认链接；点击后进入 3 天冷静期。请先完成人机验证。"
          confirmLabel="发送注销确认邮件"
          captcha={captcha}
          busy={deleteBusy}
          error={msg}
          onClose={() => setDeletePrompt(false)}
          onConfirm={(captchaToken) => void confirmDelete(captchaToken)}
        />
      )}
    </div>
  );
}