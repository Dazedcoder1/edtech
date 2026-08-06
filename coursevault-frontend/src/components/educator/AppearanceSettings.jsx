import React, { useState } from 'react';
import { Palette, Sun, Moon, Rows3, Rows4, Check, Loader, Globe } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';

/*
 * Swatches are hardcoded rather than read from the live variables.
 *
 * A preview that rendered with the *current* theme's variables would show five
 * identical chips — the whole point is to show what each option looks like
 * before it is applied. These mirror the palettes in globals.css and must be
 * updated alongside them.
 */
const THEMES = [
  { id: 'default',  label: 'Sharda',   swatch: ['#C0451F', '#F9E076', '#A7E2D1'] },
  /*
   * Eduverse carries a style with it.
   *
   * The palette was designed for the rounded, soft-shadowed look — indigo on
   * near-white cards over a faint lavender page. Applied to thick black
   * outlines it reads as a different, worse design, so choosing it sets both
   * axes at once rather than leaving the teacher to discover the second half.
   */
  { id: 'eduverse', label: 'Eduverse', swatch: ['#4F46E5', '#8B5CF6', '#F97316'], style: 'soft' },
  { id: 'ocean',    label: 'Ocean',    swatch: ['#2563EB', '#38BDF8', '#A5F3FC'] },
  { id: 'lagoon',   label: 'Lagoon',   swatch: ['#005F73', '#0A9396', '#EE9B00'] },
  { id: 'forest',   label: 'Forest',   swatch: ['#15803D', '#84CC16', '#BBF7D0'] },
  { id: 'sunset',   label: 'Sunset',   swatch: ['#DB2777', '#FB923C', '#FDE68A'] },
  { id: 'mono',     label: 'Mono',     swatch: ['#111111', '#6B7280', '#E5E7EB'] },
];

/**
 * Platform appearance, for educators.
 *
 * This is not a personal preference — the choice applies to every student too,
 * and the panel says so plainly. A control that quietly changes what hundreds
 * of other people see should not look like a private toggle.
 */
/**
 * A miniature card drawn in each style.
 *
 * Inline styles, not classes: these previews must render in the style being
 * offered, not the one currently applied — a preview subject to the global
 * overrides would show two identical cards and tell the reader nothing.
 */
