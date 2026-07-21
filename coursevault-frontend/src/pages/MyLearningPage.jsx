import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
          {enrollments.map((item, index) => (
            <CourseCard 
              key={item.enrollment_id} 
              
              // Map the custom backend fields to standard fields CourseCard expects
              course={{
                ...item,
                id: item.course_id,               // Fixes the 500 UUID error
                title: item.course_title,
                description: item.course_description,
                educator_name: item.educator_name,
                price: item.course_price,
                status: item.course_status,
                progress: item.progress || 0      // Powers the progress bar
              }} 
              
              index={index} 
              isMyLearning={true}
              onClick={(courseId) => navigate(`/course/${courseId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}