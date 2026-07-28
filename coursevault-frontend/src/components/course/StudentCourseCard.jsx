import React from 'react';
import CircularProgress from '../ui/CircularProgress.jsx';

export default function StudentCourseCard({ course, index, onClick }) {
  const { id, title, description, educator_name, progress, thumbnail_url } = course;
  
  return (
    <div 
      onClick={() => onClick(id)}
      className="relative bg-[#f8f9fa] border-[3px] border-black rounded-2xl p-4 cursor-pointer hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#111] transition-all duration-200 flex flex-col h-full"
    >
      {/* Thumbnail Area with Progress Ring */}
      <div className="w-full h-40 bg-[#e9ecef] border-2 border-black rounded-xl mb-4 overflow-hidden flex items-center justify-center relative">
        {thumbnail_url ? (
          <img src={thumbnail_url} alt={title} className="object-cover w-full h-full" />
        ) : (
          <span className="text-5xl">📚</span>
        )}
        
        {/* The Circular Progress Ring */}
        <div className="absolute top-2 right-2 bg-white p-1 rounded-full border-2 border-black shadow-[2px_2px_0px_0px_#111]">
          <CircularProgress size="small" percentage={progress || 0} color="#F26B4D" />
        </div>
      </div>
      
      {/* Course Info */}
      <div className="flex-grow">
        <h3 className="font-bold text-lg mb-1 line-clamp-2 text-black">{title}</h3>
        <p className="text-xs text-gray-600 mb-2 font-semibold">by {educator_name}</p>
        <p className="text-sm text-gray-700 line-clamp-2">{description || "No description provided."}</p>
      </div>
      
      {/* Footer / Action */}
      <div className="mt-4 pt-4 border-t-2 border-dashed border-gray-300 flex justify-between items-center">
        <span className="font-bold text-xs bg-[#A7E2D1] px-3 py-1 rounded-full border border-black">Enrolled</span>
        <button className="bg-[#F26B4D] text-black border-2 border-black px-4 py-2 rounded-xl font-bold text-sm shadow-[2px_2px_0px_0px_#111] hover:bg-[#f97316] transition-colors">
          Continue ▶
        </button>
      </div>
    </div>
  );
}