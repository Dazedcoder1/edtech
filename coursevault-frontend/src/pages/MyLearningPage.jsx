import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// Aliased: importing it as `Infinity` would shadow the JS global inside this
// module, which is a trap waiting for the first numeric comparison added here.
import { Infinity as InfinityIcon } from 'lucide-react';
import CourseCard from '../components/course/CourseCard.jsx';
import { fetchAPI } from '../services/api.js';

export default function MyLearningPage() {
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchEnrollments = async () => {
      try {
        const data = await fetchAPI('/enrollments');
        if (data.success) {
          setEnrollments(data.enrollments || []);
        }
      } catch (error) {
        console.error("Failed to fetch enrollments:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEnrollments();
  }, []);

  const handleBuyCourse = (courseId) => {
    console.log('Buy course:', courseId);
  };

  return (
    <div className="pb-20">
      <h2 className="text-4xl font-bold tracking-tight mb-8">Continue Learning</h2>

      {isLoading ? (
        <div className="text-center font-bold py-20 text-gray-400">Loading your courses...</div>
      ) : enrollments.length === 0 ? (
        <div className="text-center font-bold py-20 text-gray-500 border-2 border-dashed border-gray-300 rounded-xl">
          You haven't enrolled in any courses yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-3 md:gap-y-16 items-start">
          {enrollments.map((item, index) => {
            /*
             * Timed access needs to be visible before it bites. A student who
             * simply finds the course stopped opening one day has no way to
             * tell a broken app from a lapsed purchase.
             */
            const expiresAt = item.expires_at ? new Date(item.expires_at) : null;
            const hasExpired = expiresAt && expiresAt <= new Date();
            const daysLeft = expiresAt
              ? Math.ceil((expiresAt - new Date()) / 86400000)
              : null;

            return (
            <div key={item.enrollment_id}>
              {/*
                Every card states its access type, including lifetime ones.
                A blank space where other cards show a date reads as missing
                information rather than as "this one never expires".
              */}
              <div
                className={`flex items-center gap-1.5 mb-1.5 px-2 py-1 border-2 border-black rounded-lg text-[11px] font-black uppercase tracking-wide ${
                  !expiresAt
                    ? 'bg-[#A7E2D1] text-black'
                    : hasExpired
                    ? 'bg-[#F26B4D] text-white'
                    : daysLeft <= 14
                    ? 'bg-[#F9E076]'
                    : 'bg-white text-gray-600'
                }`}
              >
                {!expiresAt ? (
                  <>
                    <InfinityIcon size={13} strokeWidth={3} className="shrink-0" />
                    Lifetime access
                  </>
                ) : hasExpired ? (
                  `Expired ${expiresAt.toLocaleDateString()} — renew to continue`
                ) : daysLeft <= 14 ? (
                  `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
                ) : (
                  `Access until ${expiresAt.toLocaleDateString()}`
                )}
              </div>
            <CourseCard
              course={{
                ...item,
                id: item.course_id,
                title: item.course_title,
                description: item.course_description,
                educator_name: item.educator_name,
                price: item.course_price,
                status: item.course_status,
                progress: item.progress || 0,
                thumbnail_url: item.thumbnail_url
              }}
              index={index}
              isMyLearning={true}
              onClick={(courseId) => navigate(`/course/${courseId}`)}
              onBuyCourse={handleBuyCourse}
            />
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}