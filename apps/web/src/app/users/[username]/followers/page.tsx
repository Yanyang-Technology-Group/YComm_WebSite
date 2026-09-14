import type { Metadata } from 'next';
import { apiGet } from '../../../../lib/server-api';
import { FollowListPage } from '../../../../components/follow-list-page';

export const metadata: Metadata = { title: '粉丝列表' };
export const dynamic = 'force-dynamic';

interface ProfileFragment {
  username: string;
  followersListVisible: boolean;
}

export default async function UserFollowersPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const result = await apiGet<{ profile: ProfileFragment }>(`/api/users/${encodeURIComponent(username)}`);
  const profile = result.data?.profile;

  if (!profile) return <p className="muted">用户不存在。</p>;

  return <FollowListPage username={profile.username} kind="followers" visible={profile.followersListVisible} />;
}