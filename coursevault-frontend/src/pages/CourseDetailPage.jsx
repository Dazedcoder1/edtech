import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Plus, Edit, Trash2, Users } from 'lucide-react';
import Badge from '../components/ui/Badge.jsx';
import CourseAccordion from '../components/course/CourseAccordion.jsx';
import MediaViewerModal from '../components/course/MediaViewerModal.jsx';
import CourseModal from '../components/educator/CourseModal.jsx';
import ModuleModal from '../components/educator/ModuleModal.jsx';
import ContentModal from '../components/educator/ContentModal.jsx';
import EnrollmentsModal from '../components/educator/EnrollmentsModal.jsx';
import { fetchAPI } from '../services/api.js';
import { getBgColor } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export default function CourseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [course, setCourse] = useState(null);
  const [modules, setModules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [expandedModules, setExpandedModules] = useState([]);
  const [activeContent, setActiveContent] = useState(null);

  // 🌟 PROGRESS TRACKING
  const [completedContentIds, setCompletedContentIds] = useState(new Set());
  const [courseProgress, setCourseProgress] = useState(0);

  const isCreator = user?.role === 'educator' && (course?.isCreator || user?.id === course?.educator_id);
  const canAccessContent = isCreator || isEnrolled;

  // Educator States
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [isModuleModalOpen, setIsModuleModalOpen] = useState(false);
  const [isContentModalOpen, setIsContentModalOpen] = useState(false);
  const [isEnrollmentsModalOpen, setIsEnrollmentsModalOpen] = useState(false);

  const [activeModuleId, setActiveModuleId] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [editingModule, setEditingModule] = useState(null);
  const [contentModalTab, setContentModalTab] = useState('pdf');

  /**
   * @param {{silent?: boolean}} [options]
   *   silent skips the full-page loading state. Reordering needs the fresh
   *   data (otherwise the new order is lost the moment the optimistic list is
   *   dropped) but must not blank the page behind a spinner on every click,
   *   which looked exactly like the page reloading.
   */
  const loadCourseData = async ({ silent = false } = {}) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchAPI(`/courses/${id}`);
      setCourse(data.course);
      setModules(data.modules || []);

      if (data.modules?.length > 0 && expandedModules.length === 0) {
        setExpandedModules([data.modules[0].id]);
      }

      const enrolled = user?.role === 'educator' ? true : !!data.course.isEnrolled;
      setIsEnrolled(enrolled);

      // 🌟 FIX: same stale-gate issue as onContentClick — always attempt to
      // load progress and let the backend's own checks decide what comes back.
      loadProgress(data.course.id);

    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // 🌟 PROGRESS TRACKING: bulk-fetch completed content ids + reuse the
  // enrollments endpoint's already-computed percentage for the header bar.
  const loadProgress = async (courseId) => {
    try {
      const [progressData, enrollmentsData] = await Promise.all([
        fetchAPI(`/video/progress/course/${courseId}`),
        fetchAPI('/enrollments')
      ]);

      setCompletedContentIds(new Set(progressData.completedContentIds || []));

      const mine = (enrollmentsData.enrollments || []).find(e => e.course_id === courseId);
      setCourseProgress(mine ? mine.progress : 0);
    } catch (err) {
      console.error('Failed to load progress', err);
    }
  };

  useEffect(() => { loadCourseData(); }, [id]);

  if (isLoading) return <div className="text-center font-bold py-20 text-gray-400">Loading...</div>;
  if (!course) return <div className="text-center font-bold py-20 text-red-500">Course not found.</div>;

  const isPublished = course.status === 'published';

  const handleTogglePublish = async () => {
    try {
      const newStatusStr = isPublished ? 'draft' : 'published';
      setCourse({ ...course, status: newStatusStr });

      await fetchAPI(`/courses/${course.id}/publish`, {
        method: 'PUT',
        body: JSON.stringify({ is_published: !isPublished })
      });

    } catch (err) {
      console.error("Failed to toggle publish status", err);
      setCourse({ ...course, status: isPublished ? 'published' : 'draft' });
      alert("Failed to update course status.");
    }
  };

  const handleEnroll = async () => {
    setIsEnrolling(true);
    try {
      const orderData = await fetchAPI('/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({ courseId: course.id })
      });

      if (orderData.isFree) {
        alert("Success! You have been enrolled in this free course.");
        setIsEnrolled(true);
        loadCourseData();
        setIsEnrolling(false);
        return;
      }

      const res = await loadRazorpayScript();
      if (!res) throw new Error("Razorpay SDK failed to load. Are you online?");

      const options = {
        key: orderData.keyId,
        amount: Math.round(orderData.amount * 100),
        currency: orderData.currency,
        name: "CourseVault.",
        description: `Enrollment: ${orderData.courseTitle}`,
        order_id: orderData.orderId,
        handler: async function (response) {
          try {
            const verifyRes = await fetchAPI('/payments/verify', {
              method: 'POST',
              body: JSON.stringify({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
                courseId: course.id
              })
            });

            if (verifyRes.success) {
              alert("Enrollment Successful! Welcome to the course.");
              setIsEnrolled(true);
              loadCourseData();
            }
          } catch (verifyErr) {
            alert(verifyErr.message || "Payment verification failed");
          }
        },
        prefill: {
          name: user?.name || "Student",
          email: user?.email || "student@coursevault.com",
        },
        theme: { color: "#F26B4D" }
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.open();

    } catch (err) {
      alert(err.message || "Enrollment initialization failed");
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!window.confirm('⚠️ Are you sure? This will delete all modules and content.')) return;
    try {
      await fetchAPI(`/courses/${course.id}`, { method: 'DELETE' });
      navigate(user?.role === 'educator' ? '/dashboard' : '/explore');
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleDeleteModule = async (moduleId) => {
    if (!window.confirm('⚠️ Delete this module?')) return;
    try {
      await fetchAPI(`/modules/${moduleId}`, { method: 'DELETE' });
      loadCourseData();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center justify-center w-9 h-9 md:w-auto md:h-auto mb-4 md:mb-8 bg-white border-2 border-black rounded-full md:rounded-lg md:px-4 md:py-2 font-bold text-xs uppercase tracking-widest shadow-[2px_2px_0px_0px_#111] hover:bg-[#F9E076] transition-colors"
      >
        <span className="md:hidden text-base leading-none normal-case">←</span>
        <span className="hidden md:inline">← Back</span>
      </button>

      <div className="relative mb-6 md:mb-12">
        <div className="absolute inset-0 bg-[#111] rounded-2xl md:rounded-[24px] translate-x-2 translate-y-2 md:translate-x-3 md:translate-y-3 z-0"></div>
        <div className={`relative z-10 ${getBgColor(course.id)} border-2 border-black rounded-2xl md:rounded-[24px] p-5 md:p-12 shadow-[4px_4px_0px_0px_#111]`}>
          <div className="flex justify-between items-start gap-2 mb-3 md:mb-6">
            <Badge colorClass="bg-white">{course.category || 'General'}</Badge>
            <div className="flex items-center gap-2 shrink-0">
              {isCreator && <Badge colorClass="bg-[#F9E076]">Creator View</Badge>}
              {/* Destructive, and rare — it does not belong in the row of
                  everyday actions where it was one mis-tap from Students. */}
              {isCreator && (
                <button
                  onClick={handleDeleteCourse}
                  title="Delete course"
                  aria-label="Delete course"
                  className="w-8 h-8 shrink-0 flex items-center justify-center bg-white text-red-500 border-2 border-black rounded-lg shadow-[2px_2px_0px_0px_#111] hover:bg-red-50 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                >
                  <Trash2 size={15} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
          <h1 className="text-2xl md:text-6xl font-black mb-2 md:mb-4">{course.title}</h1>
          <p className="text-sm md:text-lg font-bold text-black/70 mb-4 md:mb-8 max-w-2xl">{course.description}</p>

          {/*
            A 2-up grid on mobile, inline row from md.

            These were four buttons of four different heights: the shared
            Button component's base is `px-6 py-4 text-xl` and each caller
            passed `py-1.5 text-sm` to shrink it. Those are conflicting
            Tailwind utilities, so which one wins depends on the order they
            happen to appear in the generated stylesheet, not on the order in
            the className string. Sizing them here directly, on plain buttons,
            makes the result predictable and every button identical.
          */}
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-3">
            {isCreator ? (
              <>
                <button
                  onClick={handleTogglePublish}
                  className={`h-11 md:h-12 w-full md:w-auto md:px-5 flex items-center justify-center gap-2 px-3 text-sm md:text-base font-bold border-2 border-black rounded-xl shadow-[3px_3px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111] transition-all ${isPublished
                    ? "bg-[#A7E2D1] text-black"
                    : "bg-white text-gray-500"
                    }`}
                >
                  <div className={`w-2.5 h-2.5 shrink-0 rounded-full border-2 border-black ${isPublished ? "bg-[#F26B4D]" : "bg-gray-400"}`}></div>
                  {isPublished ? "Published" : "Draft"}
                </button>

                <button
                  onClick={() => setIsCourseModalOpen(true)}
                  className="h-11 md:h-12 w-full md:w-auto md:px-5 flex items-center justify-center gap-2 px-3 text-sm md:text-base font-bold border-2 border-black rounded-xl bg-[#A7E2D1] shadow-[3px_3px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111] transition-all"
                >
                  Edit
                </button>

                <button
                  onClick={() => { setEditingModule(null); setIsModuleModalOpen(true); }}
                  className="h-11 md:h-12 w-full md:w-auto md:px-5 flex items-center justify-center gap-2 px-3 text-sm md:text-base font-bold border-2 border-black rounded-xl bg-[#F26B4D] shadow-[3px_3px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111] transition-all"
                >
                  Add Module
                </button>

                <button
                  onClick={() => setIsEnrollmentsModalOpen(true)}
                  className="h-11 md:h-12 w-full md:w-auto md:px-5 flex items-center justify-center gap-2 px-3 text-sm md:text-base font-bold border-2 border-black rounded-xl bg-[#87CEFA] shadow-[3px_3px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111] transition-all"
                >
                  Students
                </button>
              </>
            ) : (
              // col-span-2 so the single student action fills the grid row
              // rather than sitting awkwardly in the left-hand cell.
              <button
                onClick={isEnrolled ? () => { } : handleEnroll}
                disabled={isEnrolling}
                className={`col-span-2 md:col-span-1 h-12 w-full md:w-auto md:px-10 flex items-center justify-center px-4 text-sm md:text-base font-bold border-2 border-black rounded-xl md:rounded-full bg-[#A7E2D1] shadow-[3px_3px_0px_0px_#111] transition-all ${
                  isEnrolling
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0px_0px_#111]'
                }`}
              >
                {isEnrolling ? 'Processing...' : isEnrolled ? 'Continue Learning' : `Enroll - ₹${course.price}`}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-8 gap-6">
        <h2 className="text-3xl font-black">Curriculum</h2>

        {isEnrolled && !isCreator && (
          <div className="flex items-center gap-3 flex-1 max-w-sm">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Your Progress</span>
                <span className="text-xs font-black">{courseProgress}%</span>
              </div>
              <div className="h-3 w-full bg-white border-2 border-black rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#A7E2D1] transition-all duration-500"
                  style={{ width: `${courseProgress}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-6">
        {modules.map((module, moduleIndex) => (
          <CourseAccordion
            key={module.id}
            module={module}
            // Position in the ordered list, not module_order. Deleting a module
            // leaves a gap in module_order (0, 1, 3), which would display as
            // "1, 2, 4". The index always renumbers to 1, 2, 3.
            moduleNumber={moduleIndex + 1}
            isOpen={expandedModules.includes(module.id)}
            onToggle={() => setExpandedModules(prev => prev.includes(module.id) ? prev.filter(m => m !== module.id) : [...prev, module.id])}

            // 🌟 DIRECT TRACKING INJECTION: Fires the exact second they click "Read" or "Take Quiz"
            onContentClick={(content) => {
              setActiveContent(content); // Opens the modal

              // 🌟 FIX: no client-side isEnrolled/role gate here anymore — it was
              // stale/false at click time and silently skipped the fetch entirely
              // (confirmed: zero /video/progress requests ever hit the backend).
              // The backend route already does its own proper authorization
              // (creator bypass, preview check, real enrollment check) and
              // returns a clean 403 if the click genuinely isn't authorized —
              // so we just always attempt it and let the response decide.
              const contentId = content.id || content.content_id;
              if (contentId && course?.id) {
                console.log('[progress] attempting save for', contentId, 'in course', course.id);

                // Reflect completion in the UI immediately, don't wait on the network
                setCompletedContentIds(prev => new Set(prev).add(contentId));

                fetchAPI('/video/progress', {
                  method: 'POST',
                  body: JSON.stringify({
                    contentId: contentId,
                    courseId: course.id,
                    position: 100,
                    is_completed: true
                  })
                })
                  .then((res) => {
                    console.log('[progress] saved', contentId, res);
                    loadProgress(course.id); // resync overall % from the server
                  })
                  .catch(err => {
                    // 🌟 Don't lie to the UI: if the save actually failed, undo the checkmark
                    console.error('[progress] FAILED to save for content', contentId, err);
                    setCompletedContentIds(prev => {
                      const next = new Set(prev);
                      next.delete(contentId);
                      return next;
                    });
                  });
              } else {
                console.warn('[progress] skipped — missing contentId or course.id', { contentId, courseId: course?.id });
              }
            }}

            completedContentIds={completedContentIds}
            onProgressRefresh={() => loadProgress(course.id)}
            isCreator={isCreator}
            onAddContent={(mId, fId) => { setActiveModuleId(mId); setActiveFolderId(fId); setContentModalTab('video'); setIsContentModalOpen(true); }}
            onAddPDF={(mId, fId) => { setActiveModuleId(mId); setActiveFolderId(fId); setContentModalTab('pdf'); setIsContentModalOpen(true); }}
            onEditModule={(mod) => { setEditingModule(mod); setIsModuleModalOpen(true); }}
            onDeleteModule={handleDeleteModule}
            courseId={course.id}
            isEnrolled={isEnrolled}
            onRefreshCurriculum={loadCourseData}
          />
        ))}
      </div>

      <MediaViewerModal
        content={activeContent}
        courseId={course.id}
        isEnrolled={canAccessContent}
        onClose={() => setActiveContent(null)}
      />

      {/* Educator Modals */}
      <CourseModal isOpen={isCourseModalOpen} onClose={() => setIsCourseModalOpen(false)} course={course} onSave={loadCourseData} />
      <ModuleModal isOpen={isModuleModalOpen} onClose={() => setIsModuleModalOpen(false)} courseId={course.id} module={editingModule} onSave={loadCourseData} />

      <ContentModal
        isOpen={isContentModalOpen}
        onClose={() => setIsContentModalOpen(false)}
        moduleId={activeModuleId}
        folderId={activeFolderId}
        onSave={loadCourseData}
        initialTab={contentModalTab}
      />
      <EnrollmentsModal isOpen={isEnrollmentsModalOpen} onClose={() => setIsEnrollmentsModalOpen(false)} courseId={course.id} courseTitle={course.title} />
    </div>
  );
}