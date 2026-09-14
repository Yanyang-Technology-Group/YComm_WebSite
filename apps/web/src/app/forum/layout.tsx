import { ForumShell } from '../../components/forum-shell';

export const dynamic = 'force-dynamic';

/** 论坛三栏外壳（可自定义宽度）：左板块导航 + 中内容 + 右通知栏。 */
export default function ForumLayout({ children }: { children: React.ReactNode }) {
  return <ForumShell>{children}</ForumShell>;
}