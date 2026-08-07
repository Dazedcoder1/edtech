import { useEffect, useRef, useState } from 'react';
import {
  Palette, Check, X, Sun, Moon, RotateCcw, Loader, Info, Globe, Rows3, Rows4,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';

/*
 * Swatches are hardcoded rather than read from the live variables.
 *
 * A preview drawn with the *current* theme's variables would show seven
 * identical chips — the point is to show what each option looks like before it
 * is applied. These mirror the palettes in globals.css and must move with them.
 */
const THEMES = [
  { id: 'default', label: 'Sharda', swatch: ['#C0451F', '#F9E076', '#A7E2D1'] },
  { id: 'eduverse', label: 'Eduverse', swatch: ['#4F46E5', '#8B5CF6', '#F97316'], style: 'soft' },
  { id: 'ocean', label: 'Ocean', swatch: ['#2563EB', '#38BDF8', '#A5F3FC'] },
  { id: 'lagoon', label: 'Lagoon', swatch: ['#005F73', '#0A9396', '#EE9B00'] },
  { id: 'forest', label: 'Forest', swatch: ['#15803D', '#84CC16', '#BBF7D0'] },
  { id: 'sunset', label: 'Sunset', swatch: ['#DB2777', '#FB923C', '#FDE68A'] },
  { id: 'mono', label: 'Mono', swatch: ['#111111', '#686F7D', '#E5E7EB'] },
];

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
        padding: 8, display: 'flex', gap: 7, alignItems: 'center',
      }}
    >
      <div style={{
        width: 24, height: 24, flexShrink: 0, background: '#C0451F',
        border: brutal ? '2px solid #111111' : 'none',
        borderRadius: brutal ? 7 : 999,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          height: 6, width: '70%', background: '#111111',
          opacity: brutal ? 1 : 0.75, borderRadius: 999, marginBottom: 4,
        }} />
        <div style={{ height: 4, width: '45%', background: '#8E949F', borderRadius: 999 }} />
      </div>
    </div>
  );
}

/**
 * An appearance picker, behind a button.
 *
 * One component serves both scopes because the controls are the same and two
 * near-identical modals would drift — a palette added to one and forgotten in
 * the other is invisible until a teacher asks why students have a colour they
 * do not.
 *
 *   scope="personal"  changes the site for this user only. Everyone has it.
 *   scope="platform"  changes the default for everyone. Educators only, and
 *                     the server enforces that regardless of what is rendered.
 *
 * Behind a button rather than inline because appearance is set once and then
 * forgotten; a permanently open grid of colour chips would outweigh the
 * profile content it sits beside.
 */
export default function AppearanceButton({ scope = 'personal' }) {
  const [open, setOpen] = useState(false);
  const platformScope = scope === 'platform';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full sm:w-auto flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-black
                   bg-white font-bold text-sm shadow-[3px_3px_0px_0px_#111] transition-all
                   hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111]"
      >
        {platformScope ? <Globe size={16} strokeWidth={2.5} /> : <Palette size={16} strokeWidth={2.5} />}
        {platformScope ? 'Set for everyone' : 'Change colours'}
        {/*
          A live preview of the palette in force, so the button says what it
          controls without having to be opened. These pick up the theme
          override rules deliberately — unlike the swatches inside, which must
          keep their own colours.
        */}
        <span className="flex gap-1 ml-auto" aria-hidden="true">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-black bg-[#F26B4D]" />
          <span className="w-3.5 h-3.5 rounded-full border-2 border-black bg-[#F9E076]" />
          <span className="w-3.5 h-3.5 rounded-full border-2 border-black bg-[#A7E2D1]" />
        </span>
      </button>

      {open && <AppearanceDialog scope={scope} onClose={() => setOpen(false)} />}
    </>
  );
}

