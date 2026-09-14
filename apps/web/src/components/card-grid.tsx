import Link from 'next/link';

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

/** 下载区卡片网格（服务端渲染）。 */
export function CardGrid({ cards }: { cards: PublicCard[] }) {
  return (
    <div className="card-grid">
      {cards.map((card) => {
        const style = { gridColumn: `span ${card.w}`, gridRow: `span ${card.h}` } as React.CSSProperties;
        const body = (
          <>
            <div className="card-tile-title">{card.title}</div>
            {card.subtitle && <div className="card-tile-subtitle">{card.subtitle}</div>}
            {card.subtitleUrl && <span className="card-tile-kind">🔗 简介链接</span>}
            {card.kind === 'redirect' && <span className="card-tile-kind">↗ 外链</span>}
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
