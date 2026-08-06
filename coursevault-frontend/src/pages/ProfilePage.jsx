import React, { useState, useEffect } from 'react';
import {
  User, Mail, Phone, Lock, Check, AlertTriangle, LogOut,
  GraduationCap, BookOpen, MapPin, School,
} from 'lucide-react';
import { fetchAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import PasswordInput from '../components/ui/PasswordInput';
import { BOARDS, STATES } from '../utils/studentOptions';
import AppearanceSettings from '../components/educator/AppearanceSettings';

function Field({ icon: Icon, label, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 font-bold text-sm mb-1">
        <Icon size={14} strokeWidth={2.5} /> {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full border-2 border-black rounded-lg px-3 py-2 font-medium bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-[#F26B4D] disabled:bg-gray-100 disabled:text-gray-500';

function Banner({ tone, children }) {
  if (!children) return null;
  const tones = {
    error: 'bg-red-50 border-red-400 text-red-800',
    success: 'bg-green-50 border-green-500 text-green-800',
  };
  const Icon = tone === 'success' ? Check : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 border-2 rounded-lg px-3 py-2 text-sm font-bold ${tones[tone]}`}>
      <Icon size={16} strokeWidth={3} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { user, applyProfileUpdate, logout } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [board, setBoard] = useState('');
  const [state, setState] = useState('');
  const [school, setSchool] = useState('');

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone(user.phone || '');
      setEmail(user.email || '');
      setBoard(user.board || '');
      setState(user.state || '');
      setSchool(user.school || '');
    }
  }, [user]);

  const isStudent = user?.role === 'student';
  // An account created with a mobile number only. The email field stays
  // editable in that case, because there is no existing address to protect —
  // once one is saved it locks like everyone else's.
  const canAddEmail = !user?.email;

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    setSavingProfile(true);
    try {
      const result = await fetchAPI('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          // Only sent when there is no address on file. Sending an unchanged
          // one is harmless, but sending nothing keeps the request honest
          // about what it is asking to change.
          ...(canAddEmail && email.trim() ? { email: email.trim() } : {}),
          // class_level is deliberately absent: it is locked, and the server
          // rejects any attempt to move it.
          ...(isStudent ? { board, state, school: school.trim() } : {}),
        }),
      });

      applyProfileUpdate(result);
      setProfileSuccess('Profile saved.');
    } catch (err) {
      setProfileError(err.message || 'Could not save your details.');
    } finally {
      setSavingProfile(false);
    }
  };

  // Confirmed because this used to be a header button people hit by accident;
  // on a page you visit deliberately an accidental click is likelier still.
  const handleSignOut = () => {
    if (window.confirm('Sign out of your account on this device?')) logout();
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (pwNew !== pwConfirm) {
      setPwError('The two new passwords do not match.');
      return;
    }
    if (pwNew.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }

    setSavingPw(true);
    try {
      await fetchAPI('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      setPwSuccess('Password updated.');
    } catch (err) {
      setPwError(err.message || 'Could not change your password.');
    } finally {
      setSavingPw(false);
    }
  };

  if (!user) return null;

  return (
    // No horizontal padding: <main> already provides the page gutter, and
    // adding one here compounded to 40px a side on a phone.
    <div className="max-w-2xl mx-auto py-6 md:py-8 flex flex-col gap-5 md:gap-6">
      <div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">Your Profile</h1>
        <p className="text-sm text-gray-600 font-medium mt-1">
          {/* Falls back to the mobile number: email is optional now, and
              "Signed in as" followed by nothing looks like a broken page. */}
          Signed in as <strong>{user.email || user.phone || user.name}</strong>
          <span className="ml-2 px-2 py-0.5 text-xs uppercase font-black border-2 border-black rounded-full bg-[#F9E076]">
            {user.role}
          </span>
        </p>
      </div>

      {/* ---------------------------------------------------------- contact */}
      <form
        onSubmit={saveProfile}
        className="border-[3px] border-black rounded-2xl bg-white p-5 md:p-6 shadow-[6px_6px_0px_0px_#111] flex flex-col gap-4"
      >
        <h2 className="font-black text-lg uppercase">Your Details</h2>

        <Banner tone="error">{profileError}</Banner>
        <Banner tone="success">{profileSuccess}</Banner>

        <Field icon={User} label="Full name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            required
          />
        </Field>

        {/*
          Shown but not editable. Rendering it as plain text rather than a
          disabled <input> avoids implying it might become editable, and the
          server rejects a changed address regardless — this is the label on
          the rule, not the rule itself.
        */}
        <Field
          icon={Phone}
          label="Mobile number"
          hint="You sign in with this. It can be corrected, but not removed."
        >
          <input
            type="tel"
            inputMode="numeric"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            required
          />
        </Field>

        {canAddEmail ? (
          <Field
            icon={Mail}
            label="Email address"
            hint="Optional — but once you save one, it can't be changed."
          >
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
        ) : (
          <Field
            icon={Mail}
            label="Email address"
            hint="This can also be used to sign in, and it can't be changed."
          >
            <div className="flex items-center gap-2 rounded-lg border-2 border-black/15 bg-gray-100 px-3 py-2">
              <span className="flex-1 min-w-0 truncate font-medium text-gray-700">
                {user.email}
              </span>
              <span className="flex items-center gap-1 shrink-0 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                <Lock size={12} strokeWidth={3} /> Locked
              </span>
            </div>
          </Field>
        )}

        {isStudent && (
          <>
            <Field
              icon={GraduationCap}
              label="Class"
              hint="Set when you signed up. Contact support if this is wrong."
            >
              <div className="flex items-center gap-2 rounded-lg border-2 border-black/15 bg-gray-100 px-3 py-2">
                <span className="flex-1 min-w-0 truncate font-medium text-gray-700">
                  {user.class_level || '—'}
                </span>
                <span className="flex items-center gap-1 shrink-0 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  <Lock size={12} strokeWidth={3} /> Locked
                </span>
              </div>
            </Field>

            <Field icon={BookOpen} label="Board">
              <select
                className={inputClass}
                value={board}
                onChange={(e) => setBoard(e.target.value)}
              >
                <option value="">Not set</option>
                {BOARDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>

            <Field icon={MapPin} label="State">
              <select
                className={inputClass}
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">Not set</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>

            <Field icon={School} label="School / College" hint="Optional.">
              <input
                className={inputClass}
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="Govt. Senior Secondary School"
              />
            </Field>
          </>
        )}


        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            disabled={savingProfile}
            className="py-2.5 px-6 text-base rounded-xl border-2"
          >
            {savingProfile ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>

      {/*
        Educators only. The panel changes the platform for every user, so a
        student seeing it — even disabled — would suggest they had a say.
      */}
      {user.role === 'educator' && <AppearanceSettings />}

      {/* --------------------------------------------------------- password */}
      <form
        onSubmit={savePassword}
        className="border-[3px] border-black rounded-2xl bg-white p-5 md:p-6 shadow-[6px_6px_0px_0px_#111] flex flex-col gap-4"
      >
        <h2 className="font-black text-lg uppercase">Change Password</h2>

        <Banner tone="error">{pwError}</Banner>
        <Banner tone="success">{pwSuccess}</Banner>

        <Field icon={Lock} label="Current password">
          <PasswordInput
            className={inputClass}
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Field icon={Lock} label="New password" hint="At least 8 characters.">
          <PasswordInput
            className={inputClass}
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field icon={Lock} label="Confirm new password">
          <PasswordInput
            className={inputClass}
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="secondary"
            disabled={savingPw}
            className="py-2.5 px-6 text-base rounded-xl border-2"
          >
            {savingPw ? 'Updating...' : 'Update Password'}
          </Button>
        </div>
      </form>

      {/* ----------------------------------------------------------- session */}
      <div className="border-[3px] border-black rounded-2xl bg-white p-5 md:p-6 shadow-[6px_6px_0px_0px_#111] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-black text-lg uppercase">Session</h2>
          <p className="text-sm text-gray-600 font-medium mt-0.5">
            Signs you out on this device only.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="h-11 shrink-0 inline-flex items-center justify-center gap-2 px-5 font-bold text-sm border-2 border-black rounded-xl bg-white text-red-600 shadow-[3px_3px_0px_0px_#111] hover:bg-red-50 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
        >
          <LogOut size={16} strokeWidth={2.5} /> Sign out
        </button>
      </div>
    </div>
  );
}
