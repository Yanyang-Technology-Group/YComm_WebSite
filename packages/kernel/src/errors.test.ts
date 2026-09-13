import { describe, expect, it } from 'vitest';
import {
  AppError,
  ErrorCodes,
  errors,
  isAppError,
  toAppError,
} from './errors';

describe('AppError', () => {
  it('carries code, status, messageKey and meta', () => {
    const error = new AppError({
      code: ErrorCodes.ACCESS_LEVEL_TOO_LOW,
      httpStatus: 403,
      meta: { requiredLevel: 2 },
    });
    expect(error.httpStatus).toBe(403);
    expect(error.messageKey).toBe(ErrorCodes.ACCESS_LEVEL_TOO_LOW);
    expect(error.meta).toMatchObject({ requiredLevel: 2 });
    expect(error.isClientError).toBe(true);
  });

  it('只有 expose 的错误才把面向用户的文案发给客户端', () => {
    // 中文文案要能到达前端，否则注册冲突只会显示笼统的「操作冲突」。
    expect(errors.conflict('该用户名已被别人用了，换一个吧').toJSON()).toMatchObject({
      code: ErrorCodes.CONFLICT,
      message: '该用户名已被别人用了，换一个吧',
    });

    // 内部错误（expose=false）永远不带 message。
    const internal = toAppError(new Error('secret internals'));
    expect(internal.toJSON()).not.toHaveProperty('message');
    expect(JSON.stringify(internal.toJSON())).not.toContain('secret internals');
  });
});

describe('toAppError', () => {  it('passes AppErrors through untouched', () => {
    const original = errors.forbidden();
    expect(toAppError(original)).toBe(original);
  });

  it('maps an Error to INTERNAL without leaking its message to clients by default', () => {
    const mapped = toAppError(new Error('secret internals'));
    expect(mapped.code).toBe(ErrorCodes.INTERNAL);
    expect(mapped.expose).toBe(false);
    expect(mapped.isClientError).toBe(false);
  });

  it('maps zod-style issue objects to VALIDATION_FAILED with paths', () => {
    const mapped = toAppError({
      issues: [
        { path: ['username'], message: 'invalid' },
        { path: ['email'], message: 'required' },
      ],
    });
    expect(mapped.code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(mapped.meta).toMatchObject({
      issues: [
        { path: 'username', message: 'invalid' },
        { path: 'email', message: 'required' },
      ],
    });
  });
});

describe('error factories', () => {
  it('policy denials carry explanatory meta for the UI', () => {
    const error = errors.levelTooLow(2, 1);
    expect(error.meta).toMatchObject({ requiredLevel: 2, currentLevel: 1 });
  });

  it('role/invite denials flag the recovery path', () => {
    expect(errors.inviteRequired().meta).toMatchObject({ requireInvite: true });
  });

  it('account state gates map to their own codes', () => {
    expect(isAppError(errors.accountUnverified())).toBe(true);
    expect(errors.accountBanned('spam').meta).toMatchObject({ reason: 'spam' });
    expect(errors.accountMuted(new Date('2030-01-01')).meta.until).toBe('2030-01-01T00:00:00.000Z');
  });
});