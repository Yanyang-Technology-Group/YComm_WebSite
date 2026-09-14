import type { Metadata } from 'next';
import { apiGet } from '../../../../lib/server-api';
import { FollowListPage } from '../../../../components/follow-list-page';

export const metadata: Metadata = { title: '关注列表' };
export const dynamic = 'force-dynamic';

interface ProfileFragment {
  username: string;
  followingListVisible: boolean;
}

export default async function UserFollowingPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const result = await apiGet<{ profile: ProfileFragment }>(`/api/users/${encodeURIComponent(username)}`);
  const profile = result.data?.profile;

  if (!profile) return <p className="muted">用户不存在。</p>;

  return <FollowListPage username={profile.username} kind="following" visible={profile.followingListVisible} />;
}