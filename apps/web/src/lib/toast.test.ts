import { afterEach, describe, expect, it, vi } from 'vitest';
import { showToast, subscribeToasts } from './toast';

afterEach(() => { vi.unstubAllGlobals(); });
describe('save toast event delivery', () => {
  it('ignores server rendering and delivers browser events', () => {
    const listener = vi.fn(); const unsubscribe = subscribeToasts(listener);
    showToast(); expect(listener).not.toHaveBeenCalled();
    vi.stubGlobal('window', {}); showToast();
    expect(listener).toHaveBeenLastCalledWith({ message: '保存成功', tone: 'success' });
    showToast('保存失败', 'error'); expect(listener).toHaveBeenLastCalledWith({ message: '保存失败', tone: 'error' });
    unsubscribe();
  });
  it('buffers only the latest three events before mounting and unsubscribes cleanly', () => {
    vi.stubGlobal('window', {}); for (let i = 0; i < 4; i++) showToast(String(i));
    const listener = vi.fn(); const unsubscribe = subscribeToasts(listener);
    expect(listener.mock.calls.map(([toast]) => toast.message)).toEqual(['1', '2', '3']);
    unsubscribe(); showToast('next'); expect(listener).toHaveBeenCalledTimes(3);
    const next = vi.fn(); subscribeToasts(next)(); expect(next).toHaveBeenCalledWith({ message: 'next', tone: 'success' });
  });
});
