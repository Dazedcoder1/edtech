import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Plus,
  Send,
  Loader,
  ArrowLeft,
  CheckCircle2,
  MessageSquare,
} from 'lucide-react';
import { supportAPI } from '../../services/api';

const CATEGORIES = [
  { value: 'access', label: 'Course access' },
  { value: 'payment', label: 'Payment' },
  { value: 'video', label: 'Video playback' },
  { value: 'content', label: 'PDFs / notes' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'other', label: 'Something else' },
];

const STATUS_STYLE = {
  open: 'bg-[#F9E076]',
  answered: 'bg-[#A7E2D1]',
  closed: 'bg-gray-200 text-gray-600',
};

/**
 * The same status means different things to each side of the conversation.
 *
 * To a teacher, 'answered' means they have dealt with it. To a student it
 * means there is something new to read — which is the whole reason they opened
 * this panel, so it should say so plainly rather than showing internal
 * workflow vocabulary.
 */
function statusLabel(status, isEducator) {
  if (isEducator) return status;
  if (status === 'answered') return 'Teacher replied';
  if (status === 'open') return 'Waiting for reply';
  return 'Closed';
}

function ago(iso) {
  if (!iso) return '';
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The help desk drawer.
 *
 * One component serves both roles. A student sees their own tickets and can
 * open new ones; an educator sees every ticket and replies. The difference is
 * carried entirely by `isEducator` — the server enforces the same split, so a
 * mistake here is a cosmetic one rather than a data leak.
 *
 * @param {boolean} isEducator
 * @param {() => void} onClose
 * @param {string} [initialTicketId] open straight onto this thread. Set when
 *   the drawer was opened by clicking a "support replied" notification — the
 *   whole point of that click is to read the reply, so landing on a list and
 *   making them find it again defeats it.
 */
export default function HelpDeskPanel({ isEducator, onClose, initialTicketId }) {
  const [view, setView] = useState('list'); // list | new | thread
  const [tickets, setTickets] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('access');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await supportAPI.listTickets();
      setTickets(data?.tickets ?? []);
    } catch (err) {
      setError(err.message || 'Could not load your tickets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openThread = useCallback(async (ticketId) => {
    setBusy(true);
    setError('');
    try {
      const data = await supportAPI.getTicket(ticketId);
      setActive(data.ticket);
      setMessages(data.messages ?? []);
      setView('thread');
    } catch (err) {
      setError(err.message || 'Could not open that ticket.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Jump straight to a thread when the drawer was opened from a notification.
  // Runs once per id: re-running on every render would fight the back button.
  useEffect(() => {
    if (initialTicketId) openThread(initialTicketId);
  }, [initialTicketId, openThread]);

  const submitNew = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setBusy(true);
    setError('');
    try {
      await supportAPI.createTicket({ subject, message, category });
      setSubject('');
      setMessage('');
      setCategory('access');
      setView('list');
      await loadList();
    } catch (err) {
      setError(err.message || 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (e) => {
    e.preventDefault();
    if (!reply.trim() || !active) return;

    setBusy(true);
    setError('');
    const text = reply;
    try {
      await supportAPI.reply(active.id, text);
      setReply('');
      const data = await supportAPI.getTicket(active.id);
      setActive(data.ticket);
      setMessages(data.messages ?? []);
    } catch (err) {
      // Put the text back so a failed send does not lose what they typed.
      setReply(text);
      setError(err.message || 'Could not send the reply.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status) => {
    if (!active) return;
    setBusy(true);
    try {
      await supportAPI.setStatus(active.id, status);
      setActive({ ...active, status });
      loadList();
    } catch (err) {
      setError(err.message || 'Could not update the ticket.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center md:justify-end">
      {/* Backdrop. Clicking it closes, matching every other drawer in the app. */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        className="relative w-full md:w-[440px] md:mr-6 bg-[#FDF1E9] border-2 border-black rounded-t-3xl md:rounded-3xl
                   shadow-[4px_4px_0px_0px_#111] max-h-[85vh] md:max-h-[80vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-white border-b-2 border-black shrink-0">
          {view !== 'list' && (
            <button
              type="button"
              onClick={() => {
                setView('list');
                setError('');
              }}
              aria-label="Back"
              className="p-1 rounded-full hover:bg-gray-100"
            >
              <ArrowLeft size={18} strokeWidth={3} />
            </button>
          )}

          <h2 className="font-bold text-base flex-1 truncate">
            {view === 'new' ? 'New request' : view === 'thread' ? active?.subject : 'Help desk'}
          </h2>

          {view === 'list' && !isEducator && (
            <button
              type="button"
              onClick={() => setView('new')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full border-2 border-black bg-[#A7E2D1] font-bold text-xs hover:bg-[#8ed9c3]"
            >
              <Plus size={14} strokeWidth={3} /> New
            </button>
          )}

          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-gray-100">
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        {error && (
          <p className="px-4 py-2 bg-red-50 border-b-2 border-red-200 text-xs font-bold text-red-600 shrink-0">
            {error}
          </p>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ---------- LIST ---------- */}
          {view === 'list' && (
            <>
              {loading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-gray-500">
                  <Loader size={16} className="animate-spin" /> Loading...
                </div>
              )}

              {!loading && tickets.length === 0 && (
                <div className="px-6 py-12 text-center">
                  <MessageSquare size={28} strokeWidth={2} className="mx-auto mb-2 text-gray-300" />
                  <p className="font-bold text-sm text-gray-600">
                    {isEducator ? 'No tickets yet' : 'No requests yet'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {isEducator
                      ? 'Student questions will appear here.'
                      : 'Stuck on something? Send us a message and we will get back to you.'}
                  </p>
                  {!isEducator && (
                    <button
                      type="button"
                      onClick={() => setView('new')}
                      className="mt-4 px-4 py-2 rounded-full border-2 border-black bg-[#A7E2D1] font-bold text-xs hover:bg-[#8ed9c3]"
                    >
                      Ask a question
                    </button>
                  )}
                </div>
              )}

              {tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t.id)}
                  className="w-full text-left px-4 py-3 border-b border-gray-200 hover:bg-white/70 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-sm leading-snug break-words">{t.subject}</span>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-full border-2 border-black text-[10px] font-bold ${
                        STATUS_STYLE[t.status] || 'bg-gray-200'
                      }`}
                    >
                      {statusLabel(t.status, isEducator)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {isEducator && t.student_name ? `${t.student_name} · ` : ''}
                    {t.message_count} message{t.message_count === 1 ? '' : 's'} ·{' '}
                    {ago(t.last_message_at || t.created_at)}
                  </p>
                </button>
              ))}
            </>
          )}

          {/* ---------- NEW ---------- */}
          {view === 'new' && (
            <form onSubmit={submitNew} className="p-4 space-y-3">
              <label className="block">
                <span className="block font-bold text-xs mb-1">What is it about?</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white font-bold text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block font-bold text-xs mb-1">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={255}
                  placeholder="Short summary"
                  className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm"
                />
              </label>

              <label className="block">
                <span className="block font-bold text-xs mb-1">Details</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Tell us what happened, and what you expected instead."
                  className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm resize-none"
                />
              </label>

              <button
                type="submit"
                disabled={busy || !subject.trim() || !message.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-black bg-[#F26B4D] text-white font-bold text-sm
                           shadow-[2px_2px_0px_0px_#111] disabled:opacity-50 disabled:shadow-none"
              >
                {busy ? <Loader size={15} className="animate-spin" /> : <Send size={15} strokeWidth={3} />}
                Send
              </button>
            </form>
          )}

          {/* ---------- THREAD ---------- */}
          {view === 'thread' && active && (
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full border-2 border-black text-[10px] font-bold ${
                    STATUS_STYLE[active.status] || 'bg-gray-200'
                  }`}
                >
                  {statusLabel(active.status, isEducator)}
                </span>
                {isEducator && active.student_name && (
                  <span className="text-[11px] font-bold text-gray-600">
                    {active.student_name} · {active.student_email}
                  </span>
                )}
              </div>

              {messages.map((m) => {
                const fromStaff = m.author_role === 'educator';
                return (
                  <div
                    key={m.id}
                    className={`rounded-2xl border-2 border-black px-3 py-2 ${
                      fromStaff ? 'bg-[#A7E2D1]' : 'bg-white'
                    }`}
                  >
                    <p className="text-[11px] font-bold text-gray-600 mb-0.5">
                      {/* "Teacher", not "Support" — students are writing to the
                          person who teaches them, and the generic word makes a
                          reply look like it came from a helpdesk robot. */}
                      {fromStaff ? `Teacher${m.author_name ? ` · ${m.author_name}` : ''}` : m.author_name || 'You'}
                      {' · '}
                      {ago(m.created_at)}
                    </p>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                );
              })}

              {active.status === 'closed' ? (
                <p className="text-xs font-bold text-gray-500 text-center py-3">
                  This ticket is closed.
                </p>
              ) : (
                <form onSubmit={submitReply} className="space-y-2 pt-1">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder={isEducator ? 'Write a reply...' : 'Add more detail...'}
                    className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy || !reply.trim()}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl border-2 border-black bg-[#F26B4D] text-white font-bold text-sm
                                 shadow-[2px_2px_0px_0px_#111] disabled:opacity-50 disabled:shadow-none"
                    >
                      {busy ? <Loader size={15} className="animate-spin" /> : <Send size={15} strokeWidth={3} />}
                      Send
                    </button>
                    {/* Closing is the teacher's call. The server rejects it for
                        students too — this only avoids offering a button that
                        would come back with a 403. */}
                    {isEducator && (
                      <button
                        type="button"
                        onClick={() => changeStatus('closed')}
                        disabled={busy}
                        title="Close this ticket"
                        className="px-3 py-2 rounded-xl border-2 border-black bg-white font-bold text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        <CheckCircle2 size={15} strokeWidth={3} />
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