function StylePreview({ variant }) {
  const brutal = variant === 'brutal';
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: brutal ? '2px solid #111111' : '1px solid rgba(16,24,40,0.08)',
        borderRadius: brutal ? 10 : 16,
        boxShadow: brutal
          ? '3px 3px 0px 0px #111111'
          : '0 4px 8px -2px rgba(16,24,40,0.10), 0 2px 4px -2px rgba(16,24,40,0.06)',
        padding: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 28, height: 28, flexShrink: 0,
          background: '#C0451F',
          border: brutal ? '2px solid #111111' : 'none',
          borderRadius: brutal ? 8 : 999,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          height: 7, width: '70%', background: '#111111',
          opacity: brutal ? 1 : 0.75,
          borderRadius: 999, marginBottom: 5,
        }} />
        <div style={{ height: 5, width: '45%', background: '#8E949F', borderRadius: 999 }} />
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const { theme, mode, density, style, saving, update } = useTheme();
  const [error, setError] = useState('');

  const change = async (patch) => {
    setError('');
    const res = await update(patch);
    if (!res.ok) setError(res.error);
  };

  return (
    <section className="border-[3px] border-black rounded-2xl bg-white p-4 md:p-6 shadow-[6px_6px_0px_0px_#111]">
      <div className="flex items-center gap-2 mb-1">
        <Palette size={20} strokeWidth={3} />
        <h2 className="font-black text-lg md:text-xl uppercase">Appearance</h2>
      </div>

      <p className="flex items-start gap-1.5 text-xs font-bold text-gray-600 mb-5">
        <Globe size={13} strokeWidth={3} className="shrink-0 mt-0.5" />
        This changes how the platform looks for everyone, students included.
      </p>

      {error && (
        <div className="p-3 mb-4 border-2 border-red-500 bg-red-50 rounded-xl font-bold text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------------ style

          First, because it is the largest change on the page — the palette
          options read very differently depending on which language they are
          drawn in.                                                          */}
      <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Style</h3>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { id: 'brutal', label: 'Bold', sub: 'Thick outlines, hard shadows' },
          { id: 'soft', label: 'Soft', sub: 'Rounded, gentle shadows' },
        ].map((s) => {
          const active = style === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => change({ style: s.id })}
              disabled={saving}
              aria-pressed={active}
              className={`relative text-left p-3 rounded-xl border-2 transition-all disabled:opacity-60 ${
                active ? 'border-black bg-white shadow-[3px_3px_0px_0px_#111]' : 'border-black/20 bg-white/60'
              }`}
            >
              <div className="mb-2">
                <StylePreview variant={s.id} />
              </div>
              <div className="font-bold text-sm">{s.label}</div>
              <div className="text-[10px] font-bold text-gray-500 leading-tight">{s.sub}</div>

              {active && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
                  <Check size={11} strokeWidth={4} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- palette */}
      <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Colour theme</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-6">
        {THEMES.map((t) => {
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              // A theme that declares a style applies both in one request, so
              // there is no intermediate state where half the look is applied.
              onClick={() => change(t.style ? { theme: t.id, style: t.style } : { theme: t.id })}
              disabled={saving}
              aria-pressed={active}
              className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-black transition-all disabled:opacity-60 ${
                active
                  ? 'bg-white shadow-[3px_3px_0px_0px_#111]'
                  : 'bg-white/60 hover:shadow-[2px_2px_0px_0px_#111]'
              }`}
            >
              <span className="flex gap-1">
                {t.swatch.map((c) => (
                  <span
                    key={c}
                    className="w-5 h-5 rounded-full border-2 border-black"
                    // Inline, so these chips keep their own colours instead of
                    // being remapped by the theme override rules.
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <span className="font-bold text-xs">{t.label}</span>

              {active && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
                  <Check size={11} strokeWidth={4} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------- mode */}
      <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Mode</h3>
      <div className="flex gap-2 mb-6">
        <Choice
          active={mode === 'light'}
          disabled={saving}
          onClick={() => change({ mode: 'light' })}
          icon={Sun}
          label="Light"
        />
        <Choice
          active={mode === 'dark'}
          disabled={saving}
          onClick={() => change({ mode: 'dark' })}
          icon={Moon}
          label="Dark"
        />
      </div>

      {/* ---------------------------------------------------------- density */}
      <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Spacing</h3>
      <div className="flex gap-2">
        <Choice
          active={density === 'comfortable'}
          disabled={saving}
          onClick={() => change({ density: 'comfortable' })}
          icon={Rows3}
          label="Comfortable"
        />
        <Choice
          active={density === 'compact'}
          disabled={saving}
          onClick={() => change({ density: 'compact' })}
          icon={Rows4}
          label="Compact"
          sub="Fits more on screen"
        />
      </div>

      {saving && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-gray-500 mt-4">
          <Loader size={12} className="animate-spin" /> Saving...
        </p>
      )}
    </section>
  );
}

function Choice({ active, disabled, onClick, icon: Icon, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-black font-bold text-sm transition-all disabled:opacity-60 ${
        active
          ? 'bg-[#F9E076] shadow-[3px_3px_0px_0px_#111]'
          : 'bg-white hover:shadow-[2px_2px_0px_0px_#111]'
      }`}
    >
      <Icon size={16} strokeWidth={2.5} className="shrink-0" />
      <span className="text-left leading-tight">
        {label}
        {sub && <span className="block text-[10px] font-bold text-gray-500">{sub}</span>}
      </span>
      {active && <Check size={14} strokeWidth={4} className="ml-auto shrink-0" />}
    </button>
  );
}
