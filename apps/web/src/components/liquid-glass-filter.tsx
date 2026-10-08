'use client';

import { useEffect, useState } from 'react';
import { KubeFilter, kubePropsFromLiquidGlass, supportsKubeBackdropFilter } from '../vendor/liquid-glass/kube';

export default function LiquidGlassFilter() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const available = supportsKubeBackdropFilter();
    setSupported(available);
    document.documentElement.dataset.glassRefraction = available ? 'supported' : 'fallback';
    return () => { delete document.documentElement.dataset.glassRefraction; };
  }, []);
  if (!supported) return null;
  return <KubeFilter id="ycomm-liquid-glass" liteId="ycomm-liquid-glass-lite" width={1} height={1} normalized
    {...kubePropsFromLiquidGlass({ profile: 'convex-circle', bezel: 36, refraction: 70, thickness: 90,
      lightAngle: -150, specularOpacity: 28, blur: 18 })} />;
}
