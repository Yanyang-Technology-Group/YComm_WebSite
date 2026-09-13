import type { Metadata } from 'next';
import { DashboardPanel } from '../../components/dashboard-panel';

export const metadata: Metadata = { title: '控制台' };
export const dynamic = 'force-dynamic';

/**
 * 控制台（dashboard）：左侧导航 + 右侧内容。登录态由客户端自检：
 * 未登录显示提示，已登录渲染面板（不再服务端重定向，避免误判）。
 */
export default function DashboardPage() {
  return <DashboardPanel />;
}