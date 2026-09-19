import type { Metadata } from 'next';
import { ApiKeysPanel } from '../../../components/api-keys-panel';

export const metadata: Metadata = { title: 'API 密钥' };
export const dynamic = 'force-dynamic';

/** 开放 API 密钥（仅站长可访问，接口层另有 API_KEY_MANAGE 权限兜底）。 */
export default function AdminApiKeysPage() {
  return (
    <div>
      <h1>API 密钥</h1>
      <ApiKeysPanel />
    </div>
  );
}