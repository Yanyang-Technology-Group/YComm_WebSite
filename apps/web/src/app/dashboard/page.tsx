import type { Metadata } from 'next';
import { captchaConfig } from '@ycomm/kernel';
import { DashboardPanel } from '../../components/dashboard-panel';

export const metadata: Metadata = { title: '控制台' };
export const dynamic = 'force-dynamic';

/**
 * 控制台（dashboard）：全站统一左侧导航 + 右侧内容。
 * 带加载动画（图标 + 蓝色旋转圆环），10 秒超时提示加载失败。
 */
export default function DashboardPage() {
  return <DashboardPanel captcha={captchaConfig()} />;
}