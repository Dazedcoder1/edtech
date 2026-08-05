import React, { useState } from 'react';
import Button from '../ui/Button.jsx';
import PasswordInput from '../ui/PasswordInput.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { CLASS_LEVELS, BOARDS, STATES } from '../../utils/studentOptions.js';

const inputClass =
  'w-full bg-[#F4F4F4] border-2 border-black rounded-xl px-4 py-3 font-medium ' +
  'focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D] transition-shadow';

function Label({ children, optional }) {
  return (
    <label className="font-bold text-sm ml-2 mb-1 block">
      {children}
      {optional && <span className="font-medium text-gray-500"> (optional)</span>}
    </label>
  );
}

export default function RegisterForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState('student');
  const [classLevel, setClassLevel] = useState('');
  const [board, setBoard] = useState('');
  const [state, setState] = useState('');
  const [school, setSchool] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register } = useAuth();

  const isStudent = role === 'student';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    /*
     * Checked here as well as on the server.
     *
     * The confirm field never reaches the API — there is nothing for the
     * backend to compare it against — so this is the only place a mismatch can
     * be caught, and catching it before the request avoids creating an account
     * with a password the person did not mean to type.
     */
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        name,
        phone,
        email: email.trim() || undefined,
        password,
        role,
        // Sent only for students. An educator has no class, and the server
        // ignores these for them anyway.
        ...(isStudent
          ? { class_level: classLevel, board, state, school: school.trim() || undefined }
          : {}),
      });
    } catch (err) {
      setError(err.message || 'Failed to register');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-4 text-left" onSubmit={handleSubmit}>
      {error && (
        <div className="p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold rounded-xl text-sm">
          {error}
        </div>
      )}

      <div>
        <Label>Full Name</Label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="John Doe"
          autoComplete="name"
        />
      </div>

      <div>
        <Label>Mobile Number</Label>
        <input
          /*
           * type="tel", not type="number".
           *
           * A number input strips leading zeros, accepts "e" and exponents, and
           * on desktop shows spinner arrows that let you scroll a phone number
           * up and down. tel brings up the phone keypad on mobile without any
           * of that.
           */
          type="tel"
          inputMode="numeric"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          placeholder="98765 43210"
          autoComplete="tel"
        />
        <p className="text-xs text-gray-500 mt-1 ml-2">You will use this to sign in.</p>
      </div>

      <div>
        <Label optional>Email Address</Label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="user@example.com"
          autoComplete="email"
        />
      </div>

      <div>
        <Label>Password</Label>
        <PasswordInput
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
          placeholder="••••••••"
        />
      </div>

      <div>
        <Label>Confirm Password</Label>
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

      <div>
        <Label>I am a</Label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputClass}
        >
          <option value="student">📚 Student - Looking to learn</option>
          <option value="educator">🎓 Educator - Want to teach</option>
        </select>
      </div>

      {/* Academic details: students only. */}
      {isStudent && (
        <>
          <div>
            <Label>Class</Label>
            <select
              required
              value={classLevel}
              onChange={(e) => setClassLevel(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>Select your class</option>
              {CLASS_LEVELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1 ml-2">
              This cannot be changed later, so please choose carefully.
            </p>
          </div>

          <div>
            <Label>Board</Label>
            <select
              required
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>Select your board</option>
              {BOARDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>State</Label>
            <select
              required
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>Select your state</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <Label optional>School / College</Label>
            <input
              type="text"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className={inputClass}
              placeholder="Govt. Senior Secondary School"
            />
          </div>
        </>
      )}

      <Button type="submit" variant="secondary" className="w-full mt-2" disabled={isSubmitting}>
        {isSubmitting ? 'Loading...' : 'Create Account'}
      </Button>
    </form>
  );
}
