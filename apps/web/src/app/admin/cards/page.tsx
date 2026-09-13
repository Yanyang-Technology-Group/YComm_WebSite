import type { Metadata } from 'next';
import { CardsPanel } from '../../../components/card-editor';

export const metadata: Metadata = { title: '下载区卡片' };
export const dynamic = 'force-dynamic';

/** 下载区卡片门户：无限套娃（父子卡片）+ 可见度 + 拖拽尺寸。 */
export default function AdminCardsPage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>下载区卡片</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        新增卡片时可选「在某个卡片内」实现无限套娃，「可见度」决定谁能看到这张卡片。
      </p>
      <CardsPanel />
    </div>
  );
}
