import React, { useState, useEffect } from 'react';
import { User, Mail, Phone, Lock, Check, AlertTriangle } from 'lucide-react';
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
  const [phone, setPhone] = useState('');

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
    }
  }, [user]);

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
        }),
      });

      applyProfileUpdate(result);
      setProfileSuccess('Contact info saved.');
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

        {/*
          Shown but not editable. Rendering it as plain text rather than a
          disabled <input> avoids implying it might become editable, and the
          server rejects a changed address regardless — this is the label on
          the rule, not the rule itself.
        */}
        <Field
          icon={Mail}
          label="Email address"
          hint="This is what you sign in with, and it can't be changed."
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

        <Field icon={Phone} label="Phone number" hint="Optional.">
          <input
            type="tel"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
        </Field>


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
