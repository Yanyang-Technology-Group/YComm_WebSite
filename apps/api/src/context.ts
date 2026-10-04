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
    /**
     * 这台设备是否已被该账号确认过（邮箱确认过一次即永久记住）。
     *
     * false = 待确认的新设备，除验证相关接口外一律 403。API 密钥鉴权恒为 true
     * （密钥本身就是账号持有人自己签发的）。
     */
    deviceTrusted: boolean;
  };
}