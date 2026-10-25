'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SiteBranding } from '@ycomm/config';
import { LEGAL_DOCS } from '@ycomm/config';
import { normalizeUiStyle, UI_STYLE_CHANGE_EVENT } from '../lib/appearance';

const UI_NAMES = { flat: 'Flat Design', apple: 'Apple UI', legacy: '经典界面' } as const;
const THEME_NAMES: Record<string, string> = {
  azure: '晏阳蓝', red: '玫瑰红', pink: '猛男粉', mint: '纳西妲绿', orange: '活力橙', slate: '默认灰',
};

export function SiteFooter({ branding, version }: { branding: SiteBranding; version: string }) {
  const [appearance, setAppearance] = useState({ ui: 'flat', theme: '晏阳蓝 · 跟随系统' });

  useEffect(() => {
    const sync = () => {
      const root = document.documentElement;
      const ui = normalizeUiStyle(root.dataset.uiStyle);
      const colour = THEME_NAMES[root.dataset.themeColour ?? 'azure'] ?? '自定义';
      const mode = root.dataset.themeMode === 'dark' ? '深色' : root.dataset.themeMode === 'light' ? '浅色' : '跟随系统';
      setAppearance({ ui: UI_NAMES[ui], theme: `${colour} · ${mode}` });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-style', 'data-theme-colour', 'data-theme-mode'] });
    window.addEventListener(UI_STYLE_CHANGE_EVENT, sync);
    return () => {
      observer.disconnect();
      window.removeEventListener(UI_STYLE_CHANGE_EVENT, sync);
    };
  }, []);

  return (
    <footer className="site-footer site-footer-polished">
      <div className="site-footer-inner site-footer-layout">
        <div className="footer-brand-block">
          <Link href="/" className="footer-brand" aria-label={branding.name}>
            <img src="/logo.png" alt="" width={38} height={38} />
            <span>{branding.name}</span>
          </Link>
          <span className="footer-copyright">© 2025-2026 晏阳技术组</span>
          {branding.icp && <span className="footer-copyright">{branding.icp}</span>}
        </div>
        <div className="footer-meta-grid">
          <span><b>版本</b><span title="版本号（yyyy.mm.dd.提交数）">{version}</span></span>
          <span><b>架构</b><span>Next.js · React · Hono API</span></span>
          <span><b>Github Repo</b><a href="https://github.com/Yanyang-Technology-Group/YComm_WebSite" target="_blank" rel="noopener noreferrer">GitHub ↗</a></span>
          <span><b>Gitee Mirrors</b><a href="https://gitee.com/Yanyang-Technology-Group/YComm_WebSite" target="_blank" rel="noopener noreferrer">Gitee ↗</a></span>
          <span><b>当前 UI</b><span>{appearance.ui}</span></span>
          <span><b>当前主题</b><span>{appearance.theme}</span></span>
          <span className="footer-legal-links"><b>文档</b><span>
            {LEGAL_DOCS.filter((doc) => doc.mirror).map((doc, index) => (
              <span key={doc.href}>
                {index > 0 && <i aria-hidden="true"> · </i>}
                <a href={doc.mirror} target="_blank" rel="noopener noreferrer">{doc.label.replace(/[《》]/g, '')}（腾讯文档）</a>
              </span>
            ))}
          </span></span>
        </div>
      </div>
    </footer>
  );
}
