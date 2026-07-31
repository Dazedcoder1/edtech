import React, { useState, useEffect } from 'react';
import { X, Users, Mail } from 'lucide-react';
import { fetchAPI } from '../../services/api';

export default function EnrollmentsModal({ isOpen, onClose, courseId, courseTitle }) {
  const [students, setStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !courseId) return;

    setIsLoading(true);
    setError('');

    // The route is /enrollments/courses/:courseId/enrollments. The previous
    // path — /enrollments/course/:courseId — matched nothing (singular
    // "course", and one segment short), so this 404'd on every open.
    fetchAPI(`/enrollments/courses/${courseId}/enrollments`)
      .then(data => {
        // The endpoint returns `students`, not `enrollments`.
        setStudents(data.students || []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to load students", err);
        // Showing "no students enrolled" on a failed request is worse than an
        // error: it reads as a fact about the course rather than a broken call.
        setError(err.message || 'Could not load the student list.');
        setIsLoading(false);
      });
  }, [isOpen, courseId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-white border-[3px] border-black rounded-2xl flex flex-col shadow-[8px_8px_0px_0px_#111] max-h-[80vh]">
        <div className="flex justify-between items-center p-4 border-b-[3px] border-black bg-[#A7E2D1] rounded-t-xl">
          <h3 className="font-bold text-2xl flex items-center gap-2">
            <Users /> Enrolled Students
          </h3>
          <button onClick={onClose} className="w-8 h-8 border-[3px] border-black bg-[#F26B4D] rounded-full flex items-center justify-center font-bold hover:scale-110">
            <X size={16} strokeWidth={3} />
          </button>
        </div>
        
        <div className="flex-1 min-h-0 p-4 md:p-6 overflow-y-auto bg-[#F4DFD8] rounded-b-xl">
          <div className="mb-6">
             <h4 className="font-bold text-lg mb-1">{courseTitle}</h4>
             <p className="text-gray-600 font-bold">{students.length} Total Student(s)</p>
          </div>

          {isLoading ? (
            <div className="text-center py-10 font-bold text-gray-500">Loading student list...</div>
          ) : error ? (
            <div className="text-center py-8 px-4 font-bold text-red-800 bg-red-50 border-2 border-red-400 rounded-xl">
              <div>Could not load the student list.</div>
              <div className="font-medium text-sm mt-1">{error}</div>
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-10 font-bold text-gray-500 bg-white border-2 border-black rounded-xl border-dashed">
              No students enrolled in this course yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {students.map((student) => {
                // The API returns student_name / student_email. The older
                // user_name / user_email keys are kept as a fallback so this
                // still renders if another endpoint feeds the same component.
                const name = student.student_name || student.user_name || 'Student';
                const email = student.student_email || student.user_email;
                return (
                  <div
                    key={student.enrollment_id || student.user_id}
                    className="bg-white border-2 border-black rounded-xl p-4 flex items-center justify-between shadow-[2px_2px_0px_0px_#111]"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 shrink-0 bg-[#F9E076] border-2 border-black rounded-full flex items-center justify-center font-bold">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-lg leading-tight truncate">{name}</div>
                        <div className="text-sm font-medium text-gray-500 flex items-center gap-1 mt-1 truncate">
                          <Mail size={12} className="shrink-0" /> {email || 'No email'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-bold shrink-0 ml-3">
                      <div className="text-xs text-gray-500 uppercase">Enrolled</div>
                      <div>
                        {student.enrolled_at
                          ? new Date(student.enrolled_at).toLocaleDateString()
                          : '—'}
                      </div>
                      {typeof student.progress === 'number' && (
                        <div className="text-xs text-gray-500 mt-0.5">{student.progress}% done</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}