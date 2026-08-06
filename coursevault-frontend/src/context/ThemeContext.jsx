import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { fetchAPI } from '../services/api.js';

const ThemeContext = createContext();

/*
 * Must match the seed in server.js and the fallbacks in routes/settings.js.
 *
 * This is what paints the very first frame, before the settings request
 * returns. If it disagrees with the server the site visibly flips style on
 * load, which reads as a bug even though both values are 'correct'.
 */
const DEFAULTS = { theme: 'eduverse', mode: 'light', density: 'comfortable', style: 'soft' };

/**
 * Remembered locally as well as on the server.
 *
 * The settings are platform-wide and the server is authoritative, but fetching
 * them takes a round trip — and during that trip the app would paint in the
 * default palette and then jump. Applying the last known values immediately
 * removes the flash; the fetch corrects them a moment later if a teacher has
 * changed something since.
 */
const CACHE_KEY = 'appearance';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    // Corrupt or unavailable storage must not stop the app rendering.
    return DEFAULTS;
  }
}

/**
 * Write the settings onto <html> where the CSS can see them.
 *
 * Attributes on the document element rather than a wrapper div: the theme has
 * to reach things rendered outside the React tree — the body background, and
 * anything portalled — and a wrapper cannot style its own ancestors.
 */
function apply({ theme, mode, density, style }) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', mode);
  root.setAttribute('data-density', density);
  root.setAttribute('data-style', style);
}

export function ThemeProvider({ children }) {
  const [settings, setSettings] = useState(readCache);
  const [options, setOptions] = useState(null);
  const [saving, setSaving] = useState(false);

  // Before first paint, from cache. useLayoutEffect would be marginally
  // earlier but warns during SSR; this runs early enough that no frame is
  // rendered with the wrong palette in practice.
  useEffect(() => {
    apply(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchAPI('/settings/appearance');
        if (cancelled) return;

        const next = {
          theme: data.theme || DEFAULTS.theme,
          mode: data.mode || DEFAULTS.mode,
          density: data.density || DEFAULTS.density,
          style: data.style || DEFAULTS.style,
        };
        setSettings(next);
        setOptions(data.options || null);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      } catch {
        // Keep whatever is on screen. A settings endpoint that is briefly
        // unreachable should not repaint the whole app.
      } finally {
        if (!cancelled) {
          /*
           * Transitions are enabled only now. Before this the app has just
           * painted for the first time, and animating from the default palette
           * to the saved one on every page load reads as a glitch.
           */
          document.documentElement.classList.add('skin-ready');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /**
   * Save a change. Applied locally first so the picker feels immediate, then
   * reverted if the server refuses — which it will for a student.
   */
  const update = useCallback(async (patch) => {
    const previous = settings;
    const next = { ...settings, ...patch };

    setSettings(next);
    setSaving(true);
    try {
      const data = await fetchAPI('/settings/appearance', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      const confirmed = {
        theme: data.theme, mode: data.mode,
        density: data.density, style: data.style,
      };
      setSettings(confirmed);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(confirmed)); } catch { /* ignore */ }
      return { ok: true };
    } catch (err) {
      setSettings(previous);
      return { ok: false, error: err.message || 'Could not save.' };
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return (
    <ThemeContext.Provider value={{ ...settings, options, saving, update }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
