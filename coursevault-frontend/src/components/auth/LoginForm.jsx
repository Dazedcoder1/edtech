import React, { useState } from 'react';
import Button from '../ui/Button';
import PasswordInput from '../ui/PasswordInput';
import { useAuth } from '../../context/AuthContext';

/**
 * @param {() => void} [onForgotPassword] switches the card to the reset flow.
 *   Optional so the form still renders if mounted without it.
 */
export default function LoginForm({ onForgotPassword }) {
  // One field for both identifiers. The server decides which it is by shape —
  // an "@" is unambiguous — so there is nothing for the user to choose.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setError(err.message || 'Failed to login');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-5 text-left" onSubmit={handleSubmit}>
      {error && <div className="p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold rounded-xl text-sm">{error}</div>}
      <div>
        <label className="font-bold text-sm ml-2 mb-1 block">Mobile Number or Email</label>
        <input
          /*
           * type="text", not type="email".
           *
           * The browser's built-in email validation would refuse to submit a
           * bare phone number, and the resulting "please enter an email
           * address" bubble comes from the browser, not the app — so it cannot
           * be reworded to mention the other option.
           */
          type="text"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-3 font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D] transition-shadow"
          placeholder="98765 43210"
          autoComplete="username"
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2 ml-2 mb-1">
          <label className="font-bold text-sm">Password</label>
          {onForgotPassword && (
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-xs font-bold text-gray-600 hover:text-[#F26B4D] underline underline-offset-2"
            >
              Forgot password?
            </button>
          )}
        </div>
        <PasswordInput
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-3 font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D] transition-shadow"
          placeholder="••••••••"
        />
      </div>

      <Button type="submit" variant="primary" className="w-full mt-4" disabled={isSubmitting}>
        {isSubmitting ? 'Loading...' : 'Enter Platform'}
      </Button>
    </form>
  );
}