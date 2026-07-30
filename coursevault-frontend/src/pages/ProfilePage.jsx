import React, { useState, useEffect } from 'react';
import { User, Mail, Phone, Lock, Check, AlertTriangle, Shield } from 'lucide-react';
import { fetchAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';

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
  const { user, applyProfileUpdate } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

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
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  // Email is the login identifier, so the server demands the password before
  // changing it. Surfacing that field only when the address actually differs
  // keeps the common case (fixing a typo in your name) friction-free.
  const emailChanged =
    !!user && email.trim().toLowerCase() !== (user.email || '').toLowerCase();

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    if (emailChanged && !currentPassword) {
      setProfileError('Enter your current password to change your email address.');
      return;
    }

    setSavingProfile(true);
    try {
      const result = await fetchAPI('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          ...(emailChanged ? { currentPassword } : {}),
        }),
      });

      applyProfileUpdate(result);
      setCurrentPassword('');
      setProfileSuccess(
        emailChanged ? 'Saved. Your sign-in email has changed.' : 'Contact info saved.'
      );
    } catch (err) {
      setProfileError(err.message || 'Could not save your details.');
    } finally {
      setSavingProfile(false);
    }
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
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">Your Profile</h1>
        <p className="text-sm text-gray-600 font-medium mt-1">
          Signed in as <strong>{user.email}</strong>
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
        <h2 className="font-black text-lg uppercase">Contact Info</h2>

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

        <Field icon={Mail} label="Email address" hint="This is what you sign in with.">
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field icon={Phone} label="Phone number" hint="Optional.">
          <input
            type="tel"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
        </Field>

        {emailChanged && (
          <div className="border-2 border-amber-400 bg-amber-50 rounded-lg p-3 flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
              <Shield size={14} strokeWidth={3} /> Confirm it's you
            </span>
            <p className="text-xs text-amber-800">
              You're changing the email you sign in with. Enter your current password
              to confirm.
            </p>
            <input
              type="password"
              className={inputClass}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
            />
          </div>
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

      {/* --------------------------------------------------------- password */}
      <form
        onSubmit={savePassword}
        className="border-[3px] border-black rounded-2xl bg-white p-5 md:p-6 shadow-[6px_6px_0px_0px_#111] flex flex-col gap-4"
      >
        <h2 className="font-black text-lg uppercase">Change Password</h2>

        <Banner tone="error">{pwError}</Banner>
        <Banner tone="success">{pwSuccess}</Banner>

        <Field icon={Lock} label="Current password">
          <input
            type="password"
            className={inputClass}
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Field icon={Lock} label="New password" hint="At least 8 characters.">
          <input
            type="password"
            className={inputClass}
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field icon={Lock} label="Confirm new password">
          <input
            type="password"
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
    </div>
  );
}
