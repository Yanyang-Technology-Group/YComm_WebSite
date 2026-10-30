import { describe, expect, it } from 'vitest';
import { registrationAge, registrationToday } from './age';

describe('registration age (Asia/Shanghai)', () => {
  it('turns fourteen on the birthday in the site timezone', () => {
    expect(registrationAge('2012-10-30', new Date('2026-10-29T15:59:59Z'))).toBe(13);
    expect(registrationAge('2012-10-30', new Date('2026-10-29T16:00:00Z'))).toBe(14);
    expect(registrationToday(new Date('2026-10-29T16:00:00Z'))).toBe('2026-10-30');
  });

  it('accepts a real leap day and rejects malformed, impossible and future dates', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    expect(registrationAge('2012-02-29', now)).toBe(14);
    expect(registrationAge('2026-10-30', now)).toBe(0);
    for (const value of ['', '2012-2-29', '2012-02-30', '2013-02-29', '2026-13-01', '1899-12-31', '2026-10-31']) {
      expect(registrationAge(value, now)).toBeNull();
    }
  });
});
