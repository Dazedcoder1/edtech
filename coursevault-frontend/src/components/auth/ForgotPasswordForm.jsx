import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mail, KeyRound, Check } from 'lucide-react';
import Button from '../ui/Button.jsx';
import PasswordInput from '../ui/PasswordInput.jsx';
import { fetchAPI } from '../../services/api.js';

const inputClass =
  'w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-3 font-medium ' +
  'focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D] transition-shadow';

/** Seconds before "Resend code" becomes available again. */
const RESEND_SECONDS = 45;

/**
 * Reset a forgotten password with a code emailed to the account.
 *
 * Three steps in one component rather than three routes: the flow is linear,
 * short-lived, and each step needs the values from the one before. Splitting it
 * across URLs would mean either carrying the code in the address bar — where it
 * lands in history and server logs — or rebuilding the state on every step.
 *
 * @param {() => void} onDone called when the password has been changed, and
 *   when the user backs out. Both return them to the sign-in form.
 */
export default function ForgotPasswordForm({ onDone }) {
  const [step, setStep] = useState('email'); // email | code | password | done
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const codeRef = useRef(null);

  // Count down the resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Focus the code box when it appears, so a phone keyboard opens without a tap.
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const requestCode = async (e) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetchAPI('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setNotice(res?.message || 'If an account with that email exists, a reset code is on its way.');
      setStep('code');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err.message || 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await fetchAPI('/auth/verify-reset-code', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code }),
      });
      setNotice('');
      setStep('password');
    } catch (err) {
      setError(err.message || 'That code is not correct.');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      await fetchAPI('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code, newPassword: password }),
      });
      setStep('done');
    } catch (err) {
      /*
       * A failure here usually means the code expired between verifying it and
       * choosing a password, so send them back to the code step rather than
       * leaving them on a form that cannot succeed.
       */
      setError(err.message || 'Could not reset your password.');
      if (/expired|used|not valid|not correct/i.test(err.message || '')) {
        setCode('');
        setStep('code');
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="text-center py-6">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
          <Check size={26} strokeWidth={3} />
        </div>
        <h2 className="font-black text-xl mb-2">Password changed</h2>
        <p className="text-sm text-gray-600 font-medium mb-6">
          You can sign in with your new password now.
        </p>
        <Button type="button" variant="primary" className="w-full" onClick={onDone}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="text-left">
      <button
        type="button"
        onClick={onDone}
        className="flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-black mb-4"
      >
        <ArrowLeft size={16} strokeWidth={3} /> Back to sign in
      </button>

      {error && (
        <div className="p-3 mb-4 bg-red-100 border-2 border-red-500 text-red-700 font-bold rounded-xl text-sm">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="p-3 mb-4 bg-[#F9E076] border-2 border-black font-bold rounded-xl text-sm">
          {notice}
        </div>
      )}

      {/* ---------------------------------------------------------- step 1 */}
      {step === 'email' && (
        <form onSubmit={requestCode} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-1">
            <Mail size={18} strokeWidth={3} />
            <h2 className="font-black text-lg">Forgot your password?</h2>
          </div>

          <p className="text-sm text-gray-600 font-medium">
            Enter the email address on your account and we'll send you a 6-digit code.
          </p>

          <div>
            <label className="font-bold text-sm ml-2 mb-1 block">Email Address</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          {/*
            Stated up front, not after a failed attempt.
            Email is optional at signup, so a student who registered with only a
            mobile number has no address for this to reach — and the endpoint
            deliberately gives the same answer for "no such account" as for a
            real one, so nothing later in the flow can tell them why no code
            arrived. This paragraph is the only place they can find out.
          */}
          <p className="text-xs text-gray-500 leading-relaxed">
            Signed up with only a mobile number? There's no email on your account,
            so this won't reach you — ask your teacher to reset it, or use the
            help desk once you're signed in.
          </p>

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Sending...' : 'Send code'}
          </Button>
        </form>
      )}

      {/* ---------------------------------------------------------- step 2 */}
      {step === 'code' && (
        <form onSubmit={verifyCode} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={18} strokeWidth={3} />
            <h2 className="font-black text-lg">Enter your code</h2>
          </div>

          <p className="text-sm text-gray-600 font-medium">
            We sent a 6-digit code to <strong className="break-all">{email}</strong>.
            It expires in 15 minutes.
          </p>

          <div>
            <label className="font-bold text-sm ml-2 mb-1 block">6-digit code</label>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              // Six characters exactly; pasting a code with spaces still works
              // because non-digits are stripped on the way in.
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${inputClass} text-center text-2xl tracking-[0.5em] font-black`}
              placeholder="000000"
              autoComplete="one-time-code"
            />
          </div>

          <Button type="submit" variant="primary" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? 'Checking...' : 'Verify code'}
          </Button>

          <button
            type="button"
            onClick={requestCode}
            disabled={busy || cooldown > 0}
            className="text-sm font-bold underline underline-offset-2 disabled:no-underline disabled:text-gray-400"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        </form>
      )}

      {/* ---------------------------------------------------------- step 3 */}
      {step === 'password' && (
        <form onSubmit={submitPassword} className="flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={18} strokeWidth={3} />
            <h2 className="font-black text-lg">Choose a new password</h2>
          </div>

          <div>
            <label className="font-bold text-sm ml-2 mb-1 block">New password</label>
            <PasswordInput
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
              placeholder="••••••••"
            />
            <p className="text-xs text-gray-500 mt-1 ml-2">At least 8 characters.</p>
          </div>

          <div>
            <label className="font-bold text-sm ml-2 mb-1 block">Confirm new password</label>
            <PasswordInput
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
              placeholder="••••••••"
            />
            {confirm && password !== confirm && (
              <p className="text-xs font-bold text-red-600 mt-1 ml-2">Passwords do not match.</p>
            )}
          </div>

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Saving...' : 'Change password'}
          </Button>
        </form>
      )}
    </div>
  );
}
