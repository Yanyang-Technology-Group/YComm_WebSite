import type { AccessSubject } from '@ycomm/access';
import type { PublicUser } from '@ycomm/identity';

/** Hono app-wide variables. */
export interface AppVariables {
  /** Present when the request carried a valid session cookie or API key. */
  auth?: {
    user: PublicUser;
    /** Internal access subject — the full gate inputs, never serialized. */
    subject: AccessSubject;
    userId: string;
    /** 会话 id；用 API Key 鉴权时是 key 的 id。 */
    sessionId: string;
    /** 这次请求是用开放 API 密钥（Authorization: Bearer）鉴权的。 */
    viaApiKey?: boolean;
    /** 只读密钥：只允许 GET/HEAD，写操作一律 403。 */
    readOnly?: boolean;
  };
}