function AppearanceDialog({ scope, onClose }) {
  const ctx = useTheme();
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  const platformScope = scope === 'platform';

  /*
   * Which values the ticks follow.
   *
   * The platform panel reads the platform layer, never the resolved one. A
   * teacher with a personal override of Mono over a school set to Eduverse
   * must see Eduverse ticked here — showing their own choice would tell them
   * the school is set to something it is not, and the next thing they do is
   * "fix" it for everybody.
   */
  const current = platformScope
    ? { ...ctx.platform }
    : { theme: ctx.theme, mode: ctx.mode, density: ctx.density, style: ctx.style };

  const save = platformScope ? ctx.update : ctx.updateMine;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the dialog so the next Tab lands inside it rather than
  // continuing through the page behind.
  useEffect(() => { panelRef.current?.focus(); }, []);

  const change = async (patch) => {
    setError('');
    const res = await save(patch);
    if (!res.ok) setError(res.error);
  };

  const { mine, saving } = ctx;
  const usingOwn = Boolean(mine && (mine.theme || mine.mode || mine.density || mine.style));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60"
      // Clicking the backdrop closes; clicks inside the panel must not, hence
      // the stopPropagation below rather than a check on the target.
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={platformScope ? 'Platform appearance' : 'Your appearance'}
        onClick={(e) => e.stopPropagation()}
        // Slides up from the bottom on a phone, centred from sm up. A centred
        // modal on a small screen leaves the controls out of thumb reach.
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white
                   border-2 border-black rounded-t-2xl sm:rounded-2xl
                   shadow-[6px_6px_0px_0px_#111] outline-none"
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 bg-white border-b-2 border-black">
          <h2 className="flex items-center gap-2 font-black text-base uppercase">
            {platformScope ? <Globe size={17} strokeWidth={3} /> : <Palette size={17} strokeWidth={3} />}
            {platformScope ? 'Platform appearance' : 'Your appearance'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full border-2 border-black bg-[#F26B4D] text-white flex items-center justify-center"
          >
            <X size={15} strokeWidth={3} />
          </button>
        </div>

        <div className="p-4">
          {/*
            The scope, stated before any control. A picker that quietly repaints
            the site for several hundred students should not look like a
            personal preference.
          */}
          <p
            className={`flex items-start gap-1.5 text-xs font-bold mb-4 ${
              platformScope ? 'text-black' : 'text-gray-500'
            }`}
          >
            {platformScope ? (
              <Globe size={13} strokeWidth={3} className="shrink-0 mt-0.5" />
            ) : (
              <Info size={13} strokeWidth={3} className="shrink-0 mt-0.5" />
            )}
            {platformScope
              ? 'This changes how the platform looks for everyone, students included.'
              : 'This changes how the site looks for you only.'}
          </p>

          {error && (
            <div className="p-3 mb-4 border-2 border-red-500 bg-red-50 rounded-xl font-bold text-red-700 text-sm">
              {error}
            </div>
          )}

          <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Colour</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
            {THEMES.map((t) => {
              const active = current.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  // Eduverse was designed for the rounded style, so choosing it
                  // sets both axes at once rather than leaving the reader to
                  // discover the second half.
                  onClick={() => change(t.style ? { theme: t.id, style: t.style } : { theme: t.id })}
                  disabled={saving}
                  aria-pressed={active}
                  className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 border-black transition-all disabled:opacity-60 ${
                    active ? 'bg-white shadow-[3px_3px_0px_0px_#111]' : 'bg-white/60'
                  }`}
                >
                  <span className="flex gap-1" aria-hidden="true">
                    {t.swatch.map((c) => (
                      <span
                        key={c}
                        className="w-4 h-4 rounded-full border-2 border-black"
                        // Inline, so the chips keep their own colours instead
                        // of being remapped by the theme override rules.
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                  <span className="font-bold text-[11px] leading-none">{t.label}</span>
                  {active && (
                    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
                      <Check size={11} strokeWidth={4} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Style</h3>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {[
              { id: 'brutal', label: 'Bold' },
              { id: 'soft', label: 'Soft' },
            ].map((s) => {
              const active = current.style === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => change({ style: s.id })}
                  disabled={saving}
                  aria-pressed={active}
                  className={`relative text-left p-2.5 rounded-xl border-2 transition-all disabled:opacity-60 ${
                    active ? 'border-black bg-white shadow-[3px_3px_0px_0px_#111]' : 'border-black/20 bg-white/60'
                  }`}
                >
                  <div className="mb-1.5"><StylePreview variant={s.id} /></div>
                  <div className="font-bold text-xs">{s.label}</div>
                  {active && (
                    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
                      <Check size={11} strokeWidth={4} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Mode</h3>
          <div className="flex gap-2 mb-5">
            <Choice active={current.mode === 'light'} disabled={saving} onClick={() => change({ mode: 'light' })} icon={Sun} label="Light" />
            <Choice active={current.mode === 'dark'} disabled={saving} onClick={() => change({ mode: 'dark' })} icon={Moon} label="Dark" />
          </div>

          <h3 className="font-black text-xs uppercase text-gray-500 mb-2">Spacing</h3>
          <div className="flex gap-2 mb-5">
            <Choice active={current.density === 'comfortable'} disabled={saving} onClick={() => change({ density: 'comfortable' })} icon={Rows3} label="Comfortable" />
            <Choice active={current.density === 'compact'} disabled={saving} onClick={() => change({ density: 'compact' })} icon={Rows4} label="Compact" />
          </div>

          {/*
            Personal scope only, and only once there is something to undo.
            A reset button that resets nothing invites the reader to wonder
            what it did; and there is nothing to reset the platform *to*.
          */}
          {!platformScope && usingOwn && (
            <button
              type="button"
              onClick={async () => { setError(''); const r = await ctx.resetMine(); if (!r.ok) setError(r.error); }}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-black bg-white font-bold text-sm disabled:opacity-60"
            >
              <RotateCcw size={14} strokeWidth={3} />
              Use my school's theme
            </button>
          )}

          {/*
            Shown to a teacher whose own override is masking what they just
            set. Without it, changing the platform theme appears to do nothing
            — the most confusing possible outcome for the person with the most
            reason to trust the control.
          */}
          {platformScope && usingOwn && (
            <p className="flex items-start gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border-2 border-amber-400 rounded-lg px-2 py-1.5">
              <Info size={13} strokeWidth={3} className="shrink-0 mt-0.5" />
              You have your own colours set, so this will not change what you
              see — only what everyone else sees.
            </p>
          )}

          {saving && (
            <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-gray-500 mt-3">
              <Loader size={12} className="animate-spin" /> Saving...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Choice({ active, disabled, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border-2 border-black font-bold text-xs sm:text-sm transition-all disabled:opacity-60 ${
        active ? 'bg-[#F9E076] shadow-[3px_3px_0px_0px_#111]' : 'bg-white'
      }`}
    >
      {Icon && <Icon size={15} strokeWidth={2.5} className="shrink-0" />}
      <span className="truncate">{label}</span>
      {active && <Check size={13} strokeWidth={4} className="shrink-0" />}
    </button>
  );
}
