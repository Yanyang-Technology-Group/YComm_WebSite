'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_UI_STYLE, normalizeUiStyle, UI_STYLE_CHANGE_EVENT, type UiStyle } from './appearance';

export function useUiStyle(): UiStyle {
  const [style, setStyle] = useState<UiStyle>(DEFAULT_UI_STYLE);
  useEffect(() => {
    const sync = () => setStyle(normalizeUiStyle(document.documentElement.dataset.uiStyle));
    sync();
    window.addEventListener(UI_STYLE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(UI_STYLE_CHANGE_EVENT, sync);
  }, []);
  return style;
}
