import type { Metadata } from 'next';
import { AuditLogPanel } from '../../../components/audit-log';

export const metadata: Metadata = { title: '操作日志' };
export const dynamic = 'force-dynamic';

/** 操作日志：管理员/站长做过的每一次管理动作都记录在案（只增不改）。 */
export default function AdminAuditPage() {
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>操作日志</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        封禁/禁言、角色变更、注销账号、版块与卡片改动、审核决定、登录记录都会写进这里，不可修改。
      </p>
      <AuditLogPanel />
    </div>
  );
}
