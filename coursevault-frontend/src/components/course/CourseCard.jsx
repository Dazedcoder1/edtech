import React from 'react';
import { Play, BookOpen, Lock } from 'lucide-react';
import Badge from '../ui/Badge.jsx';
import { getBgColor, getTagColor } from '../../utils/format.js';

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

      <div className="relative bg-white border border-black shadow-[2px_2px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111] rounded-xl overflow-hidden z-10 flex flex-col h-auto md:h-[480px] transition-transform duration-300 md:group-hover:translate-x-1 md:group-hover:-translate-y-1">
        
        <div className={`h-[120px] md:h-[200px] w-full border-b border-black ${bgColor} flex items-center justify-center relative overflow-hidden`}>
          <BookOpen size={28} className="md:hidden text-black/20" />
          <BookOpen size={48} className="hidden md:block text-black/20" />
          
          <div className="absolute top-3 right-3 md:top-4 md:right-4 bg-white border border-black rounded-full px-2.5 py-0.5 md:px-3 md:py-1 text-[10px] md:text-xs font-bold shadow-[2px_2px_0px_0px_#111] flex items-center gap-1">
            {isMyLearning ? (
              `${course.progress || 0}% Done`
            ) : isPaid ? (
              <>
                {needsPurchase && <Lock size={10} className="md:w-3 md:h-3" />}
                {formatPrice(course.price)}
              </>
            ) : (
              'Free'
            )}
          </div>

          <div className="absolute top-3 left-3 md:top-4 md:left-4 bg-black text-white px-2.5 py-0.5 md:px-3 md:py-1 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-wider">
            {course.status || 'published'}
          </div>
        </div>

        <div className="p-3 md:p-6 flex flex-col flex-1 relative">
          <div className="mb-1.5 md:mb-4">
            <Badge colorClass={tagColor}>{course.category || 'General'}</Badge>
          </div>
          <h3 className="text-sm md:text-2xl font-bold leading-tight mb-0.5 md:mb-2 pr-2 line-clamp-2">{course.title}</h3>
          <p className="flex items-center gap-1.5 text-gray-600 font-bold text-[11px] md:text-sm mb-2 md:mb-4">
  <span className="inline-flex items-center justify-center w-5 h-5 md:w-6 md:h-6 rounded-full bg-[#F9E076] border border-black text-[10px] md:text-xs">
    🧑‍🏫
  </span>
  {course.educator_name && course.educator_name.toLowerCase() !== 'anon' 
    ? `Taught by ${course.educator_name}` 
    : 'Taught by Shardha Vidyapeeth'}
</p>

          <div className="mt-auto flex justify-end items-end">
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
          </div>
        </div>
      </div>
    </div>
  );
}