import React, { useState, useEffect, useRef } from 'react';
import { X, Loader } from 'lucide-react';
import { fetchAPI } from '../../services/api.js';
import Hls from 'hls.js';

export default function MediaViewerModal({ content, courseId, isEnrolled, onClose }) {
  const [loading, setLoading] = useState(true);
  const [streamUrl, setStreamUrl] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [error, setError] = useState(null);
  const [savedPosition, setSavedPosition] = useState(0);
  
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const currentPosRef = useRef(0);

  const targetContentId = content?.id;
  const rawContentType = content?.content_type || '';
  const type = String(rawContentType).toLowerCase();

  useEffect(() => {
    if (!targetContentId) return;
    
    let isCancelled = false;
    setLoading(true);
    setStreamUrl(null);
    setPdfUrl(null);
    setError(null);

    const initMedia = async () => {
      try {
        if (type.includes('video')) {
          const streamData = await fetchAPI(`/content/${targetContentId}/stream?courseId=${courseId || ''}`);
          
          let initialPos = 0;
          if (courseId && isEnrolled) {
            try {
              const progressData = await fetchAPI(`/video/progress/${targetContentId}`);
              if (progressData.hasProgress) {
                initialPos = parseFloat(progressData.position);
              }
            } catch (_) {}
          }

          if (isCancelled) return;
          
          setSavedPosition(initialPos);
          currentPosRef.current = initialPos;

          if (streamData.hlsUrl) {
            const token = localStorage.getItem('token');
            const backendDomain = (import.meta && import.meta.env && import.meta.env.VITE_API_URL) 
              ? import.meta.env.VITE_API_URL.replace('/api', '') 
              : 'http://localhost:3000';
            
            setStreamUrl(`${backendDomain}${streamData.hlsUrl}&token=${token}`);
            setLoading(false); 
          } else {
            throw new Error(streamData.message || 'Video processing is pending.');
          }

        } else if (type.includes('pdf') || type.includes('document')) {
          const token = localStorage.getItem('token');
          const baseUrl = (import.meta && import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:3000/api';

          const response = await fetch(`${baseUrl}/content/${targetContentId}/pdf?courseId=${courseId || ''}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to fetch PDF');
          }

          const rawBlob = await response.blob();
          if (isCancelled) return;

          const pdfBlob = new Blob([rawBlob], { type: 'application/pdf' });
          const objectUrl = URL.createObjectURL(pdfBlob);
          
          setPdfUrl(`${objectUrl}#toolbar=0&navpanes=0&scrollbar=0`);
          setLoading(false); 
          
        } else {
          throw new Error(`Unknown content type configuration: "${rawContentType}"`);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load media:', err);
          setError(err.message || 'Failed to load content');
          setLoading(false);
        }
      }
    };

    initMedia();
    
    return () => {
      isCancelled = true;
    };
  }, [targetContentId, type, courseId, isEnrolled]);

  useEffect(() => {
    if (!streamUrl || !videoRef.current || !type.includes('video')) return;

    const videoEl = videoRef.current;
    const syncTime = () => {
      currentPosRef.current = videoEl.currentTime;
    };
    videoEl.addEventListener('timeupdate', syncTime);

    if (Hls.isSupported()) {
      const hls = new Hls({ maxMaxBufferLength: 30 });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(videoEl);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (savedPosition > 0) videoEl.currentTime = savedPosition;
        videoEl.play().catch(e => console.log("Auto-play blocked:", e));
      });

      return () => {
        videoEl.removeEventListener('timeupdate', syncTime);
        hls.destroy();
      };
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = streamUrl;
      
      const handleMetadata = () => {
        if (savedPosition > 0) videoEl.currentTime = savedPosition;
        videoEl.play().catch(e => console.log("Auto-play blocked:", e));
      };
      
      videoEl.addEventListener('loadedmetadata', handleMetadata);
      return () => {
        videoEl.removeEventListener('timeupdate', syncTime);
        videoEl.removeEventListener('loadedmetadata', handleMetadata);
      };
    }
  }, [streamUrl, savedPosition, type]);

  useEffect(() => {
    if (!targetContentId || !type.includes('video') || !courseId || !isEnrolled) return;

    const saveProgressToDB = async (posToSave) => {
      const currentPos = Math.round(posToSave);
      if (currentPos <= 0) return;

      try {
        await fetchAPI('/video/progress', {
          method: 'POST',
          body: JSON.stringify({ contentId: targetContentId, courseId, position: currentPos }),
        });
      } catch (err) {
        console.error(`Analytics sync failure:`, err.message);
      }
    };

    const intervalId = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        saveProgressToDB(currentPosRef.current);
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
      if (currentPosRef.current > 0) {
        saveProgressToDB(currentPosRef.current);
      }
    };
  }, [targetContentId, type, courseId, isEnrolled]);

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        const rawBlobUrl = pdfUrl.split('#')[0];
        URL.revokeObjectURL(rawBlobUrl);
      }
    };
  }, [pdfUrl]);

  if (!content || !content.id) return null;
  
  const isVideo = type.includes('video');
  const isPdf = type.includes('pdf') || type.includes('document');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full h-full md:h-auto max-w-5xl bg-white border-0 md:border-[3px] border-black rounded-none md:rounded-[24px] shadow-none md:shadow-[8px_8px_0px_0px_#111] overflow-hidden flex flex-col max-h-full md:max-h-[90vh]">
        
        <div className="flex justify-between items-center p-3 md:p-4 border-b-2 md:border-b-[3px] border-black bg-[#A7E2D1]">
          <h3 className="font-black text-sm md:text-xl tracking-tight uppercase line-clamp-1 pr-2">
            {content.title || 'Viewing Asset File'}
          </h3>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 border-2 md:border-[3px] border-black bg-[#F26B4D] rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#111] outline-none"
          >
            <X size={16} strokeWidth={3} className="md:w-5 md:h-5" />
          </button>
        </div>
        
        <div className="flex-1 bg-[#F4F4F4] relative overflow-hidden flex items-center justify-center min-h-0 md:min-h-[60vh]">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center font-bold text-gray-500 gap-3 bg-[#F4F4F4] z-50 text-sm md:text-base text-center px-4">
              <Loader className="animate-spin text-[#F26B4D]" size={32} strokeWidth={3} />
              Mounting secure media stream...
            </div>
          )}
          
          {error && !loading && (
            <div className="flex flex-col items-center justify-center font-bold text-red-500 gap-2 md:gap-3 p-6 md:p-8 text-center">
              <p className="text-sm md:text-base">Failed to load content.</p>
              <p className="text-xs md:text-sm font-normal text-gray-500">{error}</p>
            </div>
          )}
          
          {!loading && !error && isVideo && streamUrl && (
            <video
              ref={videoRef}
              controls
              controlsList="nodownload" 
              className="w-full h-full max-h-full md:max-h-[75vh] object-contain bg-black outline-none"
            />
          )}
          
          {!loading && !error && isPdf && pdfUrl && (
            <iframe
              src={pdfUrl}
              title={content.title || 'PDF Viewframe'}
              className="w-full bg-white"
              style={{ height: '100%', minHeight: '60vh', border: 'none' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}