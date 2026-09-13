import Link from 'next/link';
import type { Metadata } from 'next';
import { apiGet } from '../../../lib/server-api';
import { FollowButton } from '../../../components/follow-button';
import { FollowSections } from '../../../components/follow-sections';
import { MarkdownContent } from '../../../components/markdown-content';

export const metadata: Metadata = { title: '主页' };
export const dynamic = 'force-dynamic';

interface UserProfileView {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  bio: string;
  homepageMd: string;
  role: 'member' | 'admin' | 'owner';
  level: number;
  state: string;
  createdAt: string;
  postCount: number;
  likeReceivedCount: number;
  followerCount: number;
  followingCount: number;
  viewerFollowsTarget: boolean;
  targetFollowsViewer: boolean;
  listsVisible: boolean;
  socialVisibility: 'public' | 'mutual' | 'private';
  isSelf: boolean;
}

const ROLE_LABEL: Record<string, string> = { member: '成员', admin: '管理员', owner: '站长' };

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const result = await apiGet<{ profile: UserProfileView }>(`/api/users/${encodeURIComponent(username)}`);
  const profile = result.data?.profile;

  if (!profile) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <p className="muted">用户不存在，或该账号已注销/封禁。</p>
        <p>
          <Link href="/forum" className="muted">
            ← 返回论坛
          </Link>
        </p>
      </div>
    );
  }

  const joined = new Date(profile.createdAt).toLocaleDateString('zh-CN');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="panel" style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {profile.avatarPath ? (
          <img src={profile.avatarPath} alt={profile.displayName} className="avatar" style={{ width: 76, height: 76, fontSize: '2rem' }} />
        ) : (
          <span className="avatar avatar-fallback" style={{ width: 76, height: 76, fontSize: '2rem' }}>
            {(profile.displayName || profile.username).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0, fontSize: '1.5rem' }}>
              {profile.displayName || profile.username}
            </h1>
            <span className="muted">@{profile.username}</span>
            <span className="badge badge-role-admin">{ROLE_LABEL[profile.role] ?? profile.role}</span>
            <span className="badge badge-neutral">Lv{profile.level}</span>
            {profile.targetFollowsViewer && profile.viewerFollowsTarget && (
              <span className="badge badge-state-active">互关</span>
            )}
          </div>
          <p className="muted" style={{ margin: '0.4rem 0 0' }}>
            {joined} 加入 · {profile.followerCount} 粉丝 · 关注 {profile.followingCount}
          </p>
          {profile.bio && <p style={{ margin: '0.5rem 0 0' }}>{profile.bio}</p>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
          <FollowButton
            username={profile.username}
            initialFollowing={profile.viewerFollowsTarget}
            isSelf={profile.isSelf}
          />
          {profile.isSelf && (
            <Link href="/dashboard" className="muted" style={{ fontSize: '0.85rem' }}>
              编辑主页 →
            </Link>
          )}
        </div>
      </div>

      <FollowSections
        username={profile.username}
        initialVisible={profile.listsVisible}
        followerCount={profile.followerCount}
        followingCount={profile.followingCount}
        isSelf={profile.isSelf}
      />

      {profile.homepageMd.trim() ? (
        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <p className="panel-title">主页</p>
          <MarkdownContent text={profile.homepageMd} />
        </div>
      ) : (
        <p className="muted" style={{ margin: '0 0 1rem' }}>
          这个用户还没有填写主页内容。
        </p>
      )}
    </div>
  );
}