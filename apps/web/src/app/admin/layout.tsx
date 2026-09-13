import type { Metadata } from 'next';
import { AppNav } from '../../components/app-nav';

export const metadata: Metadata = { title: '管理' };
export const dynamic = 'force-dynamic';

/**
 * 管理区外壳：全站统一左侧导航（个人 + 管理一套到底）。
 * 电脑端贴左加宽常驻；手机端顶部横向标签条。
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppNav />
      <div className="app-content">{children}</div>
    </div>
  );
}
