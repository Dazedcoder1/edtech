import React, { useEffect, useMemo, useState } from 'react';
import { Users, Search, X, Loader, AlertTriangle } from 'lucide-react';
import { fetchAPI } from '../../services/api.js';

/**
 * How long ago, in words.
 *
 * "3d ago" beats a timestamp for the question this table answers — a teacher
 * scanning for students who have gone quiet is comparing recency, not reading
 * dates. The exact date stays in the title attribute for when it matters.
 */
function ago(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const mins = ms / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const fullDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

/** Days since a timestamp, or null when it never happened. */
function daysSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * Who is enrolled in what, and when they were last here.
 *
 * One row per enrolment rather than per student: a student taking three
 * subjects appears three times, because "enrolled in which course" is the
 * question and collapsing them would hide the answer.
 */
export default function StudentDirectory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAPI('/analytics/students');
        if (!cancelled) setRows(data?.students ?? []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load the student list.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const courses = useMemo(() => {
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.course_id)) seen.set(r.course_id, r.course_title);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (courseFilter && r.course_id !== courseFilter) return false;
      if (!q) return true;
      return (
        r.student_name?.toLowerCase().includes(q) ||
        r.student_email?.toLowerCase().includes(q) ||
        r.student_phone?.includes(q) ||
        r.course_title?.toLowerCase().includes(q)
      );
    });
  }, [rows, query, courseFilter]);

  // Counted from all rows, not the filtered view: a summary that changes as
  // you type is describing your search, not your class.
  const neverLoggedIn = useMemo(
    () => new Set(rows.filter((r) => !r.last_login).map((r) => r.student_id)).size,
    [rows]
  );
  const uniqueStudents = useMemo(
    () => new Set(rows.map((r) => r.student_id)).size,
    [rows]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 font-bold text-gray-500">
        <Loader size={18} className="animate-spin" /> Loading students...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border-2 border-red-500 bg-red-50 rounded-xl font-bold text-red-700 text-sm">
        {error}
      </div>
    );
  }

  return (
    <section className="border-[3px] border-black rounded-2xl bg-white p-4 md:p-6 shadow-[6px_6px_0px_0px_#111]">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Users size={20} strokeWidth={3} />
        <h2 className="font-black text-lg md:text-xl uppercase">Students</h2>
        <span className="ml-auto text-xs font-bold text-gray-500">
          {uniqueStudents} student{uniqueStudents === 1 ? '' : 's'} · {rows.length} enrolment{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {neverLoggedIn > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-[#F26B4D] mb-3">
          <AlertTriangle size={13} strokeWidth={3} />
          {neverLoggedIn} student{neverLoggedIn === 1 ? ' has' : 's have'} never signed in
        </p>
      )}

      {/* ------------------------------------------------------------ filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} strokeWidth={3} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, mobile or course"
            className="w-full pl-9 pr-9 py-2 rounded-xl border-2 border-black font-medium text-sm focus:outline-none focus:shadow-[3px_3px_0px_0px_#F26B4D]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-black"
            >
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </div>

        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border-2 border-black font-bold text-sm bg-white"
        >
          <option value="">All courses</option>
          {courses.map(([id, title]) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center font-bold text-sm text-gray-500">
          {rows.length === 0
            ? 'Nobody has enrolled in your courses yet.'
            : 'No students match that search.'}
        </p>
      ) : (
        <>
          {/* --------------------------------------------------- desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b-2 border-black">
                  <th className="py-2 pr-3 font-black uppercase text-xs">Student</th>
                  <th className="py-2 pr-3 font-black uppercase text-xs">Course</th>
                  <th className="py-2 pr-3 font-black uppercase text-xs">Enrolled</th>
                  <th className="py-2 pr-3 font-black uppercase text-xs">Access</th>
                  <th className="py-2 font-black uppercase text-xs">Last login</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <StudentRow key={`${r.student_id}-${r.course_id}`} r={r} />
                ))}
              </tbody>
            </table>
          </div>

          {/* ---------------------------------------------------- mobile cards */}
          <div className="md:hidden flex flex-col gap-2">
            {filtered.map((r) => (
              <StudentCard key={`${r.student_id}-${r.course_id}`} r={r} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Shared derivation so the table and the cards cannot disagree. */
function useRowState(r) {
  const lapsed = r.expires_at && new Date(r.expires_at) <= new Date();
  const stale = daysSince(r.last_login);
  return {
    lapsed,
    accessLabel: r.expires_at
      ? (lapsed ? 'Expired' : new Date(r.expires_at).toLocaleDateString())
      : 'Lifetime',
    lastLogin: r.last_login ? ago(r.last_login) : 'Never',
    // Highlighted rather than merely stated: never, or quiet for a fortnight.
    // Both are the teacher's cue to reach out, which is the point of the column.
    lastLoginWarning: !r.last_login || (stale !== null && stale > 14),
  };
}

function StudentRow({ r }) {
  const { lapsed, accessLabel, lastLogin, lastLoginWarning } = useRowState(r);

  return (
    <tr className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
      <td className="py-2.5 pr-3">
        <div className="font-bold">{r.student_name}</div>
        <div className="text-xs text-gray-500 break-all">{r.student_email}</div>
        {r.student_phone && <div className="text-xs text-gray-500">{r.student_phone}</div>}
      </td>
      <td className="py-2.5 pr-3">
        <div className="font-medium">{r.course_title}</div>
        {r.parent_course_title && (
          <div className="text-xs text-gray-500">in {r.parent_course_title}</div>
        )}
        {r.class_level && (
          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full border border-black text-[10px] font-bold bg-[#F9E076]">
            {r.class_level}
          </span>
        )}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap" title={fullDate(r.enrolled_at)}>
        {r.enrolled_at ? new Date(r.enrolled_at).toLocaleDateString() : '—'}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <span className={`font-bold ${lapsed ? 'text-[#E63946]' : ''}`}>{accessLabel}</span>
      </td>
      <td className="py-2.5 whitespace-nowrap" title={fullDate(r.last_login)}>
        <span className={`font-bold ${lastLoginWarning ? 'text-[#F26B4D]' : ''}`}>{lastLogin}</span>
      </td>
    </tr>
  );
}

function StudentCard({ r }) {
  const { lapsed, accessLabel, lastLogin, lastLoginWarning } = useRowState(r);

  return (
    <div className="border-2 border-black rounded-xl p-3 bg-white shadow-[2px_2px_0px_0px_#111]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{r.student_name}</div>
          <div className="text-xs text-gray-500 break-all">{r.student_email}</div>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full border-2 border-black text-[10px] font-bold ${
            lastLoginWarning ? 'bg-[#F26B4D] text-white' : 'bg-[#A7E2D1]'
          }`}
          title={fullDate(r.last_login)}
        >
          {lastLogin}
        </span>
      </div>

      <div className="mt-2 text-xs font-medium">
        <span className="font-bold">{r.course_title}</span>
        {r.parent_course_title && <span className="text-gray-500"> · in {r.parent_course_title}</span>}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
        <span title={fullDate(r.enrolled_at)}>
          Enrolled {r.enrolled_at ? new Date(r.enrolled_at).toLocaleDateString() : '—'}
        </span>
        <span className={lapsed ? 'text-[#E63946] font-bold' : ''}>Access: {accessLabel}</span>
      </div>
    </div>
  );
}
