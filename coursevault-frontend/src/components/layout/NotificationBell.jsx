import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  FileText,
  Megaphone,
  GraduationCap,
  UserPlus,
  CheckCheck,
  LifeBuoy,
  X,
  Loader,
} from 'lucide-react';
import { notificationsAPI } from '../../services/api';

/** How often the unread badge refreshes while the dropdown is shut. */
const POLL_MS = 60_000;

const ICONS = {
  announcement: Megaphone,
  course: GraduationCap,
  content: BookOpen,
  quiz: FileText,
  enrolment: UserPlus,
  submission: CheckCheck,
  ticket: LifeBuoy,
  ticket_reply: LifeBuoy,
};

/**
 * Relative time, without pulling in a date library.
 *
 * Deliberately coarse: "3h" is what a notification list needs, and the exact
 * minute of a week-old announcement is noise.
 */
function ago(iso) {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * @param {(ticketId?: string) => void} [onOpenSupport] called instead of
 *   navigating when a notification points at a ticket. Support threads live in
 *   a drawer, not at a URL, so there is no route to send the browser to — the
 *   ticket id is handed over so the drawer can open that thread rather than
 *   dropping the reader on a list to hunt for it.
 */
export default function NotificationBell({ onOpenSupport }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  /*
   * A ref, not the state value.
   *
   * The poll below is installed once with an empty dependency array, so a
   * closure over `open` would be frozen at `false` forever and the guard would
   * never fire. Reading it through a ref sees the current value.
   */
  const openRef = useRef(false);
  openRef.current = open;

  /*
   * The badge polls; the list does not.
   *
   * Fetching 50 rows every minute for a number that is usually zero is waste,
   * so the cheap count endpoint drives the badge and the full list is only
   * fetched when someone actually opens the dropdown.
   */
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      // Skip while the panel is open. Opening it clears the badge, and a poll
      // landing in the gap before that write commits would put the old count
      // straight back — the badge would visibly flick from 0 to 5 and back
      // while the user is staring at the list they just read.
      if (openRef.current) return;

      const data = await notificationsAPI.unreadCount();
      if (!cancelled && !openRef.current) setUnread(data?.unread ?? 0);
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /**
   * Fetch the feed, then clear the badge.
   *
   * Opening the panel *is* reading them — a count that survives the act of
   * looking at the list reads as a broken badge, and forces the user to hunt
   * for a "mark all read" control to make a number go away.
   *
   * The rows keep the read_at they were fetched with, so they stay visually
   * highlighted for this session: the badge is "is there anything new", the
   * highlight is "here is what was new". Clearing both at once would leave no
   * way to see what had just arrived.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notificationsAPI.list();
      const list = data?.notifications ?? [];
      setItems(list);

      if (list.some((n) => !n.read_at)) {
        setUnread(0);
        // Fire and forget. If it fails the next poll restores the true count,
        // which is the correct outcome — better a badge that comes back than
        // one that lies about having been read.
        notificationsAPI.markAllRead().catch(() => {});
      } else {
        setUnread(data?.unread ?? 0);
      }
    } catch (err) {
      console.error('[NotificationBell] load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Close on an outside click or Escape. Without the Escape handler the panel
  // is a keyboard trap on mobile, where there may be nothing else to click.
  useEffect(() => {
    if (!open) return;

    const onPointer = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const openItem = async (n) => {
    setOpen(false);

    // Update locally first so the row stops looking unread immediately,
    // then tell the server. A failed write leaves a stale badge, not a
    // blocked navigation.
    if (!n.read_at) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      notificationsAPI.markRead(n.id).catch(() => {});
    }

    if (!n.link) return;

    // /support/:id is not a route — the app's catch-all would silently bounce
    // the user to their home page, which looks like the click did nothing.
    if (n.link.startsWith('/support')) {
      const ticketId = n.link.split('/')[2] || undefined;
      onOpenSupport?.(ticketId);
      return;
    }

    navigate(n.link);
  };

  /**
   * Empty the feed.
   *
   * Deletes rather than marks read, because "mark all read" is already what
   * opening the panel does — the only remaining thing a user wants from a list
   * of things they have dealt with is for it to go away.
   *
   * Deleted optimistically: the list is restored from the server if any delete
   * fails, so a partial failure cannot leave the UI claiming rows are gone
   * when they are not.
   */
  const clearAll = async () => {
    const previous = items;
    setItems([]);
    setUnread(0);
    try {
      await Promise.all(previous.map((n) => notificationsAPI.remove(n.id)));
    } catch {
      load();
    }
  };

  const dismiss = async (e, id) => {
    e.stopPropagation();
    const removed = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (removed && !removed.read_at) setUnread((u) => Math.max(0, u - 1));
    notificationsAPI.remove(id).catch(() => load());
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className={`relative flex items-center justify-center w-9 h-9 rounded-full border-2 border-black transition-colors ${
          open ? 'bg-[#F9E076]' : 'bg-white hover:bg-[#F9E076]'
        }`}
      >
        <Bell size={16} strokeWidth={3} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#E63946] border-2 border-black text-white text-[10px] font-bold leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          /*
           * Fixed on phones, absolute on desktop.
           *
           * A right-anchored absolute panel inside a header that is already
           * near the viewport edge overflows off-screen on a 360px display and
           * cannot be scrolled back into view. Pinning it to the viewport below
           * the header sidesteps that entirely.
           */
          className="fixed left-2 right-2 top-16 z-[60] max-h-[70vh] overflow-y-auto rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0px_0px_#111]
                     md:absolute md:left-auto md:right-0 md:top-auto md:mt-2 md:w-[380px]"
        >
          <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 bg-[#FDF1E9] border-b-2 border-black">
            <span className="font-bold text-sm">Notifications</span>
            {/* No "mark all read" control: opening this panel already does it.
                A button that can only appear for the instant before its own
                condition goes false is worse than no button. */}
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] font-bold underline underline-offset-2 hover:text-[#F26B4D]"
              >
                Clear all
              </button>
            )}
          </div>

          {loading && items.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-gray-500">
              <Loader size={16} className="animate-spin" /> Loading...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="px-6 py-10 text-center">
              <Bell size={28} strokeWidth={2} className="mx-auto mb-2 text-gray-300" />
              <p className="font-bold text-sm text-gray-500">Nothing yet</p>
              <p className="text-xs text-gray-400 mt-1">
                New lessons, quizzes and replies will show up here.
              </p>
            </div>
          )}

          {items.map((n) => {
            const Icon = ICONS[n.type] || Bell;
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => openItem(n)}
                onKeyDown={(e) => e.key === 'Enter' && openItem(n)}
                className={`group flex gap-3 px-4 py-3 border-b border-gray-200 last:border-b-0 cursor-pointer transition-colors ${
                  n.read_at ? 'bg-white hover:bg-gray-50' : 'bg-[#FFF9E6] hover:bg-[#FFF3CC]'
                }`}
              >
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full border-2 border-black bg-[#A7E2D1] flex items-center justify-center">
                  <Icon size={14} strokeWidth={3} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm leading-snug break-words">{n.title}</p>
                  {n.body && (
                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 break-words">{n.body}</p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">
                    {n.course_title ? `${n.course_title} · ` : ''}
                    {ago(n.created_at)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={(e) => dismiss(e, n.id)}
                  aria-label="Dismiss"
                  className="shrink-0 self-start p-1 rounded-full text-gray-300 hover:text-black hover:bg-gray-100"
                >
                  <X size={14} strokeWidth={3} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
