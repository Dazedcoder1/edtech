import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Flame, FileText, ClipboardList, Radio, HelpCircle,
  BookOpen, Users, Play, ArrowRight, Loader, Lock,
} from 'lucide-react';
import { fetchAPI, resolveMediaUrl } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/** Morning / afternoon / evening, from the reader's own clock. */
function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/**
 * A quick-action tile.
 *
 * `soon` renders it visibly unfinished rather than hiding it: the point of
 * showing a planned feature is to say it is coming, and a tile that looks
 * live but does nothing is worse than one that admits it is not ready.
 */
function ActionTile({ icon: Icon, label, sub, tone, onClick, soon }) {
  return (
    <button
      type="button"
      onClick={soon ? undefined : onClick}
      disabled={soon}
      className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 border-black bg-white text-center transition-all ${
        soon
          ? 'opacity-60 cursor-default'
          : 'shadow-[3px_3px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111]'
      }`}
    >
      <span className={`w-11 h-11 rounded-full border-2 border-black flex items-center justify-center ${tone}`}>
        {soon ? <Lock size={18} strokeWidth={2.5} /> : <Icon size={20} strokeWidth={2.5} />}
      </span>
      <span className="font-bold text-xs leading-tight">{label}</span>
      <span className="text-[10px] font-bold text-gray-500 leading-tight">
        {soon ? 'Coming soon' : sub}
      </span>
    </button>
  );
}

export default function StudentHomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchAPI('/home');
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load your home page.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const courses = data?.courses ?? [];
  const counts = data?.counts ?? {};
  const streak = data?.streak ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) => c.title?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    );
  }, [courses, query]);

  const firstName = (user?.name || '').split(' ')[0] || 'there';

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 font-bold text-gray-500">
        <Loader size={18} className="animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* ---------------------------------------------------------- greeting */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-4xl font-black tracking-tight">
            {greeting()}, {firstName} 👋
          </h1>
          <p className="text-sm text-gray-600 font-medium mt-0.5">
            Let's continue your learning journey.
          </p>
        </div>

        {/*
          Only shown once there is a streak to show. A "0 day streak" badge is
          a reproach on the first screen after signing up, which is the worst
          possible moment for one.
        */}
        {streak > 0 && (
          <div
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-2xl border-2 border-black bg-[#F9E076] shadow-[3px_3px_0px_0px_#111]"
            title={`${data.activeDays} active day${data.activeDays === 1 ? '' : 's'} in total`}
          >
            <Flame size={20} strokeWidth={2.5} className="text-[#F26B4D]" />
            <div className="leading-none">
              <div className="font-black text-lg">{streak}</div>
              <div className="text-[10px] font-bold">Day Streak</div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 border-2 border-red-500 bg-red-50 rounded-xl font-bold text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------------ search */}
      <div className="relative mb-5">
        <Search size={18} strokeWidth={3} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your classes and subjects..."
          className="w-full pl-11 pr-4 py-3 rounded-2xl border-2 border-black bg-white font-medium focus:outline-none focus:shadow-[4px_4px_0px_0px_#F26B4D] transition-shadow"
        />
      </div>

      {/* ------------------------------------------------------------ banner */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-black bg-[#932973] text-white p-5 md:p-7 mb-5 shadow-[4px_4px_0px_0px_#111]">
        <div className="relative z-10 max-w-md">
          <span className="inline-block px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-bold uppercase tracking-wide mb-2">
            Sharda Vidyapeeth
          </span>
          <h2 className="text-xl md:text-3xl font-black leading-tight mb-1">
            Learn • Practice • Achieve
          </h2>
          <p className="text-sm text-white/80 font-medium mb-4">
            Everything for your class in one place.
          </p>
          <button
            type="button"
            onClick={() => navigate('/explore')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 border-black bg-white text-black font-bold text-sm shadow-[2px_2px_0px_0px_#111]"
          >
            Explore Courses <ArrowRight size={15} strokeWidth={3} />
          </button>
        </div>
        <BookOpen
          size={150}
          strokeWidth={1}
          className="absolute -right-6 -bottom-8 text-white/10 pointer-events-none"
        />
      </div>

      {/* ------------------------------------------------------------- tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 md:gap-3 mb-7">
        <ActionTile
          icon={FileText}
          label="Notes"
          sub={counts.notes_count ? `${counts.notes_count} available` : 'Study material'}
          tone="bg-[#87CEFA]"
          onClick={() => navigate('/my-learning')}
        />
        <ActionTile
          icon={ClipboardList}
          label="Tests"
          sub={
            counts.quiz_count
              ? `${counts.quizzes_done ?? 0} of ${counts.quiz_count} done`
              : 'Practice now'
          }
          tone="bg-[#F26B4D]"
          onClick={() => navigate('/my-learning')}
        />
        <ActionTile icon={Radio} label="Live Classes" tone="bg-[#A084E8]" soon />
        <ActionTile icon={HelpCircle} label="PYQs" tone="bg-[#A7E2D1]" soon />
      </div>

      {/* ----------------------------------------------------------- classes */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-black text-lg md:text-xl uppercase">Your Classes</h2>
        <button
          type="button"
          onClick={() => navigate('/my-learning')}
          className="flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-black"
        >
          View all <ArrowRight size={13} strokeWidth={3} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="border-2 border-black rounded-2xl bg-white p-8 text-center shadow-[3px_3px_0px_0px_#111]">
          <BookOpen size={30} strokeWidth={2} className="mx-auto mb-2 text-gray-300" />
          <p className="font-bold text-sm text-gray-600">
            {courses.length === 0 ? "You haven't joined any classes yet." : 'Nothing matches that search.'}
          </p>
          {courses.length === 0 && (
            <button
              type="button"
              onClick={() => navigate('/explore')}
              className="mt-4 px-4 py-2 rounded-full border-2 border-black bg-[#A7E2D1] font-bold text-xs shadow-[2px_2px_0px_0px_#111]"
            >
              Browse courses
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((c) => (
            <CourseRow key={c.id} course={c} onOpen={() => navigate(`/course/${c.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CourseRow({ course, onOpen }) {
  /*
   * Progress against videos, matching what the backend counts.
   *
   * A course with no video yet shows no bar rather than 0% — an empty bar on
   * brand-new material reads as the student having fallen behind on something
   * that does not exist.
   */
  const total = course.video_count ?? 0;
  const done = Math.min(course.videos_watched ?? 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="flex gap-3 p-3 rounded-2xl border-2 border-black bg-white shadow-[3px_3px_0px_0px_#111] cursor-pointer hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111] transition-all"
    >
      <div className="shrink-0 w-20 h-20 rounded-xl border-2 border-black overflow-hidden bg-[#F4DFD8] flex items-center justify-center">
        {course.thumbnail_url ? (
          <img
            src={resolveMediaUrl(course.thumbnail_url)}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <BookOpen size={26} strokeWidth={2} className="text-black/40" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="font-black text-sm md:text-base leading-tight truncate">{course.title}</h3>
        {course.parent_title && (
          <p className="text-[11px] font-bold text-gray-500">in {course.parent_title}</p>
        )}
        {course.description && (
          <p className="text-xs text-gray-600 line-clamp-1 mt-0.5">{course.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] font-bold text-gray-500">
          <span className="flex items-center gap-1">
            <BookOpen size={12} strokeWidth={3} /> {course.module_count} chapter
            {course.module_count === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1">
            <Users size={12} strokeWidth={3} /> {course.student_count} student
            {course.student_count === 1 ? '' : 's'}
          </span>
        </div>

        {pct !== null && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-2 rounded-full border border-black bg-gray-100 overflow-hidden">
              <div className="h-full bg-[#F26B4D]" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-black tabular-nums">{pct}%</span>
          </div>
        )}
      </div>

      <div className="shrink-0 self-center w-10 h-10 rounded-full border-2 border-black bg-[#F26B4D] text-white flex items-center justify-center shadow-[2px_2px_0px_0px_#111]">
        <Play size={16} strokeWidth={3} fill="currentColor" />
      </div>
    </div>
  );
}
