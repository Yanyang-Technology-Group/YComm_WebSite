import type { Metadata } from 'next';
import { BannedWordsPanel, InviteCodesPanel } from '../../../components/admin-panels';

export const metadata: Metadata = { title: '违禁词与注册码' };
export const dynamic = 'force-dynamic';

/** 站点设置：违禁词（发布时拦截）+ 注册码管理。 */
export default function AdminSettingsPage() {
  return (
    <div style={{ maxWidth: 900, display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 style={{ marginBottom: '0.25rem' }}>违禁词与注册码</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          违禁词用于拦截主题/回复的发布；注册码用于注册或解锁受限内容。
        </p>
      </div>
      <BannedWordsPanel />
      <InviteCodesPanel />
    </div>
  );
}
