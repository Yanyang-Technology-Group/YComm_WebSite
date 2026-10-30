import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRegistrationAge } from './registration-age';

afterEach(() => vi.useRealTimers());

describe('registration date handoff', () => {
  it('keeps only the birth date once the user is fourteen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T16:00:00Z'));
    expect(readRegistrationAge(JSON.stringify({ birthDate: '2012-10-30', guardianEmail: 'unneeded@example.com' })))
      .toEqual({ birthDate: '2012-10-30' });
  });

  it('requires and normalizes a guardian address for a child', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T15:59:59Z'));
    const birthDate = '2012-10-30';
    expect(readRegistrationAge(JSON.stringify({ birthDate }))).toBeNull();
    expect(readRegistrationAge(JSON.stringify({ birthDate, guardianEmail: 'invalid' }))).toBeNull();
    expect(readRegistrationAge(JSON.stringify({ birthDate, guardianEmail: `${'x'.repeat(250)}@a.test` }))).toBeNull();
    expect(readRegistrationAge(JSON.stringify({ birthDate, guardianEmail: ' Parent@Example.COM ' })))
      .toEqual({ birthDate, guardianEmail: 'parent@example.com' });
  });

  it('rejects absent, malformed or invalid handoff data', () => {
    for (const raw of [undefined, '', '{', 'null', '[]', 'true', '{}', '{"birthDate":0}', '{"birthDate":"2013-02-29"}', '{"birthDate":"9999-01-01"}']) {
      expect(readRegistrationAge(raw)).toBeNull();
    }
  });
});
