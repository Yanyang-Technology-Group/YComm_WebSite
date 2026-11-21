'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { applyGlass, DEFAULT_GLASS, GLASS_EVENT, GLASS_KEY, readActiveGlass, readGlass } from '../lib/glass-preference';
import { useUiStyle } from '../lib/use-ui-style';

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

export function LiquidGlassEffects() {
  const style = useUiStyle();
  const settings = useGlassPreference();
  if (style !== 'apple' || !settings.enabled) return null;
  return <Suspense fallback={null}><RefractionFilter /></Suspense>;
}
