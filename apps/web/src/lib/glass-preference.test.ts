import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGlass, DEFAULT_GLASS, GLASS_BOOT_SCRIPT, GLASS_KEY, normalizeGlass, readActiveGlass, readGlass } from './glass-preference';

afterEach(() => vi.unstubAllGlobals());
describe('Apple glass preferences', () => {
  it('defaults on, clamps transparency and ignores malformed values', () => {
    expect(normalizeGlass(null)).toEqual(DEFAULT_GLASS);
    expect(normalizeGlass({ enabled: false, transparency: 999 })).toEqual({ enabled: false, transparency: 90 });
    expect(normalizeGlass({ transparency: NaN })).toEqual(DEFAULT_GLASS);
  });
  it('switch and slider survive reload, boot script and blocked storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value) };
    const properties = new Map<string, string>();
    const root = { dataset: {} as Record<string, string>, style: {
      setProperty: vi.fn((key: string, value: string) => properties.set(key, value)),
      getPropertyValue: (key: string) => properties.get(key) ?? '',
    } };
    const document = { documentElement: root };
    vi.stubGlobal('document', document);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    applyGlass({ enabled: false, transparency: 82 });
    expect(readGlass()).toEqual({ enabled: false, transparency: 82 });
    expect(values.has(GLASS_KEY)).toBe(true);
    root.dataset = {};
    runInNewContext(GLASS_BOOT_SCRIPT, { document, localStorage: storage });
    expect(root.dataset.appleGlass).toBe('off');
    expect(root.style.setProperty).toHaveBeenLastCalledWith('--apple-glass-transparency', '82%');
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
    applyGlass({ enabled: false, transparency: 42 });
    expect(root.dataset.appleGlass).toBe('off');
    expect(readActiveGlass()).toEqual({ enabled: false, transparency: 42 });
    expect(readGlass()).toEqual(DEFAULT_GLASS);
  });
});
