import type { Metadata } from 'next';
import { BadgeManagerPanel } from '../../../components/badge-manager';

export const metadata: Metadata = { title: '徽章管理' };
export const dynamic = 'force-dynamic';

export default function AdminBadgesPage() {
  return (
    <div>
      <h1>徽章管理</h1>
      <BadgeManagerPanel />
    </div>
  );
}