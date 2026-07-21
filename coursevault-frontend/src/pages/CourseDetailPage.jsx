import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Plus, Edit, Trash2, Users } from 'lucide-react';
import Button from '../components/ui/Button.jsx';
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
  
  const isCreator = user?.role === 'educator' && (course?.isCreator || user?.id === course?.educator_id);
  const canAccessContent = isCreator || isEnrolled;
  
  // Educator States
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [isModuleModalOpen, setIsModuleModalOpen] = useState(false);
  const [isContentModalOpen, setIsContentModalOpen] = useState(false);
  const [isEnrollmentsModalOpen, setIsEnrollmentsModalOpen] = useState(false);
  
  const [activeModuleId, setActiveModuleId] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null); // Tracks target tab
  const [editingModule, setEditingModule] = useState(null);
  const [contentModalTab, setContentModalTab] = useState('pdf');

  const loadCourseData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAPI(`/courses/${id}`);
      setCourse(data.course);
      setModules(data.modules || []);
      
      if (data.modules?.length > 0 && expandedModules.length === 0) {
          setExpandedModules([data.modules[0].id]);
      }

      if (user?.role === 'educator') {
          setIsEnrolled(true);
      } else {
          setIsEnrolled(!!data.course.isEnrolled);
      }
      
    } catch (err) {
        console.error(err);
    } finally {
      setIsLoading(false);
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
    setIsEnrolling(true); // 🌟 FIX: Updated function reference from setIsRunning to setIsEnrolling
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

    } catch(err) {
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
    <div className="flex justify-between items-start mb-3 md:mb-6">
       <Badge colorClass="bg-white">{course.category || 'General'}</Badge>
       {isCreator && <Badge colorClass="bg-[#F9E076]">Creator View</Badge>}
    </div>
    <h1 className="text-2xl md:text-6xl font-black mb-2 md:mb-4">{course.title}</h1>
    <p className="text-sm md:text-lg font-bold text-black/70 mb-4 md:mb-8 max-w-2xl">{course.description}</p>
    
    <div className="flex flex-wrap gap-2 md:gap-3">
      {isCreator ? (
         <>
           <button
             onClick={handleTogglePublish}
             className={`px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base font-bold border-2 md:border-[3px] border-black rounded-lg md:rounded-xl shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#111] transition-all flex items-center gap-2 ${
               isPublished 
                 ? "bg-[#A7E2D1] text-black" 
                 : "bg-white text-gray-500" 
             }`}
           >
             <div className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full border-2 border-black ${isPublished ? "bg-[#F26B4D]" : "bg-gray-400"}`}></div>
             {isPublished ? "Published" : "Draft"}
           </button>

           <Button variant="secondary" onClick={() => setIsCourseModalOpen(true)} className="px-4 md:px-6 py-1.5 md:py-2 text-sm md:text-base rounded-lg md:rounded-xl border-2 md:border-[3px]">Edit</Button>
           <Button variant="accent" onClick={() => {setEditingModule(null); setIsModuleModalOpen(true);}} className="px-4 md:px-6 py-1.5 md:py-2 text-sm md:text-base rounded-lg md:rounded-xl border-2 md:border-[3px]">Add Module</Button>
           <Button variant="primary" onClick={() => setIsEnrollmentsModalOpen(true)} className="px-4 md:px-6 py-1.5 md:py-2 text-sm md:text-base rounded-lg md:rounded-xl border-2 md:border-[3px] bg-[#87CEFA]">Students</Button>
           
           <button onClick={handleDeleteCourse} className="px-4 py-1.5 md:px-6 md:py-4 border-2 md:border-[3px] border-black rounded-lg md:rounded-xl font-bold bg-white text-red-500 hover:bg-red-50 shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#111]">
             <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
         </>
      ) : (
       <Button 
  variant="secondary" 
  onClick={isEnrolled ? () => {} : handleEnroll} 
  disabled={isEnrolling}
  className="px-4 md:px-10 py-2 md:py-3 text-xs md:text-base rounded-lg md:rounded-full border-2 md:border-[3px] w-auto"
>
  {isEnrolling ? 'Processing...' : isEnrolled ? 'Continue Learning' : `Enroll - ₹${course.price}`}
</Button>
      )}
    </div>
  </div>
</div>

      <h2 className="text-3xl font-black mb-8">Curriculum</h2>
      <div className="flex flex-col gap-6">
        {modules.map((module) => (
          <CourseAccordion 
            key={module.id} 
            module={module}
            isOpen={expandedModules.includes(module.id)}
            onToggle={() => setExpandedModules(prev => prev.includes(module.id) ? prev.filter(m => m !== module.id) : [...prev, module.id])}
            onContentClick={setActiveContent}
            isCreator={isCreator}
            
            // 🌟 Capture both module ID and active folder ID from the accordion
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
      
      {/* 🌟 Pass the folderId down into your ContentModal */}
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