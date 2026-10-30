export interface ToastMessage { message: string; tone: 'success' | 'error' }
type ToastListener = (toast: ToastMessage) => void;
const listeners = new Set<ToastListener>();
const pending: ToastMessage[] = [];

/** Called only after a save has actually succeeded. Survives client navigation. */
export function showToast(message = '保存成功', tone: ToastMessage['tone'] = 'success'): void {
  if (typeof window === 'undefined') return;
  const toast = { message, tone };
  if (!listeners.size) {
    pending.push(toast);
    if (pending.length > 3) pending.shift();
  } else {
    listeners.forEach((listener) => listener(toast));
  }
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  pending.splice(0).forEach((toast) => listener(toast));
  return () => { listeners.delete(listener); };
}
