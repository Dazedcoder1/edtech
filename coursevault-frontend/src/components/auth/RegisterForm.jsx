import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
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

/**
 * How far along the form is.
 *
 * A count ("Step 2 of 3") as well as the dots: dots alone show position but
 * not how much is left, which is the thing that decides whether someone
 * abandons a signup.
 */
function Progress({ step, total }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full border-2 border-black transition-colors ${
              i < step ? 'bg-[#A7E2D1]' : i === step ? 'bg-[#F9E076]' : 'bg-white'
            }`}
          />
        ))}
      </div>
      <p className="text-xs font-bold text-gray-500 text-center">
        Step {step + 1} of {total}
      </p>
    </div>
  );
}

export default function RegisterForm() {
  const { register } = useAuth();

  const [step, setStep] = useState(0);
  const [role, setRole] = useState('student');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [board, setBoard] = useState('');
  const [state, setState] = useState('');
  const [school, setSchool] = useState('');

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isStudent = role === 'student';
  // Educators skip the academic step entirely, so the progress bar has to
  // reflect their shorter journey rather than promising a step they never see.
  const steps = isStudent ? 3 : 2;

  /**
   * Validate the current step only.
   *
   * Checking everything on every "Next" would surface errors about fields the
   * person has not reached yet, which reads as the form being broken.
   */
  const validateStep = () => {
    if (step === 0) {
      if (!name.trim()) return 'Please enter your full name.';
      const digits = phone.replace(/\D/g, '');
      const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
        : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
        : digits;
      if (national.length !== 10) return 'Enter a 10-digit mobile number.';
      if (!/^[6-9]/.test(national)) return "That doesn't look like a mobile number.";
      if (!email.trim()) return 'Please enter your email address.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        return "That email address doesn't look valid.";
      }
      return null;
    }
    if (step === 1) {
      if (password.length < 6) return 'Password must be at least 6 characters.';
      if (password !== confirm) return 'The two passwords do not match.';
      return null;
    }
    if (step === 2) {
      if (!classLevel) return 'Please choose your class.';
      if (!board) return 'Please choose your board.';
      if (!state) return 'Please choose your state.';
      return null;
    }
    return null;
  };

  const next = (e) => {
    e.preventDefault();
    const problem = validateStep();
    if (problem) { setError(problem); return; }
    setError('');
    setStep((s) => s + 1);
  };

  const back = () => {
    setError('');
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateStep();
    if (problem) { setError(problem); return; }

    setError('');
    setIsSubmitting(true);
    try {
      await register({
        name,
        phone,
        email: email.trim(),
        password,
        role,
        ...(isStudent
          ? { class_level: classLevel, board, state, school: school.trim() || undefined }
          : {}),
      });
    } catch (err) {
      /*
       * A rejection here is nearly always about the mobile number or email,
       * both of which live on step 1 — so send them back rather than showing
       * the message on a step where the offending field is not visible.
       */
      setError(err.message || 'Failed to register');
      if (/mobile|email|registered/i.test(err.message || '')) setStep(0);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLast = step === steps - 1;

  return (
    <form className="text-left" onSubmit={isLast ? submit : next}>
      <Progress step={step} total={steps} />

      {error && (
        <div className="p-3 mb-4 bg-red-100 border-2 border-red-500 text-red-700 font-bold rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* -------------------------------------------------- step 1: about you */}
      {step === 0 && (
        <div className="flex flex-col gap-4">
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

          <div>
            <Label>Full Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="John Doe"
              autoComplete="name"
              autoFocus
            />
          </div>

          <div>
            <Label>Mobile Number</Label>
            <input
              // tel, not number: a number input strips leading zeros and shows
              // spinner arrows you can scroll a phone number with.
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              placeholder="98765 43210"
              autoComplete="tel"
            />
            <p className="text-xs text-gray-500 mt-1 ml-2">You will use this to sign in.</p>
          </div>

          <div>
            <Label>Email Address</Label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <p className="text-xs text-gray-500 mt-1 ml-2">
              We'll send a code to confirm it. This is how you reset a forgotten password.
            </p>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- step 2: password */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <Label>Password</Label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
              placeholder="••••••••"
            />
            <p className="text-xs text-gray-500 mt-1 ml-2">At least 6 characters.</p>
          </div>

          <div>
            <Label>Confirm Password</Label>
            <PasswordInput
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
        </div>
      )}

      {/* -------------------------------------------------- step 3: academics */}
      {step === 2 && isStudent && (
        <div className="flex flex-col gap-4">
          <div>
            <Label>Class</Label>
            <select
              value={classLevel}
              onChange={(e) => setClassLevel(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>Select your class</option>
              {CLASS_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1 ml-2">
              This can't be changed later, so please choose carefully.
            </p>
          </div>

          <div>
            <Label>Board</Label>
            <select
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>Select your board</option>
              {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <Label>State</Label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>Select your state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
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
        </div>
      )}

      {/* ------------------------------------------------------------ actions */}
      <div className="flex gap-3 mt-6">
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            className="flex items-center justify-center gap-1 px-4 py-3 rounded-xl border-2 border-black bg-white font-bold text-sm hover:bg-gray-100"
          >
            <ArrowLeft size={16} strokeWidth={3} /> Back
          </button>
        )}

        <Button
          type="submit"
          variant="secondary"
          className="flex-1"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating account...' : isLast ? (
            <span className="flex items-center justify-center gap-2">
              <Check size={16} strokeWidth={3} /> Create Account
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              Next <ArrowRight size={16} strokeWidth={3} />
            </span>
          )}
        </Button>
      </div>
    </form>
  );
}
