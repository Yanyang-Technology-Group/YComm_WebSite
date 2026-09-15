export interface UserBadgeView {
  id: string;
  name: string;
  colorFrom: string;
  colorTo: string;
}

/**
 * 用户徽章（多徽章，渐变色胶囊）。放在用户名旁边展示。
 * 颜色来自管理员可视化设置的渐变两色。
 */
export function UserBadges({ badges, size = 'sm' }: { badges: UserBadgeView[]; size?: 'sm' | 'md' }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className={`user-badges${size === 'md' ? ' user-badges-md' : ''}`}>
      {badges.map((badge) => (
        <span
          key={badge.id}
          className="user-badge"
          style={{ background: `linear-gradient(135deg, ${badge.colorFrom}, ${badge.colorTo})` }}
          title={badge.name}
        >
          {badge.name}
        </span>
      ))}
    </span>
  );
}