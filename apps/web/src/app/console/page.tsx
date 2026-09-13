import type { Metadata } from 'next';
import { ConsolePanel } from '../../components/console-panel';

export const metadata: Metadata = { title: '个人控制台' };
export const dynamic = 'force-dynamic';

/**
 * 控制台页不再做服务端登录判断/重定向（cookies() 判定有假阳性），
 * 让客户端 ConsolePanel 自检登录态：未登录显示「请先登录」，已登录渲染面板。
 */
export default function ConsolePage() {
  return <ConsolePanel />;
}