'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { IosToggle, SettingRow, SettingsGroup, Slider } from '@extrastu/nuphy-ui';
import { applyGlass, DEFAULT_GLASS, GLASS_EVENT, GLASS_KEY, readActiveGlass, readGlass } from '../lib/glass-preference';
import { useUiStyle } from '../lib/use-ui-style';
import { showToast } from '../lib/toast';
import type { GlassPreference } from '../lib/glass-preference';

const RefractionFilter = lazy(() => import('./liquid-glass-filter'));

function useGlassPreference() {
  const [settings, setSettings] = useState(DEFAULT_GLASS);
  useEffect(() => {
    const sync = () => setSettings(readActiveGlass());
    const storage = (event: StorageEvent) => {
      if (event.key === GLASS_KEY || event.key === null) applyGlass(readGlass());
    };
    sync();
    window.addEventListener(GLASS_EVENT, sync);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(GLASS_EVENT, sync);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return settings;
}

export function GlassSettings() {
  const settings = useGlassPreference();
  function save(next: GlassPreference) {
    applyGlass(next);
    try {
      if (localStorage.getItem(GLASS_KEY) === JSON.stringify(next)) showToast('玻璃设置保存成功');
    } catch { /* The current page still uses the selected settings. */ }
  }
  return <div className="apple-glass-preferences">
    <div className="glass-material-preview" aria-hidden="true">
      <div className="glass-preview-content"><img src="/logo.png" alt="" /><strong>晏阳社区</strong><span>论坛</span><span>下载区</span></div>
      <div className="glass-preview-pane"><img src="/logo.png" alt="" /><span>晏阳社区<small>论坛 · 下载区</small></span></div>
    </div>
    <SettingsGroup className="apple-glass-settings">
    <SettingRow title="液态玻璃" control={<IosToggle label="液态玻璃" checked={settings.enabled}
      onCheckedChange={(enabled) => save({ ...settings, enabled })} />} />
    <SettingRow title="玻璃透明度" control={<Slider className="apple-glass-slider" label="玻璃透明度" min={10} max={90} step={1}
      value={settings.transparency} disabled={!settings.enabled} showValue unit="%"
      onValueChange={(transparency) => save({ ...settings, transparency })} />} />
    </SettingsGroup>
  </div>;
}

export function LiquidGlassEffects() {
  const style = useUiStyle();
  const settings = useGlassPreference();
  if (style !== 'apple' || !settings.enabled) return null;
  return <Suspense fallback={null}><RefractionFilter /></Suspense>;
}
