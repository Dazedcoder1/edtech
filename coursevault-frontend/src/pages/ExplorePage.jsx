import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Microscope } from 'lucide-react';
import CourseCard from '../components/course/CourseCard';
import { fetchAPI } from '../services/api';

export default function ExplorePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Read selected parent class from the URL instead of local state
  const selectedParentId = searchParams.get('class');

  useEffect(() => {
    fetchAPI('/courses')
      .then(data => {
        setCourses(data.courses || []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to load courses", err);
        setIsLoading(false);
      });
  }, []);

  const getClassNumber = (title = '') => {
    const match = title.match(/(\d+)\s*(?:st|nd|rd|th)?\s*Class/i);
    return match ? parseInt(match[1], 10) : null;
  };

  const topLevelCourses = courses
    .filter(c => !c.parent_course_id)
    .sort((a, b) => {
      const numA = getClassNumber(a.title);
      const numB = getClassNumber(b.title);

      if (numA !== null && numB !== null) return numA - numB;
      if (numA !== null) return -1;
      if (numB !== null) return 1;
      return (a.title || '').localeCompare(b.title || '');
    });

  const childCourses = selectedParentId 
    ? courses.filter(c => c.parent_course_id === selectedParentId)
    : [];

  const selectedParentCourse = courses.find(c => c.id === selectedParentId);

  return (
    <>
      <header className="relative pt-2 md:pt-10 pb-2 md:pb-20 text-center flex flex-col items-center justify-center">
        <div className="hidden md:block absolute top-0 left-10 text-black animate-float-icon">
          <Bot size={40} strokeWidth={1.5} />
        </div>
        <div className="hidden md:block absolute top-10 right-20 text-black animate-float-icon" style={{ animationDelay: '1s' }}>
          <Microscope size={40} strokeWidth={1.5} />
        </div>

        <h1 className="hidden md:block text-4xl md:text-7xl font-bold leading-[1.15] md:leading-[1.1] tracking-tight relative z-10 max-w-4xl">
          Educational content <br /> for curious minds.
        </h1>
      </header>

      <div className="pb-20">
        {isLoading ? (
          <div className="text-center text-gray-500 font-bold py-10">Loading courses...</div>
        ) : courses.length === 0 ? (
          <div className="text-center text-gray-500 font-bold py-10">No courses published yet.</div>
        ) : (
          <>
            {!selectedParentId ? (
              /* =========================================
                 VIEW 1: SHOW PARENT CATEGORIES ONLY
                 ========================================= */
              <>
                <h2 className="text-4xl font-bold tracking-tight mb-8">All Classes</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-2 md:gap-y-16 items-start animate-in fade-in zoom-in-95 duration-300">
                  {topLevelCourses.map((course, index) => (
                    <CourseCard 
                      key={course.id} 
                      course={course} 
                      index={index} 
                      isMyLearning={false}
                      onClick={() => setSearchParams({ class: course.id })} 
                    />
                  ))}
                </div>
              </>
            ) : (
              /* =========================================
                 VIEW 2: SHOW SUBJECTS INSIDE CATEGORY
                 ========================================= */
              <div className="animate-in slide-in-from-right-8 fade-in duration-300">

                {/* Navigation Header */}
                <div className="flex items-center gap-3 mb-4 md:mb-8">
                  <button 
                    onClick={() => setSearchParams({})}
                    className="flex-shrink-0 flex items-center justify-center w-9 h-9 md:w-auto md:h-auto md:px-4 md:py-2 bg-white border-2 border-black rounded-full md:rounded-lg font-bold hover:bg-[#F9E076] transition-colors shadow-[2px_2px_0px_0px_#111]"
                  >
                    <span className="md:hidden text-lg leading-none">←</span>
                    <span className="hidden md:inline">← Back to All Classes</span>
                  </button>
                  <h2 className="text-2xl md:text-3xl font-black">
                    {selectedParentCourse?.title} Subjects
                  </h2>
                </div>

                {/* The Subjects Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-2 md:gap-y-16 items-start">
                  {childCourses.length === 0 ? (
                    <div className="col-span-full bg-white border-2 border-dashed border-black rounded-xl p-12 text-center text-gray-500 font-bold text-lg shadow-[4px_4px_0px_0px_#111]">
                      No subjects published in this class yet.
                    </div>
                  ) : (
                    childCourses.map((child, i) => (
                      <CourseCard
                        key={child.id}
                        course={child}
                        index={i}
                        isMyLearning={false}
                        onClick={(id) => navigate(`/course/${id}`)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}