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
  w: number;
  h: number;
}

/** 下载区卡片网格（服务端渲染）。简介用安全 Markdown 渲染，链接直接内嵌在文字里。 */
export function CardGrid({ cards }: { cards: PublicCard[] }) {
  return (
    <div className="card-grid">
      {cards.map((card) => {
        const style = { gridColumn: `span ${card.w}`, gridRow: `span ${card.h}` } as React.CSSProperties;
        const isRedirect = card.kind === 'redirect' && card.redirectUrl;
        const body = (
          <>
            <div className="card-tile-title">{card.title}</div>
            {card.subtitle && (
              <div className="card-tile-subtitle">
                {/* 外链卡整卡可点，简介只当纯文本展示，避免链接嵌链接 */}
                {isRedirect ? (
                  card.subtitle
                ) : (
                  <MarkdownContent text={card.subtitle} />
                )}
              </div>
            )}
            {isRedirect && <span className="card-tile-kind">↗ 外链</span>}
            {card.kind === 'resources' && <span className="card-tile-kind">📦 资源</span>}
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