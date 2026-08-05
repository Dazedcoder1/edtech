import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * A password field with a show/hide toggle.
 *
 * Hiding what you type is a defence against someone reading your screen, which
 * is a real risk in a shared room and no risk at all on a personal phone. On a
 * phone keyboard, typing a password you cannot see is where most failed logins
 * come from — so the sensible default is masked, with the choice to reveal.
 *
 * Reveal state is deliberately local and starts masked on every mount: a
 * remembered "always show" setting would defeat the point.
 *
 * All extra props are forwarded, so `required`, `autoComplete`, `placeholder`
 * and the rest behave exactly as they would on a bare <input>. autoComplete in
 * particular must stay the caller's decision — "current-password" and
 * "new-password" are what let a password manager offer the right thing.
 *
 * @param {string} value
 * @param {(e: Event) => void} onChange
 * @param {string} [className] classes for the input itself
 */
export default function PasswordInput({ value, onChange, className = '', ...rest }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        /*
         * pr-12 reserves room for the button. Without it the caret and the
         * tail of a long password slide underneath the icon, which is worse
         * than no toggle at all.
         */
        className={`${className} pr-12`}
      />

      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        /*
         * type="button" is load-bearing: a <button> inside a <form> defaults to
         * type="submit", so without it, tapping the eye would submit the login
         * form with a half-typed password.
         *
         * tabIndex={-1} keeps it out of the tab order — someone tabbing from
         * password to "Sign in" should not land on a reveal button first.
         */
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-500 hover:text-black hover:bg-black/5 transition-colors"
      >
        {visible ? <EyeOff size={18} strokeWidth={2.5} /> : <Eye size={18} strokeWidth={2.5} />}
      </button>
    </div>
  );
}
