import Link from 'next/link';
import { MarkdownContent } from './markdown-content';

export interface PublicCard {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string;
  subtitleUrl: string | null;
  kind: string;
  redirectUrl: string | null;
  /** 可见度：public 公开 / login 需登录 / invite 需注册码 / staff 仅管理员。 */
  visibility?: string;
  w: number;
  h: number;
}

/** 可见度的对公文案与颜色（下载区卡片右上角展示）。 */
const VISIBILITY_BADGE: Record<string, { label: string; className: string; title: string }> = {
  public: { label: '公开', className: 'card-vis-public', title: '所有人可见' },
  login: { label: '需登录', className: 'card-vis-login', title: '需要登录后才能查看' },
  invite: { label: '需注册码', className: 'card-vis-invite', title: '需要绑定过注册码才能查看' },
  staff: { label: '仅管理员', className: 'card-vis-staff', title: '仅管理员 / 站长可见' },
};

/** 下载区卡片网格（服务端渲染）。简介用安全 Markdown 渲染，链接直接内嵌在文字里。 */
export function CardGrid({ cards }: { cards: PublicCard[] }) {
  return (
    <div className="card-grid">
      {cards.map((card) => {
        const style = { gridColumn: `span ${card.w}`, gridRow: `span ${card.h}` } as React.CSSProperties;
        const isRedirect = card.kind === 'redirect' && card.redirectUrl;
        const badge = VISIBILITY_BADGE[card.visibility ?? 'public'];
        const body = (
          <>
            {badge && (
              <span className={`card-vis ${badge.className}`} title={badge.title}>
                {badge.label}
              </span>
            )}
            <div className="card-tile-title">{card.title}</div>
            {card.subtitle && (
              <div className="card-tile-subtitle">
                {/* 外链卡整卡可点，简介只当纯文本展示，避免链接嵌链接 */}
                {isRedirect ? card.subtitle : <MarkdownContent text={card.subtitle} />}
              </div>
            )}
          </>
        );
        if (card.kind === 'redirect' && card.redirectUrl) {
          return (
            <a key={card.id} href={card.redirectUrl} target="_blank" rel="noopener noreferrer" className="card-tile" style={style}>
              {body}
            </a>
          );
        }
        return (
          <Link key={card.id} href={`/downloads/card/${card.id}`} className="card-tile" style={style}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}