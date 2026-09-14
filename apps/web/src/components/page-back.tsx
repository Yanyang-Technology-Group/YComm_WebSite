'use client';

import { useRouter } from 'next/navigation';

/**
 * 页面左上角「← 返回」。
 * 有浏览历史时回退到上一页（比写死链接更贴近用户来路），
 * 直接落地、没有历史时跳转 fallback（父级页面）。
 */
export function PageBack({ fallback, label = '返回' }: { fallback: string; label?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className="page-back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.replace(fallback);
      }}
    >
      ← {label}
    </button>
  );
}