import { createMiddleware } from 'hono/factory';
import { assertPermission, assertSubjectCanAct } from '@ycomm/access';
import type { Permission } from '@ycomm/config';
import { errors } from '@ycomm/kernel';
import type { AppVariables } from '../context';

/**
 * Runs the access chain for a permission point:
 * account state gate → permission. Marries the middleware with the domain.
 */
export const requirePermission =
  (permission: Permission) =>
  createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json(
        {
          ok: false,
          error: { code: 'ACCESS_LOGIN_REQUIRED', messageKey: 'ACCESS_LOGIN_REQUIRED', meta: {} },
        },
        401,
      );
    }
    const subject = auth.subject;
    try {
      assertSubjectCanAct(subject);
      assertPermission(subject, permission);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw errors.forbidden();
    }
    await next();
  });