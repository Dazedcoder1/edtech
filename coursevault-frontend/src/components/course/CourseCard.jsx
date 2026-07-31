import React from 'react';
import { Play, BookOpen, Lock } from 'lucide-react';
import Badge from '../ui/Badge.jsx';
import CircularProgress from '../ui/CircularProgress.jsx'; // <-- Imported the ring!
import { getBgColor, getTagColor } from '../../utils/format.js';
import { resolveMediaUrl } from '../../services/api.js';

const formatPrice = (price) =>
  `₹${Number(price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function CourseCard({ course, index, onClick, onBuyCourse, isMyLearning }) {
  const bgColor = getBgColor(course.id);
  const tagColor = getTagColor(course.id);

  const isPaid = course.price > 0;
  const isPurchased = isMyLearning || course.is_purchased;
  const needsPurchase = isPaid && !isPurchased;

  const handleCtaClick = (e) => {
    e.stopPropagation();
    if (needsPurchase) {
      onBuyCourse?.(course.id);
    } else {
      onClick(course.id);
    }
  };

  return (
    <div
      onClick={() => onClick(course.id)}
      className={`relative group w-full max-w-[400px] mx-auto xl:mx-0 cursor-pointer
        ${index % 3 === 0 ? 'xl:mt-12' : index % 3 === 1 ? 'xl:mt-0' : 'xl:mt-24'}`}
    >
      <div className="hidden md:block absolute inset-0 bg-[#932973] border border-black rounded-xl transition-all duration-300 group-hover:-translate-x-5 group-hover:translate-y-5 z-0"></div>
      <div className="hidden md:block absolute inset-0 bg-[#F26B4D] border border-black rounded-xl transition-all duration-300 group-hover:-translate-x-2.5 group-hover:translate-y-2.5 z-0"></div>

      {/* Mobile is a compact horizontal row; md+ keeps the tall poster.
          Stacked full-height posters meant barely one card fitted on a phone
          screen, so browsing a course list was almost all scrolling. Borders
          and shadows are lighter below md so a dense list does not look heavy. */}
      <div className="relative bg-white border border-black/60 md:border-black shadow-[1px_1px_0px_0px_#111]/50 md:shadow-[4px_4px_0px_0px_#111] rounded-xl overflow-hidden z-10 flex flex-row md:flex-col h-auto md:h-[480px] transition-transform duration-300 md:group-hover:translate-x-1 md:group-hover:-translate-y-1">

        {/* THUMBNAIL AREA */}
        <div className={`w-[104px] h-[104px] shrink-0 md:w-full md:h-[200px] border-r md:border-r-0 md:border-b border-black/60 md:border-black ${bgColor} flex items-center justify-center relative overflow-hidden`}>
          {course.thumbnail_url ? (
            <img
              src={resolveMediaUrl(course.thumbnail_url)}
              alt={course.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              // A stored URL that 404s would otherwise show the browser's
              // broken-image glyph, which looks identical to "no thumbnail set"
              // and hides the fact that something is actually wrong.
              onError={(e) => {
                console.warn('[CourseCard] thumbnail failed to load', {
                  course: course.title,
                  url: course.thumbnail_url,
                });
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <>
              <BookOpen size={28} className="md:hidden text-black/20" />
              <BookOpen size={48} className="hidden md:block text-black/20" />
            </>
          )}

          {/* TOP RIGHT BADGE: Shows Ring if My Learning, Price if Explore */}
          {isMyLearning ? (
            <div className="absolute top-1 right-1 md:top-4 md:right-4 bg-white rounded-full border-2 border-black md:shadow-[2px_2px_0px_0px_#111] z-10 p-0.5 scale-75 md:scale-100">
              {/* Shrink size slightly to fit nicely in the corner */}
              <CircularProgress size="small" percentage={course.progress || 0} color="#F26B4D" />
            </div>
          ) : (
            <div className="absolute bottom-1 right-1 md:bottom-auto md:top-4 md:right-4 bg-white border border-black rounded-full px-1.5 py-0.5 md:px-3 md:py-1 text-[9px] md:text-xs font-bold md:shadow-[2px_2px_0px_0px_#111] flex items-center gap-1 z-10">
              {isPaid ? (
                <>
                  {needsPurchase && <Lock size={10} className="md:w-3 md:h-3" />}
                  {formatPrice(course.price)}
                </>
              ) : (
                'Free'
              )}
            </div>
          )}

          <div className="hidden md:block absolute md:top-4 md:left-4 bg-black text-white md:px-3 md:py-1 rounded-full md:text-[10px] font-bold uppercase tracking-wider z-10">
            {course.status || 'published'}
          </div>
        </div>

        {/* BOTTOM CONTENT AREA */}
        <div className="p-2.5 md:p-6 flex flex-col flex-1 min-w-0 relative">
          <div className="hidden md:block mb-4">
            <Badge colorClass={tagColor}>{course.category || 'General'}</Badge>
          </div>
          <h3 className="text-sm md:text-2xl font-bold leading-tight mb-0.5 md:mb-2 pr-1 line-clamp-2">{course.title}</h3>
          <p className="flex items-center gap-1.5 text-gray-600 font-bold text-[11px] md:text-sm mb-1 md:mb-4 min-w-0">
            <span className="inline-flex items-center justify-center w-5 h-5 md:w-6 md:h-6 rounded-full bg-[#F9E076] border border-black text-[10px] md:text-xs">
              🧑‍🏫
            </span>
            <span className="truncate">
              {course.educator_name && course.educator_name.toLowerCase() !== 'anon'
                ? `Taught by ${course.educator_name}`
                : 'Taught by Shardha Vidyapeeth'}
            </span>
          </p>

          <div className="mt-auto flex justify-between md:justify-end items-center md:items-end gap-2">
            {/* CTA BUTTON: Shows Start/Continue pill if My Learning, Round Play if Explore */}
            {/* The status pill is hidden on mobile to save the row; surface it
                as small text instead so the state is still visible. */}
            <span className="md:hidden text-[9px] font-black uppercase tracking-wider text-gray-400">
              {course.status || 'published'}
            </span>

            {isMyLearning ? (
              <button
                onClick={handleCtaClick}
                className="flex items-center gap-1.5 md:gap-2 bg-[#F26B4D] border-2 border-black px-3 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl font-bold text-xs md:text-sm md:shadow-[2px_2px_0px_0px_#111] hover:bg-[#f97316] transition-transform md:group-hover:scale-105 z-20 text-black shrink-0"
              >
                {course.progress > 0 ? 'Continue' : 'Start'}
                <Play fill="black" size={16} className="text-black" />
              </button>
            ) : (
              <button
                onClick={handleCtaClick}
                className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-[#F26B4D] border-2 border-black flex items-center justify-center z-20 transition-transform md:group-hover:scale-110 shadow-[1px_1px_0px_0px_#111] md:shadow-[2px_2px_0px_0px_#111]"
              >
                {needsPurchase && (
                  <Lock size={11} className="absolute -top-1 -right-1 bg-black text-white rounded-full p-0.5 md:w-4 md:h-4" />
                )}
                <Play fill="black" size={13} className="md:hidden ml-0.5 text-black" />
                <Play fill="black" size={20} className="hidden md:block ml-1 text-black" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}