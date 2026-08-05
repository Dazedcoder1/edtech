import React, { useEffect, useRef, useState } from 'react';
import { MailCheck, Loader, ArrowLeft } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { fetchAPI } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Seconds before another code can be requested. */
const RESEND_SECONDS = 45;

/**
 * The mandatory email confirmation step.
 *
 * Shown on the auth card after signup, and after any login by an account whose
 * address is not yet confirmed. There is no way past it: the token held at
 * this point is verify-scoped, so every other endpoint refuses it. The screen
 * is not what enforces the rule — it is what makes the rule navigable.
 */
export default function VerifyEmailStep() {
  const { pendingVerification, completeVerification, cancelVerification } = useAuth();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const email = pendingVerification?.email;

  /*
   * A returning user is completing a sign-in, not confirming an address.
   *
   * Telling someone who registered months ago to "confirm your email" reads as
   * a mistake or a phishing page — the wording has to match why they are
   * actually looking at this screen.
   */
  const isTwoFactor = pendingVerification?.reason === 'two-factor';

  const heading = isTwoFactor ? 'Enter your sign-in code' : 'Confirm your email';
  const blurb = isTwoFactor
    ? 'For your security we send a fresh code every time you sign in.'
    : 'Enter it to finish setting up your account.';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await fetchAPI('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      // Carries a full session token in place of the scoped one, and navigates.
      completeVerification(data);
    } catch (err) {
      setError(err.message || 'That code is not correct.');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setBusy(true);
    try {
      const data = await fetchAPI('/auth/send-verification', { method: 'POST' });
      setNotice(data?.message || `A new code has been sent to ${email}.`);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err.message || 'Could not send another code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-left">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
        <MailCheck size={26} strokeWidth={2.5} />
      </div>

      <h2 className="font-black text-xl text-center mb-1">{heading}</h2>
      <p className="text-sm text-gray-600 font-medium text-center mb-5">
        We sent a 6-digit code to <strong className="break-all">{email}</strong>. {blurb}
      </p>

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

      <form onSubmit={submit} className="flex flex-col gap-4">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={6}
          required
          value={code}
          // Non-digits stripped so a pasted "123 456" still works.
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-black focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D] transition-shadow"
          placeholder="000000"
          autoComplete="one-time-code"
        />

        <Button type="submit" variant="primary" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader size={16} className="animate-spin" /> Checking...
            </span>
          ) : (
            'Confirm and continue'
          )}
        </Button>
      </form>

      <div className="flex items-center justify-between gap-2 mt-4">
        <button
          type="button"
          onClick={cancelVerification}
          className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-black"
        >
          <ArrowLeft size={14} strokeWidth={3} /> Use a different account
        </button>

        <button
          type="button"
          onClick={resend}
          disabled={busy || cooldown > 0}
          className="text-xs font-bold underline underline-offset-2 disabled:no-underline disabled:text-gray-400"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>

      {/*
        Said plainly, because this is the question someone stares at the screen
        wondering. The code is often in spam on the very first message, and
        nothing else on this page would tell them so.
      */}
      <p className="text-xs text-gray-500 mt-4 text-center leading-relaxed">
        No code? Check your spam folder.{' '}
        {isTwoFactor
          ? 'Codes are sent to the address on your account.'
          : 'If the address above is wrong, use a different account and sign up again.'}
      </p>
    </div>
  );
}
