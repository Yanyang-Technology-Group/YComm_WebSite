import { describe, expect, it } from 'vitest';
import { DOWNLOAD_AREA, isExternalHostAllowed } from './downloads';

describe('isExternalHostAllowed', () => {
  it('allows exact matches', () => {
    expect(isExternalHostAllowed('pan.baidu.com')).toBe(true);
    expect(isExternalHostAllowed('github.com')).toBe(true);
  });

  it('allows any subdomain of an allowed host', () => {
    expect(isExternalHostAllowed('d.serctl.com')).toBe(true);
    expect(isExternalHostAllowed('dl.github.com')).toBe(true);
  });

  it('rejects unknown and lookalike hosts', () => {
    expect(isExternalHostAllowed('evil.com')).toBe(false);
    // suffix attack: the host must be a whole label prefix, not a prefix of a name
    expect(isExternalHostAllowed('github.com.evil.example')).toBe(false);
    expect(isExternalHostAllowed('notpan.baidu.com.evil')).toBe(false);
    expect(isExternalHostAllowed('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isExternalHostAllowed('PAN.BAIDU.COM')).toBe(true);
  });
});

describe('download area knobs', () => {
  it('keeps the signed-link lifetime short', () => {
    expect(DOWNLOAD_AREA.signedJumpUrlTtlSeconds).toBeLessThanOrEqual(600);
  });
});