export interface GlassPreference { enabled: boolean; transparency: number }
export const GLASS_KEY = 'ycomm_apple_glass';
export const GLASS_EVENT = 'ycomm:glass-change';
export const DEFAULT_GLASS: GlassPreference = { enabled: true, transparency: 65 };

export function normalizeGlass(value: unknown): GlassPreference {
  const saved = value && typeof value === 'object' ? value as Partial<GlassPreference> : {};
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_GLASS.enabled,
    transparency: typeof saved.transparency === 'number' && Number.isFinite(saved.transparency)
      ? Math.round(Math.min(90, Math.max(10, saved.transparency))) : DEFAULT_GLASS.transparency,
  };
}

export function readGlass(): GlassPreference {
  try { return normalizeGlass(JSON.parse(localStorage.getItem(GLASS_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_GLASS }; }
}

export function readActiveGlass(): GlassPreference {
  const root = document.documentElement;
  if (root.dataset.appleGlass !== 'on' && root.dataset.appleGlass !== 'off') return readGlass();
  return normalizeGlass({
    enabled: root.dataset.appleGlass === 'on',
    transparency: Number.parseFloat(root.style.getPropertyValue('--apple-glass-transparency')),
  });
}

export function applyGlass(value: GlassPreference): void {
  const settings = normalizeGlass(value);
  const root = document.documentElement;
  root.dataset.appleGlass = settings.enabled ? 'on' : 'off';
  root.style.setProperty('--apple-glass-transparency', `${settings.transparency}%`);
  try { localStorage.setItem(GLASS_KEY, JSON.stringify(settings)); } catch { /* Session-only preference. */ }
  window.dispatchEvent(new Event(GLASS_EVENT));
}

export const GLASS_BOOT_SCRIPT = `(function(){var r=document.documentElement,s={enabled:true,transparency:65};try{var p=JSON.parse(localStorage.getItem('${GLASS_KEY}')||'null');if(p){if(typeof p.enabled==='boolean')s.enabled=p.enabled;if(typeof p.transparency==='number'&&isFinite(p.transparency))s.transparency=Math.round(Math.min(90,Math.max(10,p.transparency)));}}catch(e){}r.dataset.appleGlass=s.enabled?'on':'off';r.style.setProperty('--apple-glass-transparency',s.transparency+'%');})();`;
