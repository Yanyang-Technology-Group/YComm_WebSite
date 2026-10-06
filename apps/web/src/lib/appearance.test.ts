import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('web appearance preference', () => {
  const root = { dataset: {} as Record<string, string>, offsetWidth: 1024 };
  const storage = { getItem: vi.fn(), setItem: vi.fn() };
  const page = { documentElement: root, startViewTransition: vi.fn() };
  const browser = { matchMedia: vi.fn(), dispatchEvent: vi.fn() };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    root.dataset = { uiStyle: 'flat' };
    storage.getItem.mockReset().mockReturnValue(null);
    storage.setItem.mockReset();
    page.startViewTransition.mockReset();
    browser.matchMedia.mockReset().mockReturnValue({ matches: false });
    browser.dispatchEvent.mockReset();
    vi.stubGlobal('document', page);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', browser);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([null, 'daisyui', 'apple', 'flat', 'legacy', 'invalid'])('restores %s before the first paint', async (saved) => {
    const { UI_STYLE_BOOT_SCRIPT, readStoredUiStyle } = await import('./appearance');
    storage.getItem.mockReturnValue(saved);
    runInNewContext(UI_STYLE_BOOT_SCRIPT, { document: page, localStorage: storage });
    expect(root.dataset.uiStyle).toBe(readStoredUiStyle());
    expect(root.dataset.uiStyle).toBe(saved === 'apple' || saved === 'legacy' ? saved : 'flat');
  });

  it('applies the preference when browser storage is blocked', async () => {
    const { UI_STYLE_BOOT_SCRIPT, readStoredUiStyle, applyUiStyle } = await import('./appearance');
    storage.getItem.mockImplementation(() => { throw new Error('storage blocked'); });
    storage.setItem.mockImplementation(() => { throw new Error('storage blocked'); });
    root.dataset.uiStyle = 'legacy';
    runInNewContext(UI_STYLE_BOOT_SCRIPT, { document: page, localStorage: storage });
    expect(root.dataset.uiStyle).toBe('flat');
    expect(readStoredUiStyle()).toBe('flat');
    applyUiStyle('apple');
    expect(root.dataset.uiStyle).toBe('apple');
  });

  it('persists a selection and removes animation after it ends', async () => {
    const { applyUiStyle, UI_STYLE_KEY } = await import('./appearance');
    applyUiStyle('apple', { animate: true });
    expect(root.dataset).toEqual({ uiStyle: 'apple', uiTransition: 'fallback' });
    expect(storage.setItem).toHaveBeenLastCalledWith(UI_STYLE_KEY, 'apple');
    vi.advanceTimersByTime(200);
    applyUiStyle('legacy', { animate: true });
    vi.advanceTimersByTime(150);
    expect(root.dataset.uiTransition).toBe('fallback');
    vi.advanceTimersByTime(200);
    expect(root.dataset).toEqual({ uiStyle: 'legacy' });
  });

  it('skips animation when reduced motion is enabled', async () => {
    browser.matchMedia.mockReturnValue({ matches: true });
    const { applyUiStyle } = await import('./appearance');
    applyUiStyle('apple', { animate: true });
    expect(root.dataset).toEqual({ uiStyle: 'apple' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['flat', 'legacy'] as const)('switches immediately from %s to Apple UI despite broken snapshot animations', async (previous) => {
    root.dataset.uiStyle = previous;
    page.startViewTransition.mockImplementation(() => { throw new Error('snapshot failed'); });
    const { applyUiStyle, UI_STYLE_CHANGE_EVENT, UI_STYLE_BOOT_SCRIPT } = await import('./appearance');
    applyUiStyle('apple', { animate: true });
    expect(root.dataset.uiStyle).toBe('apple');
    expect(page.startViewTransition).not.toHaveBeenCalled();
    expect(browser.dispatchEvent.mock.calls[0]![0].type).toBe(UI_STYLE_CHANGE_EVENT);
    vi.runAllTimers();
    expect(root.dataset.uiStyle).toBe('apple');
    storage.getItem.mockReturnValue(storage.setItem.mock.calls.at(-1)![1]);
    runInNewContext(UI_STYLE_BOOT_SCRIPT, { document: page, localStorage: storage });
    expect(root.dataset.uiStyle).toBe('apple');
  });

  it('keeps the most recent style after rapid switching', async () => {
    const { applyUiStyle } = await import('./appearance');
    for (const style of ['legacy', 'apple', 'flat', 'apple'] as const) {
      applyUiStyle(style, { animate: true });
      expect(root.dataset.uiStyle).toBe(style);
    }
    vi.runAllTimers();
    expect(root.dataset).toEqual({ uiStyle: 'apple' });
  });
});
