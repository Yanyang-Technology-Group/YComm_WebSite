'use client';

import { useEffect, useState } from 'react';
import { IosToggle, SettingRow, SettingsGroup, Slider } from '@extrastu/nuphy-ui';
import { KubeFilter, kubePropsFromLiquidGlass, supportsKubeBackdropFilter } from '../vendor/liquid-glass/kube';
import { applyGlass, DEFAULT_GLASS, GLASS_EVENT, GLASS_KEY, readActiveGlass, readGlass } from '../lib/glass-preference';
import { useUiStyle } from '../lib/use-ui-style';

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
  return <SettingsGroup className="apple-glass-settings">
    <SettingRow title="液态玻璃" control={<IosToggle label="液态玻璃" checked={settings.enabled}
      onCheckedChange={(enabled) => applyGlass({ ...settings, enabled })} />} />
    <SettingRow title="玻璃透明度" control={<Slider className="apple-glass-slider" label="玻璃透明度" min={10} max={90} step={1}
      value={settings.transparency} disabled={!settings.enabled} showValue unit="%"
      onValueChange={(transparency) => applyGlass({ ...settings, transparency })} />} />
  </SettingsGroup>;
}

export function LiquidGlassEffects() {
  const style = useUiStyle();
  const settings = useGlassPreference();
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const available = supportsKubeBackdropFilter();
    setSupported(available);
    document.documentElement.dataset.glassRefraction = available ? 'supported' : 'fallback';
  }, []);
  if (style !== 'apple' || !settings.enabled || !supported) return null;
  return <KubeFilter id="ycomm-liquid-glass" liteId="ycomm-liquid-glass-lite" width={1} height={1} normalized
    {...kubePropsFromLiquidGlass({ profile: 'convex-circle', bezel: 9, refraction: 45, thickness: 90,
      lightAngle: -150, specularOpacity: 10, blur: 10 })} />;
}
