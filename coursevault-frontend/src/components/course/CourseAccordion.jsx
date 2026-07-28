import React, { useState, useEffect } from 'react';
import { Video, FileText, HelpCircle, Plus, Edit, Trash2, FilePlus, X, ChevronUp, ChevronDown, CheckCircle2 } from 'lucide-react';
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
  completedContentIds = new Set(), // 🌟 PROGRESS TRACKING
  onProgressRefresh, // 🌟 PROGRESS TRACKING: called after a quiz is completed
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

  const activeContents = contents
    .filter(c => activeTabId === null ? !c.folder_id : c.folder_id === activeTabId)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  const activeQuizzes = quizzes.filter(q =>
    activeTabId === null ? !q.folder_id : q.folder_id === activeTabId
  );

  // 🌟 NEW: Arrow Movement Logic
  const handleMove = async (e, currentIndex, direction) => {
    e.stopPropagation();
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= activeContents.length) return;

    const item1 = activeContents[currentIndex];
    const item2 = activeContents[targetIndex];

    // Swap priorities, force a difference if they are accidentally identical (e.g. both 0)
    let p1 = item2.priority !== null ? item2.priority : targetIndex;
    let p2 = item1.priority !== null ? item1.priority : currentIndex;

    if (p1 === p2) {
      p1 = direction === 'up' ? p1 - 1 : p1 + 1;
    }

    try {
      // API calls to swap the items
      await fetchAPI(`/content/${item1.id}/priority`, { method: 'PUT', body: JSON.stringify({ priority: p1 }) });
      await fetchAPI(`/content/${item2.id}/priority`, { method: 'PUT', body: JSON.stringify({ priority: p2 }) });

      if (onRefreshCurriculum) onRefreshCurriculum();
    } catch (err) {
      alert("Failed to move item");
    }
  };

  return (
    <div className="bg-white border-2 border-black rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_#111] mb-6">
      <div
        className="p-6 flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <h3 className="font-bold text-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#F4DFD8] border-2 border-black flex items-center justify-center text-sm font-black">
            {isOpen ? '-' : '+'}
          </div>
          {module.title}
        </h3>

        <div className="flex items-center gap-3">
          {isCreator && (
            <div className="flex gap-2">
              <button title="Edit Module" onClick={(e) => { e.stopPropagation(); onEditModule(module); }} className="w-8 h-8 flex items-center justify-center bg-[#F9E076] border-2 border-black rounded-md hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#000]">
                <Edit size={14} strokeWidth={3} />
              </button>
              <button title="Delete Module" onClick={(e) => { e.stopPropagation(); onDeleteModule(module.id); }} className="w-8 h-8 flex items-center justify-center bg-red-400 border-2 border-black rounded-md hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#000]">
                <Trash2 size={14} strokeWidth={3} />
              </button>
            </div>
          )}
          <span className="font-bold text-gray-500 text-sm ml-2">
            {(() => {
              const moduleCompleted =
                contents.filter(c => completedContentIds.has(c.id)).length +
                quizzes.filter(q => q.is_completed).length;
              const moduleTotal = contents.length + quizzes.length;
              return moduleTotal > 0 ? `${moduleCompleted}/${moduleTotal} Completed` : '0 Items';
            })()}
          </span>
        </div>
      </div>

      {isOpen && (
        <div className="border-t-2 border-black bg-gray-50 flex flex-col animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-end gap-x-2 overflow-x-auto pt-4 px-4 bg-[#F4DFD8] border-b-2 border-black scrollbar-hide pb-0">
            <button
              onClick={() => setActiveTabId(null)}
              className={`px-6 py-2.5 border-2 border-black border-b-0 rounded-t-xl font-bold transition-all relative ${activeTabId === null
                  ? 'bg-white pb-3.5 -mb-[2px] z-10 shadow-[0px_-2px_0px_0px_#111]'
                  : 'bg-[#E5CFC8] hover:bg-[#D9C3BC] text-gray-700'
                }`}
            >
              General
            </button>

            {folders.map(folder => (
              <div key={folder.id} className="relative flex items-center group">
                <button
                  onClick={() => setActiveTabId(folder.id)}
                  className={`px-5 py-2.5 border-2 border-black border-b-0 rounded-t-xl font-bold transition-all ${activeTabId === folder.id
                      ? 'bg-white pb-3.5 -mb-[2px] z-10 shadow-[0px_-2px_0px_0px_#111]'
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
                className="px-3 py-2 bg-[#F9E076] border-2 border-black border-b-0 rounded-t-xl hover:bg-yellow-400 font-bold ml-2 transition-colors flex items-center gap-1 self-end shadow-[0px_-2px_0px_0px_#111]"
              >
                <Plus size={18} strokeWidth={3} />
              </button>
            )}
          </div>

          <div className="p-8 bg-white min-h-[300px] relative">
            {isCreator && (
              <div className="flex flex-wrap gap-4 mb-8 pb-6 border-b-2 border-dashed border-gray-300">
                <button onClick={() => onAddContent(module.id, activeTabId)} className="flex items-center gap-2 px-5 py-2.5 bg-[#87CEFA] border-2 border-black rounded-xl font-bold text-sm shadow-[2px_2px_0px_0px_#111] hover:scale-[1.02] transition-transform">
                  <Video size={18} strokeWidth={3} /> Add Video Here
                </button>
                <button onClick={() => onAddPDF(module.id, activeTabId)} className="flex items-center gap-2 px-5 py-2.5 bg-[#A7E2D1] border-2 border-black rounded-xl font-bold text-sm shadow-[2px_2px_0px_0px_#111] hover:scale-[1.02] transition-transform">
                  <FilePlus size={18} strokeWidth={3} /> Add PDF Here
                </button>
                <button onClick={() => setIsQuizModalOpen(true)} className="flex items-center gap-2 px-5 py-2.5 bg-[#F4DFD8] border-2 border-black rounded-xl font-bold text-sm shadow-[2px_2px_0px_0px_#111] hover:scale-[1.02] transition-transform">
                  <HelpCircle size={18} strokeWidth={3} /> Create Quiz Here
                </button>
              </div>
            )}

            {selectedContentIds.length > 0 && isCreator && (
              <div className="bg-[#A7E2D1] border-2 border-black p-3 rounded-lg flex items-center justify-between shadow-[2px_2px_0px_0px_#111] mb-6 animate-in fade-in zoom-in duration-200">
                <span className="font-bold">{selectedContentIds.length} items selected</span>
                <div className="flex gap-2">
                  <select
                    className="border-2 border-black rounded-lg px-3 py-1.5 font-bold bg-white text-sm outline-none focus:ring-2 focus:ring-[#F26B4D]"
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
              <div className="text-center border-2 border-dashed border-gray-300 rounded-xl py-12">
                <p className="text-gray-500 font-bold mb-2">This tab is empty.</p>
                {isCreator && <p className="text-sm text-gray-400">Use the buttons above to add content, or select items from other tabs to move them here.</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* 🌟 APPLIED NEW ARROW UX TO CONTENTS */}
                {activeContents.map((content, index) => {
                  const isVideo = content.content_type === 'video';
                  const isSelected = selectedContentIds.includes(content.id);
                  const isDone = completedContentIds.has(content.id); // 🌟 PROGRESS TRACKING

                  return (
                    <div key={content.id} className={`border-2 border-black rounded-xl p-4 shadow-[2px_2px_0px_0px_#111] transition-colors ${isSelected ? 'bg-blue-50' : isDone ? 'bg-[#F3FBF8]' : 'bg-white'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-4">
                          {isCreator && (
                            <input
                              type="checkbox"
                              className="w-5 h-5 border-2 border-black rounded cursor-pointer accent-[#F26B4D]"
                              checked={isSelected}
                              onChange={() => toggleContentSelection(content.id)}
                            />
                          )}

                          {/* 🌟 NEW: Up/Down Arrow Buttons replacing manual number input */}
                          {isCreator && (
                            <div className="flex flex-col items-center justify-center gap-[2px]">
                              <button
                                onClick={(e) => handleMove(e, index, 'up')}
                                disabled={index === 0}
                                className={`p-0.5 border-[2px] border-black rounded ${index === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-50' : 'bg-[#A7E2D1] hover:bg-[#86cdba] text-black shadow-[1px_1px_0px_0px_#111] active:translate-y-[1px] active:shadow-none'}`}
                                title="Move Up"
                              >
                                <ChevronUp size={16} strokeWidth={3} />
                              </button>
                              <button
                                onClick={(e) => handleMove(e, index, 'down')}
                                disabled={index === activeContents.length - 1}
                                className={`p-0.5 border-[2px] border-black rounded ${index === activeContents.length - 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-50' : 'bg-[#F9E076] hover:bg-[#ebd056] text-black shadow-[1px_1px_0px_0px_#111] active:translate-y-[1px] active:shadow-none'}`}
                                title="Move Down"
                              >
                                <ChevronDown size={16} strokeWidth={3} />
                              </button>
                            </div>
                          )}

                          <div className={`relative w-10 h-10 rounded-full border-2 border-black flex items-center justify-center ${isVideo ? 'bg-[#87CEFA]' : 'bg-[#A7E2D1]'}`}>
                            {isVideo ? <Video size={18} /> : <FileText size={18} />}
                            {isDone && (
                              <CheckCircle2
                                size={16}
                                strokeWidth={2.5}
                                className="absolute -bottom-1 -right-1 bg-white text-[#2FA36B] rounded-full border-2 border-black"
                              />
                            )}
                          </div>
                          <div>
                            <h4 className="font-bold text-lg leading-none mb-1">{content.title}</h4>
                            {!isVideo && <p className="text-sm font-medium text-gray-500">PDF • {formatSize(content.file_size_bytes)}</p>}
                            {isVideo && <p className="text-sm font-medium text-gray-500">Video Lesson</p>}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {content.preview && <span className="bg-[#F26B4D] text-black text-[10px] font-black px-2 py-0.5 border-2 border-black rounded uppercase">Preview</span>}
                          {isDone && (
                            <span className="bg-[#A7E2D1] text-black text-[10px] font-black px-2 py-0.5 border-2 border-black rounded uppercase">Completed</span>
                          )}

                          {isVideo ? (
                            <button
                              onClick={() => setExpandedVideoId(prev => prev === content.id ? null : content.id)}
                              className="bg-white border-2 border-black rounded-lg px-4 py-2 font-bold text-sm hover:bg-[#F9E076] transition-colors"
                            >
                              {expandedVideoId === content.id ? 'Close' : isDone ? 'Rewatch' : 'Watch'}
                            </button>
                          ) : (
                            <button
                              onClick={() => onContentClick(content)}
                              className="bg-white border-2 border-black rounded-lg px-4 py-2 font-bold text-sm hover:bg-[#F9E076] transition-colors"
                            >
                              {isDone ? 'Review' : 'Read'}
                            </button>
                          )}

                          {isCreator && (
                            <button
                              title="Delete Asset"
                              onClick={(e) => handleDeleteContent(e, content.id)}
                              className="w-9 h-9 flex items-center justify-center bg-red-400 border-2 border-black rounded-md hover:scale-105 transition-transform"
                            >
                              <Trash2 size={14} strokeWidth={3} />
                            </button>
                          )}
                        </div>
                      </div>
                      {isVideo && expandedVideoId === content.id && (
                        <div className="mt-4 border-t-2 border-dashed border-gray-300 pt-4">
                          <InlineVideoPlayer content={content} courseId={courseId} isEnrolled={isEnrolled} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {activeQuizzes.map((quiz) => (
                  <div key={quiz.id} className={`border-2 border-black rounded-xl p-4 shadow-[2px_2px_0px_0px_#111] ${quiz.is_completed ? 'bg-[#F3FBF8]' : 'bg-white'}`}>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        {isCreator && <div className="w-5 h-5" />}
                        <div className="relative w-10 h-10 rounded-full border-2 border-black flex items-center justify-center bg-[#F4DFD8]">
                          <HelpCircle size={18} />
                          {quiz.is_completed && (
                            <CheckCircle2
                              size={16}
                              strokeWidth={2.5}
                              className="absolute -bottom-1 -right-1 bg-white text-[#2FA36B] rounded-full border-2 border-black"
                            />
                          )}
                        </div>
                        <div>
                          <h4 className="font-bold text-lg leading-none mb-1">{quiz.title}</h4>
                          <p className="text-sm font-medium text-gray-500">
                            {quiz.question_count} question{quiz.question_count === 1 ? '' : 's'}
                            {quiz.is_completed && ` • Best score: ${quiz.user_score}%`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {quiz.is_completed && (
                          <span className="bg-[#A7E2D1] text-black text-[10px] font-black px-2 py-0.5 border-2 border-black rounded uppercase">Completed</span>
                        )}
                        <button
                          onClick={() => setTakingQuizId(quiz.id)}
                          className="bg-white border-2 border-black rounded-lg px-4 py-2 font-bold text-sm hover:bg-[#F9E076] transition-colors"
                        >
                          {quiz.is_completed ? 'Retake Quiz' : 'Take Quiz'}
                        </button>
                        {isCreator && (
                          <button
                            onClick={() => handleDeleteQuiz(quiz.id)}
                            className="w-9 h-9 flex items-center justify-center bg-red-400 border-2 border-black rounded-md hover:scale-105 transition-transform"
                          >
                            <Trash2 size={14} strokeWidth={3} />
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
        <QuizTakeModal
          quizId={takingQuizId}
          onClose={() => {
            setTakingQuizId(null);
            // 🌟 PROGRESS TRACKING: re-pull this module's quizzes for the
            // fresh completed/score badge, and let the page-level progress
            // bar resync too.
            setQuizzesLoaded(false);
            loadQuizzes();
            if (onProgressRefresh) onProgressRefresh();
          }}
        />
      )}
    </div>
  );
}