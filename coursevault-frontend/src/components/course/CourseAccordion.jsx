import React, { useState, useEffect } from 'react';
import { Video, FileText, HelpCircle, Plus, Edit, Trash2, FilePlus, X } from 'lucide-react';
import { formatSize } from '../../utils/format';
import { fetchAPI } from '../../services/api.js';
import InlineVideoPlayer from './InlineVideoPlayer.jsx';
import QuizModal from '../educator/QuizModal.jsx';
import QuizTakeModal from './QuizTakeModal.jsx';

export default function CourseAccordion({
  module,
  isOpen,
  onToggle,
  onContentClick,
  isCreator,
  onAddContent,
  onAddPDF,
  onEditModule,
  onDeleteModule,
  courseId,
  isEnrolled,
  onRefreshCurriculum,
}) {
  const contents = module.contents || [];

  const [activeTabId, setActiveTabId] = useState(null);
  const [expandedVideoId, setExpandedVideoId] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [quizzesLoaded, setQuizzesLoaded] = useState(false);
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [takingQuizId, setTakingQuizId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [selectedContentIds, setSelectedContentIds] = useState([]);

  const loadQuizzes = async () => {
    try {
      const data = await fetchAPI(`/quiz/module/${module.id}`);
      setQuizzes(data.quizzes || []);
    } catch (_) {
      setQuizzes([]);
    } finally {
      setQuizzesLoaded(true);
    }
  };

  const loadFolders = async () => {
    try {
      const data = await fetchAPI(`/content/folders/${module.id}`);
      setFolders(data.folders || []);
    } catch (_) {
      setFolders([]);
    } finally {
      setFoldersLoaded(true);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (!quizzesLoaded) loadQuizzes();
      if (!foldersLoaded) loadFolders();
    }
  }, [isOpen, quizzesLoaded, foldersLoaded]);

  const handleCreateTab = async () => {
    const title = window.prompt("Enter new tab name (e.g., Chapter 1):");
    if (!title) return;
    try {
      const res = await fetchAPI('/content/folder', {
        method: 'POST',
        body: JSON.stringify({ module_id: module.id, title })
      });
      loadFolders();
      if (res.folder) setActiveTabId(res.folder.id);
    } catch (err) {
      alert(err.message || 'Failed to create tab');
    }
  };

  const handleDeleteTab = async (e, folderId) => {
    e.stopPropagation();
    if (!window.confirm("Delete this tab? Contents will safely return to the General tab.")) return;
    try {
      await fetchAPI(`/content/folder/${folderId}`, { method: 'DELETE' });
      if (activeTabId === folderId) setActiveTabId(null);
      loadFolders();
      if (onRefreshCurriculum) onRefreshCurriculum();
    } catch (err) {
      alert(err.message || 'Failed to delete tab');
    }
  };

  const toggleContentSelection = (id) => {
    setSelectedContentIds(prev =>
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const handleBulkMove = async (targetFolderId) => {
    if (selectedContentIds.length === 0) return;
    try {
      await fetchAPI(`/content/bulk-move`, {
        method: 'PUT',
        body: JSON.stringify({
          content_ids: selectedContentIds,
          folder_id: targetFolderId === 'null' ? null : targetFolderId
        })
      });
      setSelectedContentIds([]);
      if (onRefreshCurriculum) onRefreshCurriculum();
      else window.location.reload();
    } catch (err) {
      alert(err.message || 'Failed to move items');
    }
  };

  const handleUpdatePriority = async (contentId, newPriority) => {
    try {
      await fetchAPI(`/content/${contentId}/priority`, {
        method: 'PUT',
        body: JSON.stringify({ priority: newPriority })
      });
      if (onRefreshCurriculum) onRefreshCurriculum();
    } catch (err) {
      alert("Failed to update priority");
    }
  };

  const handleDeleteContent = async (e, contentId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this content item?')) return;
    try {
      await fetchAPI(`/content/${contentId}`, { method: 'DELETE' });
      if (onRefreshCurriculum) onRefreshCurriculum();
      else window.location.reload();
    } catch (err) {
      alert(err.message || 'Failed to delete content');
    }
  };

  const handleDeleteQuiz = async (quizId) => {
    if (!window.confirm('Delete this quiz?')) return;
    try {
      await fetchAPI(`/quiz/${quizId}`, { method: 'DELETE' });
      setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
    } catch (err) {
      alert(err.message || 'Failed to delete quiz');
    }
  };

  const getPriorityLevel = (p) => (!p || p === 0 ? 2 : p); // Default unassigned to Medium (2)

  const activeContents = contents
    .filter(c => activeTabId === null ? !c.folder_id : c.folder_id === activeTabId)
    .sort((a, b) => getPriorityLevel(a.priority) - getPriorityLevel(b.priority));

  const activeQuizzes = quizzes.filter(q =>
    activeTabId === null ? !q.folder_id : q.folder_id === activeTabId
  );

  return (
    <div className="bg-white border-2 border-black rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_#111] mb-4 md:mb-6">

      {/* Module Header */}
      <div
        className="p-3 md:p-6 flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <h3 className="font-bold text-sm md:text-xl flex items-center gap-2 md:gap-3">
          <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-[#F4DFD8] border-2 border-black flex items-center justify-center text-xs md:text-sm font-black flex-shrink-0">
            {isOpen ? '-' : '+'}
          </div>
          {module.title}
        </h3>

        <div className="flex items-center gap-2 md:gap-3">
          {isCreator && (
            <div className="flex gap-1.5 md:gap-2">
              <button title="Edit Module" onClick={(e) => { e.stopPropagation(); onEditModule(module); }} className="w-6 h-6 md:w-8 md:h-8 flex items-center justify-center bg-[#F9E076] border-2 border-black rounded-md hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#000]">
                <Edit size={12} strokeWidth={3} className="md:w-[14px] md:h-[14px]" />
              </button>
              <button title="Delete Module" onClick={(e) => { e.stopPropagation(); onDeleteModule(module.id); }} className="w-6 h-6 md:w-8 md:h-8 flex items-center justify-center bg-red-400 border-2 border-black rounded-md hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#000]">
                <Trash2 size={12} strokeWidth={3} className="md:w-[14px] md:h-[14px]" />
              </button>
            </div>
          )}
          <span className="font-bold text-gray-500 text-xs md:text-sm ml-1 md:ml-2">{contents.length + quizzes.length} Items</span>
        </div>
      </div>

      {isOpen && (
        <div className="border-t-2 border-black bg-gray-50 flex flex-col animate-in fade-in slide-in-from-top-4 duration-300">

          {/* 1. Browser Tabs UI */}
          <div className="flex items-end gap-x-1.5 md:gap-x-2 overflow-x-auto pt-2 md:pt-4 px-2 md:px-4 bg-[#F4DFD8] border-b-2 border-black scrollbar-hide pb-0">
            <button
              onClick={() => setActiveTabId(null)}
              className={`px-3 md:px-6 py-1.5 md:py-2.5 text-sm md:text-base border-2 border-black border-b-0 rounded-t-xl font-bold transition-all relative whitespace-nowrap ${
                activeTabId === null
                  ? 'bg-white pb-2.5 md:pb-3.5 -mb-[2px] z-10 shadow-[0px_-2px_0px_0px_#111]'
                  : 'bg-[#E5CFC8] hover:bg-[#D9C3BC] text-gray-700'
              }`}
            >
              General
            </button>

            {folders.map(folder => (
              <div key={folder.id} className="relative flex items-center group">
                <button
                  onClick={() => setActiveTabId(folder.id)}
                  className={`px-3 md:px-5 py-1.5 md:py-2.5 text-sm md:text-base border-2 border-black border-b-0 rounded-t-xl font-bold transition-all whitespace-nowrap ${
                    activeTabId === folder.id
                      ? 'bg-white pb-2.5 md:pb-3.5 -mb-[2px] z-10 shadow-[0px_-2px_0px_0px_#111]'
                      : 'bg-[#E5CFC8] hover:bg-[#D9C3BC] text-gray-700'
                  }`}
                >
                  {folder.title}
                </button>
                {isCreator && (
                  <button
                    onClick={(e) => handleDeleteTab(e, folder.id)}
                    className="absolute -right-2 -top-2 bg-red-400 border-2 border-black rounded-full p-0.5 hover:bg-red-500 text-white z-20 shadow-[1px_1px_0px_0px_#111] opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete Tab"
                  >
                    <X size={12} strokeWidth={3} />
                  </button>
                )}
              </div>
            ))}

            {isCreator && (
              <button
                onClick={handleCreateTab}
                title="Add Custom Tab"
                className="px-2.5 md:px-3 py-1.5 md:py-2 bg-[#F9E076] border-2 border-black border-b-0 rounded-t-xl hover:bg-yellow-400 font-bold ml-1 md:ml-2 transition-colors flex items-center gap-1 self-end shadow-[0px_-2px_0px_0px_#111]"
              >
                <Plus size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
              </button>
            )}
          </div>

          {/* 2. Active Tab Workspace */}
          <div className="p-3 md:p-8 bg-white min-h-0 md:min-h-[300px] relative">

            {/* Tab Creation Action Bar (Creator only) */}
            {isCreator && (
              <div className="flex flex-wrap gap-2 md:gap-4 mb-4 md:mb-8 pb-4 md:pb-6 border-b-2 border-dashed border-gray-300">
                <button onClick={() => onAddContent(module.id, activeTabId)} className="flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-1.5 md:py-2.5 bg-[#87CEFA] border-2 border-black rounded-lg md:rounded-xl font-bold text-xs md:text-sm shadow-[2px_2px_0px_0px_#111] hover:scale-[1.02] transition-transform">
                  <Video size={14} strokeWidth={3} className="md:w-[18px] md:h-[18px]" /> Add Video Here
                </button>
                <button onClick={() => onAddPDF(module.id, activeTabId)} className="flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-1.5 md:py-2.5 bg-[#A7E2D1] border-2 border-black rounded-lg md:rounded-xl font-bold text-xs md:text-sm shadow-[2px_2px_0px_0px_#111] hover:scale-[1.02] transition-transform">
                  <FilePlus size={14} strokeWidth={3} className="md:w-[18px] md:h-[18px]" /> Add PDF Here
                </button>
                <button onClick={() => setIsQuizModalOpen(true)} className="flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-1.5 md:py-2.5 bg-[#F4DFD8] border-2 border-black rounded-lg md:rounded-xl font-bold text-xs md:text-sm shadow-[2px_2px_0px_0px_#111] hover:scale-[1.02] transition-transform">
                  <HelpCircle size={14} strokeWidth={3} className="md:w-[18px] md:h-[18px]" /> Create Quiz Here
                </button>
              </div>
            )}

            {selectedContentIds.length > 0 && isCreator && (
              <div className="bg-[#A7E2D1] border-2 border-black p-2.5 md:p-3 rounded-lg flex items-center justify-between shadow-[2px_2px_0px_0px_#111] mb-4 md:mb-6 animate-in fade-in zoom-in duration-200">
                <span className="font-bold text-sm">{selectedContentIds.length} items selected</span>
                <div className="flex gap-2">
                  <select
                    className="border-2 border-black rounded-lg px-2.5 md:px-3 py-1 md:py-1.5 font-bold bg-white text-xs md:text-sm outline-none focus:ring-2 focus:ring-[#F26B4D]"
                    onChange={(e) => handleBulkMove(e.target.value)}
                    defaultValue=""
                  >
                    <option value="" disabled>Move to tab...</option>
                    <option value="null">General</option>
                    {folders.map(f => (
                      <option key={f.id} value={f.id}>{f.title}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {activeContents.length === 0 && activeQuizzes.length === 0 ? (
              <div className="text-center border-2 border-dashed border-gray-300 rounded-xl py-8 md:py-12">
                <p className="text-gray-500 font-bold text-sm md:text-base mb-2">This tab is empty.</p>
                {isCreator && <p className="text-xs md:text-sm text-gray-400">Use the buttons above to add content, or select items from other tabs to move them here.</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-3 md:gap-4">

                {/* Render Files (Videos/PDFs) */}
                {activeContents.map((content) => {
                  const isVideo = content.content_type === 'video';
                  const isSelected = selectedContentIds.includes(content.id);

                  return (
                    <div key={content.id} className={`border-2 border-black rounded-xl p-2.5 md:p-4 shadow-[2px_2px_0px_0px_#111] transition-colors ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 md:gap-4 min-w-0">
                          {isCreator && (
                            <input
                              type="checkbox"
                              className="w-4 h-4 md:w-5 md:h-5 border-2 border-black rounded cursor-pointer accent-[#F26B4D] flex-shrink-0"
                              checked={isSelected}
                              onChange={() => toggleContentSelection(content.id)}
                            />
                          )}
                          <div className={`w-7 h-7 md:w-10 md:h-10 rounded-full border-2 border-black flex items-center justify-center flex-shrink-0 ${isVideo ? 'bg-[#87CEFA]' : 'bg-[#A7E2D1]'}`}>
                            {isVideo ? <Video size={14} className="md:w-[18px] md:h-[18px]" /> : <FileText size={14} className="md:w-[18px] md:h-[18px]" />}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm md:text-lg leading-tight mb-0.5 md:mb-1 truncate">{content.title}</h4>
                            {!isVideo && <p className="text-xs md:text-sm font-medium text-gray-500">PDF • {formatSize(content.file_size_bytes)}</p>}
                            {isVideo && <p className="text-xs md:text-sm font-medium text-gray-500">Video Lesson</p>}

                            {isCreator && (
                              <div className="flex items-center gap-2 mt-1.5 md:mt-2">
                                <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider text-[#F26B4D]">Priority:</span>
                                <select
                                  value={getPriorityLevel(content.priority)}
                                  onChange={(e) => handleUpdatePriority(content.id, e.target.value)}
                                  className="border-2 border-black rounded-md bg-[#F4F4F4] text-[10px] md:text-xs font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#F26B4D] transition-all px-1.5 md:px-2 py-0.5 cursor-pointer"
                                >
                                  <option value={1}>High</option>
                                  <option value={2}>Medium</option>
                                  <option value={3}>Low</option>
                                </select>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 md:gap-3 flex-shrink-0">
                          {content.preview && <span className="hidden sm:inline bg-[#F26B4D] text-black text-[9px] md:text-[10px] font-black px-1.5 md:px-2 py-0.5 border-2 border-black rounded uppercase">Preview</span>}

                          {isVideo ? (
                            <button
                              onClick={() => setExpandedVideoId(prev => prev === content.id ? null : content.id)}
                              className="bg-white border-2 border-black rounded-lg px-2.5 md:px-4 py-1.5 md:py-2 font-bold text-xs md:text-sm hover:bg-[#F9E076] transition-colors"
                            >
                              {expandedVideoId === content.id ? 'Close' : 'Watch'}
                            </button>
                          ) : (
                            <button
                              onClick={() => onContentClick(content)}
                              className="bg-white border-2 border-black rounded-lg px-2.5 md:px-4 py-1.5 md:py-2 font-bold text-xs md:text-sm hover:bg-[#F9E076] transition-colors"
                            >
                              Read
                            </button>
                          )}

                          {isCreator && (
                            <button
                              title="Delete Asset"
                              onClick={(e) => handleDeleteContent(e, content.id)}
                              className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center bg-red-400 border-2 border-black rounded-md hover:scale-105 transition-transform flex-shrink-0"
                            >
                              <Trash2 size={12} strokeWidth={3} className="md:w-[14px] md:h-[14px]" />
                            </button>
                          )}
                        </div>
                      </div>
                      {isVideo && expandedVideoId === content.id && (
                        <div className="mt-3 md:mt-4 border-t-2 border-dashed border-gray-300 pt-3 md:pt-4">
                          <InlineVideoPlayer content={content} courseId={courseId} isEnrolled={isEnrolled} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Render Quizzes */}
                {activeQuizzes.map((quiz) => (
                  <div key={quiz.id} className="border-2 border-black rounded-xl p-2.5 md:p-4 shadow-[2px_2px_0px_0px_#111] bg-white">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 md:gap-4 min-w-0">
                        {isCreator && <div className="w-4 md:w-5 h-4 md:h-5 flex-shrink-0" />}
                        <div className="w-7 h-7 md:w-10 md:h-10 rounded-full border-2 border-black flex items-center justify-center bg-[#F4DFD8] flex-shrink-0">
                          <HelpCircle size={14} className="md:w-[18px] md:h-[18px]" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm md:text-lg leading-tight mb-0.5 md:mb-1 truncate">{quiz.title}</h4>
                          <p className="text-xs md:text-sm font-medium text-gray-500">{quiz.question_count} question{quiz.question_count === 1 ? '' : 's'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 md:gap-3 flex-shrink-0">
                        <button
                          onClick={() => setTakingQuizId(quiz.id)}
                          className="bg-white border-2 border-black rounded-lg px-2.5 md:px-4 py-1.5 md:py-2 font-bold text-xs md:text-sm hover:bg-[#F9E076] transition-colors"
                        >
                          Take Quiz
                        </button>
                        {isCreator && (
                          <button
                            onClick={() => handleDeleteQuiz(quiz.id)}
                            className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center bg-red-400 border-2 border-black rounded-md hover:scale-105 transition-transform"
                          >
                            <Trash2 size={12} strokeWidth={3} className="md:w-[14px] md:h-[14px]" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <QuizModal
        isOpen={isQuizModalOpen}
        onClose={() => setIsQuizModalOpen(false)}
        moduleId={module.id}
        folderId={activeTabId}
        onSave={() => { setQuizzesLoaded(false); loadQuizzes(); }}
      />
      {takingQuizId && (
        <QuizTakeModal quizId={takingQuizId} onClose={() => setTakingQuizId(null)} />
      )}
    </div>
  );
}
