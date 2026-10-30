'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeToasts, type ToastMessage } from '../lib/toast';

export function ToastViewport() {
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  useEffect(() => {
    setMounted(true);
    let sequence = 0;
    return subscribeToasts((next) => setToast({ ...next, id: ++sequence }));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  if (!mounted) return null;
  return createPortal(<div className="toast-viewport" role="status" aria-live="polite" aria-atomic="true">
    {toast && <div key={toast.id} className={`site-toast site-toast-${toast.tone}`}>
      <span aria-hidden="true">{toast.tone === 'success' ? '✓' : '!'}</span>
      <span>{toast.message}</span>
      <button type="button" aria-label="关闭提示" onClick={() => setToast(null)}>×</button>
    </div>}
  </div>, document.body);
}
