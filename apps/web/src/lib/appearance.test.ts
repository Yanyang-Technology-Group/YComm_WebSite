import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('web appearance preference', () => {
  const root = { dataset: {} as Record<string, string>, offsetWidth: 1024 };
  const storage = { getItem: vi.fn(), setItem: vi.fn() };
  const page: { documentElement: typeof root; startViewTransition?: ReturnType<typeof vi.fn> } = {
    documentElement: root,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    root.dataset = { uiStyle: 'daisyui' };
    delete page.startViewTransition;
    storage.getItem.mockReset().mockReturnValue(null);
    storage.setItem.mockReset();
    vi.stubGlobal('document', page);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue({ matches: false }) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('defaults to DaisyUI while preserving saved Flat Design and classic choices', async () => {
    const { readStoredUiStyle, UI_STYLE_KEY } = await import('./appearance');
    for (const [saved, expected] of [
      [null, 'daisyui'], ['daisyui', 'daisyui'], ['flat', 'flat'],
      ['legacy', 'legacy'], ['invalid', 'daisyui'],
    ]) {
      storage.getItem.mockReturnValue(saved);
      expect(readStoredUiStyle()).toBe(expected);
      expect(storage.getItem).toHaveBeenLastCalledWith(UI_STYLE_KEY);
    }
  });

  it.each([null, 'daisyui', 'flat', 'legacy', 'invalid'])('restores %s before the first paint', async (saved) => {
    const { UI_STYLE_BOOT_SCRIPT, readStoredUiStyle } = await import('./appearance');
    storage.getItem.mockReturnValue(saved);
    runInNewContext(UI_STYLE_BOOT_SCRIPT, { document: page, localStorage: storage });
    expect(root.dataset.uiStyle).toBe(readStoredUiStyle());
  });

  it('applies the preference when browser storage is blocked', async () => {
    const { UI_STYLE_BOOT_SCRIPT, readStoredUiStyle, applyUiStyle } = await import('./appearance');
    storage.getItem.mockImplementation(() => { throw new Error('storage blocked'); });
    storage.setItem.mockImplementation(() => { throw new Error('storage blocked'); });
    root.dataset.uiStyle = 'legacy';
    runInNewContext(UI_STYLE_BOOT_SCRIPT, { document: page, localStorage: storage });
    expect(root.dataset.uiStyle).toBe('daisyui');
    expect(readStoredUiStyle()).toBe('daisyui');
    applyUiStyle('flat');
    expect(root.dataset.uiStyle).toBe('flat');
  });

  it('persists a selection and removes the fallback animation after it ends', async () => {
    const { applyUiStyle, UI_STYLE_KEY } = await import('./appearance');
    applyUiStyle('flat', { animate: true });
    expect(root.dataset).toEqual({ uiStyle: 'flat', uiTransition: 'fallback' });
    expect(storage.setItem).toHaveBeenLastCalledWith(UI_STYLE_KEY, 'flat');
    vi.advanceTimersByTime(200);
    applyUiStyle('legacy', { animate: true });
    vi.advanceTimersByTime(150);
    expect(root.dataset.uiTransition).toBe('fallback');
    vi.advanceTimersByTime(200);
    expect(root.dataset).toEqual({ uiStyle: 'legacy' });
  });

  it('skips animation when reduced motion is enabled', async () => {
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue({ matches: true }) });
    page.startViewTransition = vi.fn();
    const { applyUiStyle } = await import('./appearance');
    applyUiStyle('flat', { animate: true });
    expect(root.dataset).toEqual({ uiStyle: 'flat' });
    expect(page.startViewTransition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the last choice when skipped native transitions finish out of order', async () => {
    const updates: Array<() => void> = [];
    const skipped = vi.fn();
    page.startViewTransition = vi.fn((update: () => void) => {
      updates.push(update);
      return { skipTransition: skipped, ready: Promise.resolve(), finished: new Promise(() => {}) };
    });
    const { applyUiStyle } = await import('./appearance');
    applyUiStyle('flat', { animate: true });
    applyUiStyle('legacy', { animate: true });
    updates[1]!();
    updates[0]!();
    expect(root.dataset.uiStyle).toBe('legacy');
    expect(skipped).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenLastCalledWith('ycomm_ui_style', 'legacy');
  });

  it('cancels a pending change when the user returns to the currently painted style', async () => {
    let updatePending!: () => void;
    const skipped = vi.fn();
    page.startViewTransition = vi.fn((update: () => void) => {
      updatePending = update;
      return { skipTransition: skipped, ready: Promise.resolve(), finished: new Promise(() => {}) };
    });
    const { applyUiStyle } = await import('./appearance');
    applyUiStyle('flat', { animate: true });
    applyUiStyle('daisyui', { animate: true });
    updatePending();
    expect(root.dataset.uiStyle).toBe('daisyui');
    expect(skipped).toHaveBeenCalledOnce();
    expect(page.startViewTransition).toHaveBeenCalledOnce();
  });
});
