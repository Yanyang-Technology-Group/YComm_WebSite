'use client';

import { useEffect } from 'react';
import { getSession } from '../lib/session';
import { applyUiStyle, readStoredUiStyle, UI_STYLE_KEY } from '../lib/appearance';
import { applyTheme, readStoredTheme } from '../lib/theme-preference';

export function ThemeSync() {
  useEffect(() => {
    function syncStyle() {
      applyUiStyle(readStoredUiStyle());
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== UI_STYLE_KEY && event.key !== null) return;
      applyUiStyle(readStoredUiStyle(), { animate: true });
    }
    syncStyle();
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const stored = readStoredTheme();
    applyTheme(stored.colour, stored.mode);

    let active = true;
    void getSession().then((session) => {
      if (!active || !session) return;
      const colour = session.themeColour === 'slate' ? 'none' : session.themeColour;
      const validColour = colour === 'none' || ['azure', 'red', 'pink', 'mint', 'orange'].includes(colour ?? '');
      const mode = session.themeMode;
      applyTheme(
        validColour ? (colour as typeof stored.colour) : 'azure',
        mode === 'dark' || mode === 'light' || mode === 'auto' ? mode : 'auto',
      );
    });
    return () => {
      active = false;
    };
  }, []);

  return null;
}
