'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SiteBranding } from '@ycomm/config';
import { LEGAL_DOCS } from '@ycomm/config';
import { normalizeUiStyle, UI_STYLE_CHANGE_EVENT } from '../lib/appearance';
import { GLASS_EVENT, readActiveGlass } from '../lib/glass-preference';

const UI_NAMES = { flat: 'Flat Design', apple: 'Apple UI', legacy: '经典界面' } as const;
const THEME_NAMES: Record<string, string> = {
  azure: '晏阳蓝', red: '玫瑰红', pink: '猛男粉', mint: '纳西妲绿', orange: '活力橙', slate: '默认灰',
};

type Platform = 'github' | 'gitee' | 'gitea';

function PlatformIcon({ platform }: { platform: Platform }) {
  const paths: Record<Platform, string> = {
    github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.73.084-.73 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.21 0 1.595-.015 2.88-.015 3.27 0 .315.21.69.825.57C20.565 22.092 24 17.595 24 12.297c0-6.627-5.373-12-12-12',
    gitee: 'M12 2a10 10 0 1 0 0 20h5.5v-3.1H12a6.9 6.9 0 1 1 6.9-6.9H12v3.1h10v-3.1A10 10 0 0 0 12 2Z',
    gitea: 'M20.9 10.2c-.3-1.8-1.8-3-3.6-3H9.7A5.7 5.7 0 0 0 4 12.9c0 3.1 2.5 5.7 5.7 5.7h3.1v-2.3H9.7a3.4 3.4 0 1 1 0-6.8h7.6c.6 0 1.1.4 1.2 1l.2 1.1-3.8 1.1c-.4-.6-1-.9-1.7-.9-1.1 0-2 .9-2 2s.9 2 2 2c.8 0 1.5-.5 1.8-1.2l5.5-1.6c.4-.1.7-.5.6-.9l-.2-1.9Z',
  };
  return <svg className="footer-platform-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={paths[platform]} /></svg>;
}

export function SiteFooter({ branding, version }: { branding: SiteBranding; version: string }) {
  const [appearance, setAppearance] = useState({ ui: 'flat', theme: '晏阳蓝 · 跟随系统', isApple: false, glassTransparency: '无' });

  useEffect(() => {
    const sync = () => {
      const root = document.documentElement;
      const ui = normalizeUiStyle(root.dataset.uiStyle);
      const colour = THEME_NAMES[root.dataset.themeColour ?? 'azure'] ?? '自定义';
      const mode = root.dataset.themeMode === 'dark' ? '深色' : root.dataset.themeMode === 'light' ? '浅色' : '跟随系统';
      const glass = readActiveGlass();
      setAppearance({
        ui: UI_NAMES[ui],
        theme: `${colour} · ${mode}`,
        isApple: ui === 'apple',
        glassTransparency: glass.enabled ? `${glass.transparency}%` : '无',
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-style', 'data-theme-colour', 'data-theme-mode', 'data-apple-glass', 'style'] });
    window.addEventListener(UI_STYLE_CHANGE_EVENT, sync);
    window.addEventListener(GLASS_EVENT, sync);
    return () => {
      observer.disconnect();
      window.removeEventListener(UI_STYLE_CHANGE_EVENT, sync);
      window.removeEventListener(GLASS_EVENT, sync);
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
          <div className="footer-credits" aria-label="鸣谢">
            <span>主要编写: 深水6</span>
            <span>资金赞助: dyzihnieg、小白</span>
            <span>特别鸣谢: 安云墨 AnYunMo</span>
          </div>
          {branding.icp && <span className="footer-copyright">{branding.icp}</span>}
        </div>
        <div className="footer-meta-grid">
          <span><b>版本</b><span title="版本号（yyyy.mm.dd.提交数）">{version}</span></span>
          <span><b>架构</b><span>Next.js · React · Hono API</span></span>
          <span><b>当前主题</b><span>{appearance.theme}</span></span>
          <span><b>Gitee Mirrors</b><a className="footer-platform-link" href="https://gitee.com/Yanyang-Technology-Group/YComm_WebSite" target="_blank" rel="noopener noreferrer"><PlatformIcon platform="gitee" />Gitee ↗</a></span>
          <span><b>Gitea Mirrors</b><a className="footer-platform-link" href="https://gitea.com/Yanyang-Technology-Group/YComm_WebSite" target="_blank" rel="noopener noreferrer"><PlatformIcon platform="gitea" />Gitea ↗</a></span>
          <span><b>当前 UI</b><span>{appearance.ui}{appearance.isApple ? `（液态玻璃透明度：${appearance.glassTransparency}）` : ''}</span></span>
          <span><b>Github Repo</b><a className="footer-platform-link" href="https://github.com/Yanyang-Technology-Group/YComm_WebSite" target="_blank" rel="noopener noreferrer"><PlatformIcon platform="github" />GitHub ↗</a></span>
          <span className="footer-legal-links"><b>文档</b><span>
            {LEGAL_DOCS.filter((doc) => doc.mirror).map((doc, index) => (
              <span key={doc.href}>
                {index > 0 && <i aria-hidden="true"> · </i>}
                <a href={doc.mirror} target="_blank" rel="noopener noreferrer">{doc.label.replace(/[《》]/g, '')}（腾讯文档）</a>
              </span>
            ))}
            {LEGAL_DOCS.some((doc) => doc.mirror) && <i aria-hidden="true"> · </i>}
            <a href="https://community.yanyn.cn/legal/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a>
          </span></span>
        </div>
      </div>
    </footer>
  );
}
