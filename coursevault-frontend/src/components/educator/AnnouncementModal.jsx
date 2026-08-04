import React, { useState } from 'react';
import { X, Megaphone, Send, Loader } from 'lucide-react';
import { notificationsAPI } from '../../services/api';

/**
 * Post an announcement to everyone enrolled in one course.
 *
 * @param {string} courseId
 * @param {string} courseTitle shown so the teacher can see who this reaches
 * @param {() => void} onClose
 */
export default function AnnouncementModal({ courseId, courseTitle, onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    setBusy(true);
    setError('');
    try {
      const res = await notificationsAPI.announce(courseId, title.trim(), body.trim());
      // Report the recipient count rather than a bare "sent". Zero is a real
      // outcome for a course with no live enrolments, and silently claiming
      // success there would leave the teacher believing it went out.
      setSent(res?.sent ?? 0);
    } catch (err) {
      setError(err.message || 'Could not post the announcement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[#FDF1E9] border-2 border-black rounded-3xl shadow-[4px_4px_0px_0px_#111] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-white border-b-2 border-black">
          <Megaphone size={18} strokeWidth={3} />
          <h2 className="font-bold text-base flex-1">Announcement</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-gray-100">
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        {sent !== null ? (
          <div className="px-6 py-10 text-center">
            <p className="font-bold text-sm">
              {sent > 0
                ? `Sent to ${sent} student${sent === 1 ? '' : 's'}.`
                : 'Nobody has active access to this course yet, so no one was notified.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-4 py-2 rounded-full border-2 border-black bg-[#A7E2D1] font-bold text-xs hover:bg-[#8ed9c3]"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-4 space-y-3">
            <p className="text-xs font-bold text-gray-600">
              Goes to everyone with active access to{' '}
              <span className="text-black">{courseTitle || 'this course'}</span>.
            </p>

            {error && (
              <p className="px-3 py-2 rounded-xl bg-red-50 border-2 border-red-200 text-xs font-bold text-red-600">
                {error}
              </p>
            )}

            <label className="block">
              <span className="block font-bold text-xs mb-1">Headline</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={255}
                placeholder="Class cancelled on Friday"
                className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm"
              />
            </label>

            <label className="block">
              <span className="block font-bold text-xs mb-1">Details (optional)</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Anything else they should know."
                className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm resize-none"
              />
            </label>

            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-black bg-[#F26B4D] text-white font-bold text-sm
                         shadow-[2px_2px_0px_0px_#111] disabled:opacity-50 disabled:shadow-none"
            >
              {busy ? <Loader size={15} className="animate-spin" /> : <Send size={15} strokeWidth={3} />}
              Post announcement
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
