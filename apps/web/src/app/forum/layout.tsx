import Link from 'next/link';
import { getSiteBranding } from '@ycomm/config';
import { apiGet } from '../../lib/server-api';

export const dynamic = 'force-dynamic';

interface Board {
  slug: string;
  name: string;
  description: string;
  topic_count: number;
  post_count: number;
}

/**
 * 论坛三栏外壳（Discord 式）：左 = 版块列表，中 = 内容，右 = 社区信息/统计。
 */
export default async function ForumLayout({ children }: { children: React.ReactNode }) {
  const branding = getSiteBranding();
  const result = await apiGet<{ boards: Board[] }>('/api/forum/boards');
  const boards: Board[] = result.data?.boards ?? [];
  const totalTopics = boards.reduce((sum, b) => sum + (b.topic_count || 0), 0);
  const totalPosts = boards.reduce((sum, b) => sum + (b.post_count || 0), 0);

  return (
    <div className="forum-layout">
      <aside className="forum-sidebar">
        <div className="panel">
          <p className="panel-title">版块</p>
          {boards.map((board) => (
            <Link key={board.slug} href={`/forum/${board.slug}`} className="board-link">
              <span className="board-hash">#</span>
              <span>{board.name}</span>
            </Link>
          ))}
          {boards.length === 0 && <p className="muted">暂无版块</p>}
        </div>
      </aside>

      <div className="forum-center">{children}</div>

      <aside className="forum-info">
        <div className="panel">
          <p className="panel-title">社区</p>
          <p className="info-name">{branding.name}</p>
          <p className="muted">{branding.tagline}</p>
        </div>
        <div className="panel">
          <p className="panel-title">统计</p>
          <p className="muted">
            {boards.length} 个版块 · {totalTopics} 主题 · {totalPosts} 帖子
          </p>
        </div>
      </aside>
    </div>
  );
}
