import type { AccessSubject } from '@ycomm/access';
import type { PublicUser } from '@ycomm/identity';

/** Hono app-wide variables. */
export interface AppVariables {
  /** Present when the request carried a valid session cookie. */
  auth?: {
    user: PublicUser;
    /** Internal access subject — the full gate inputs, never serialized. */
    subject: AccessSubject;
    userId: string;
    sessionId: string;
  };
}