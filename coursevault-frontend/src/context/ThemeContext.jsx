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
 * The platform default with the user's own choices laid over it.
 *
 * Null and undefined both mean "no opinion, follow the school", so they must
 * not overwrite. A plain spread would: `{...platform, ...mine}` copies
 * mine.theme even when it is null, which would blank the theme rather than
 * inherit it — the site would render unstyled and nothing would say why.
 */
function resolve(platform, mine) {
  const out = { ...DEFAULTS, ...platform };
  for (const k of ['theme', 'mode', 'density', 'style']) {
    if (mine?.[k] != null) out[k] = mine[k];
  }
  return out;
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
  /*
   * Two layers, held separately rather than merged into one piece of state.
   *
   * Flattening them would lose the distinction between "the school uses
   * Eduverse" and "I chose Eduverse", and the reset button needs exactly that
   * distinction to know what to fall back to.
   */
  const [platform, setPlatform] = useState(readCache);
  const [mine, setMine] = useState(null);
  const [options, setOptions] = useState(null);
  const [saving, setSaving] = useState(false);

  const settings = resolve(platform, mine);

  // Before first paint, from cache. useLayoutEffect would be marginally
  // earlier but warns during SSR; this runs early enough that no frame is
  // rendered with the wrong palette in practice.
  /*
   * Destructured so the effect depends on four strings rather than an object.
   *
   * `settings` is rebuilt on every render, so depending on it directly would
   * rewrite the four attributes on <html> after every state change anywhere in
   * the app.
   */
  const { theme, mode, density, style } = settings;
  useEffect(() => {
    apply({ theme, mode, density, style });
  }, [theme, mode, density, style]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        /*
         * Both at once. The personal one needs a token and the platform one
         * does not, so allSettled rather than all: a signed-out visitor on the
         * login page must still get the school's palette even though
         * /settings/me will fail for them.
         */
        const [platformRes, mineRes] = await Promise.allSettled([
          fetchAPI('/settings/appearance'),
          fetchAPI('/settings/me'),
        ]);
        if (cancelled) return;

        if (platformRes.status === 'fulfilled') {
          const data = platformRes.value;
          const next = {
            theme: data.theme || DEFAULTS.theme,
            mode: data.mode || DEFAULTS.mode,
            density: data.density || DEFAULTS.density,
            style: data.style || DEFAULTS.style,
          };
          setPlatform(next);
          setOptions(data.options || null);
          // Only the platform layer is cached. A personal override is cheap to
          // refetch and caching it would leak one account's palette onto the
          // next person to sign in on a shared phone.
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        }

        if (mineRes.status === 'fulfilled') {
          const m = mineRes.value;
          setMine({ theme: m.theme, mode: m.mode, density: m.density, style: m.style });
        }
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
    const previous = platform;
    setPlatform({ ...platform, ...patch });
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
      setPlatform(confirmed);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(confirmed)); } catch { /* ignore */ }
      return { ok: true };
    } catch (err) {
      setPlatform(previous);
      return { ok: false, error: err.message || 'Could not save.' };
    } finally {
      setSaving(false);
    }
  }, [platform]);

  /**
   * Change how the site looks for this user only.
   *
   * Pass null on a field to clear it and go back to following the school.
   * Available to everyone — a student changing their own palette affects
   * nobody else, which is exactly why this is a different call from `update`.
   */
  const updateMine = useCallback(async (patch) => {
    const previous = mine;
    setMine({ ...mine, ...patch });
    setSaving(true);
    try {
      const data = await fetchAPI('/settings/me', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setMine({ theme: data.theme, mode: data.mode, density: data.density, style: data.style });
      return { ok: true };
    } catch (err) {
      setMine(previous);
      return { ok: false, error: err.message || 'Could not save.' };
    } finally {
      setSaving(false);
    }
  }, [mine]);

  /** Drop every personal choice and follow the school again. */
  const resetMine = useCallback(
    () => updateMine({ theme: null, mode: null, density: null, style: null }),
    [updateMine]
  );

  return (
    <ThemeContext.Provider
      value={{ ...settings, platform, mine, options, saving, update, updateMine, resetMine }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
