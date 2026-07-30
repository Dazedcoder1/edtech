import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Image as ImageIcon, FileText } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { fetchAPI, BASE_URL, resolveMediaUrl } from '../../services/api.js';
import MathInput from '../ui/MathInput.jsx';
import DocxImportPanel from './DocxImportPanel.jsx';

const emptyQuestion = () => ({
  question_text: '',
  options: ['', ''],
  correct_option_index: 0,
  image_url: '', // 🌟 Saves diagram URL to the question state
});

export default function QuizModal({ isOpen, onClose, moduleId, folderId, onSave }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setQuestions([emptyQuestion()]);
      setUploadingIndex(null);
      setShowImport(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const updateQuestion = (qIndex, patch) => {
    setQuestions((prev) => prev.map((q, i) => (i === qIndex ? { ...q, ...patch } : q)));
  };

  const updateOption = (qIndex, oIndex, value) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        const options = [...q.options];
        options[oIndex] = value;
        return { ...q, options };
      })
    );
  };

  const addOption = (qIndex) => {
    setQuestions((prev) =>
      prev.map((q, i) => (i === qIndex ? { ...q, options: [...q.options, ''] } : q))
    );
  };

  const removeOption = (qIndex, oIndex) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        const options = q.options.filter((_, idx) => idx !== oIndex);
        const correct_option_index = q.correct_option_index >= options.length ? 0 : q.correct_option_index;
        return { ...q, options, correct_option_index };
      })
    );
  };

  const addQuestion = () => setQuestions((prev) => [...prev, emptyQuestion()]);

  // Imported questions replace a pristine starter row, otherwise they append.
  const handleImport = (imported) => {
    setQuestions((prev) => {
      const isPristine =
        prev.length === 1 && !prev[0].question_text.trim() && prev[0].options.every((o) => !o.trim());
      return isPristine ? imported : [...prev, ...imported];
    });
    setShowImport(false);
  };
  const removeQuestion = (qIndex) => setQuestions((prev) => prev.filter((_, i) => i !== qIndex));

  // 🌟 Handle Question Diagram Upload to R2
  const handleImageUpload = async (qIndex, e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return alert('Please select a valid image file (PNG, JPG, WEBP).');
    }

    setUploadingIndex(qIndex);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('token');
      const response = await fetch(`${BASE_URL}/content/upload-image?folder=quizzes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData,
      });

      if (!response.ok) {
        const raw = await response.text();
        let message;
        try {
          message = JSON.parse(raw).error;
        } catch {
          message = response.status === 404
            ? 'Upload endpoint not found. Restart the backend to pick up the new route.'
            : `Upload failed (${response.status}).`;
        }
        throw new Error(message);
      }

      const data = await response.json();
      updateQuestion(qIndex, { image_url: data.imageUrl });
    } catch (err) {
      alert(err.message || 'Failed to upload image diagram');
    } finally {
      setUploadingIndex(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return alert('Quiz title is required.');
    for (const q of questions) {
      if (!q.question_text.trim()) return alert('Every question needs text.');
      if (q.options.some((o) => !o.trim())) return alert('Every option needs text.');
      if (q.options.length < 2) return alert('Every question needs at least 2 options.');
    }

    setIsSaving(true);
    try {
      await fetchAPI('/quiz/create', {
        method: 'POST',
        body: JSON.stringify({ 
          moduleId, 
          title, 
          description, 
          questions, 
          folder_id: folderId 
        }),
      });
      onSave();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to create quiz');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm font-sans">
      <div className="relative w-full max-w-2xl bg-white border-[3px] border-black rounded-2xl flex flex-col shadow-[8px_8px_0px_0px_#111] max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b-[3px] border-black bg-[#F9E076] shrink-0">
          <h3 className="font-black text-xl uppercase">Create Quiz</h3>
          <button
            onClick={onClose}
            className="w-9 h-9 border-2 border-black bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
          >
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 flex flex-col gap-6">
          {showImport ? (
            <DocxImportPanel onImport={handleImport} onCancel={() => setShowImport(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="flex items-center justify-center gap-2 border-2 border-black rounded-xl py-2.5 font-bold text-sm bg-[#F4DFD8] hover:bg-[#F9E076] transition-colors shadow-[2px_2px_0px_0px_#111]"
            >
              <FileText size={16} strokeWidth={2.5} /> Import questions from Word (.docx)
            </button>
          )}

          <div>
            <label className="block font-bold text-sm mb-1">Quiz Title</label>
            <MathInput
              value={title}
              onChange={setTitle}
              placeholder="e.g. Chapter 1 Recap Quiz"
            />
          </div>

          <div>
            <label className="block font-bold text-sm mb-1">Description (optional)</label>
            <MathInput
              value={description}
              onChange={setDescription}
              placeholder="Add description..."
              multiline={true}
              rows={2}
            />
          </div>

          {questions.map((q, qIndex) => (
            <div key={qIndex} className="border-2 border-black rounded-xl p-4 bg-gray-50 flex flex-col gap-3 shadow-[4px_4px_0px_0px_#111]">
              <div className="flex justify-between items-center">
                <span className="font-black text-sm uppercase">Question {qIndex + 1}</span>
                <div className="flex items-center gap-3">
                  {/* 🌟 Neo-Brutalist Diagram Upload Button */}
                  {!q.image_url && (
                    <label className="flex items-center gap-1 text-xs font-black bg-[#F4DFD8] border-2 border-black px-2.5 py-1 rounded-lg cursor-pointer hover:bg-[#F26B4D] transition-colors shadow-[2px_2px_0px_0px_#000]">
                      {uploadingIndex === qIndex ? (
                        <span className="animate-pulse">Uploading...</span>
                      ) : (
                        <>
                          <ImageIcon size={14} strokeWidth={2.5} />
                          <span>Add Diagram</span>
                        </>
                      )}
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        disabled={uploadingIndex !== null}
                        onChange={(e) => handleImageUpload(qIndex, e)}
                      />
                    </label>
                  )}

                  {questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(qIndex)}
                      className="text-red-500 hover:text-red-700 font-bold"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              <MathInput
                value={q.question_text}
                onChange={(val) => updateQuestion(qIndex, { question_text: val })}
                placeholder="Question text (supports math equations)"
                multiline={true}
                rows={2}
              />

              {/* 🌟 Live Bordered Diagram Preview Inside Question */}
              {q.image_url && (
                <div className="relative border-2 border-black rounded-xl overflow-hidden bg-white max-h-48 flex items-center justify-center my-1 shadow-[2px_2px_0px_0px_#000]">
                  <img src={resolveMediaUrl(q.image_url)} alt="Question diagram" className="max-h-48 w-auto object-contain p-2" />
                  <button
                    type="button"
                    onClick={() => updateQuestion(qIndex, { image_url: '' })}
                    className="absolute top-2 right-2 bg-red-400 border-2 border-black p-1 rounded-md text-black hover:bg-red-500 transition-transform hover:scale-105 shadow-[2px_2px_0px_0px_#000]"
                    title="Remove diagram"
                  >
                    <Trash2 size={14} strokeWidth={3} />
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-2 mt-1">
                {q.options.map((opt, oIndex) => (
                  <div key={oIndex} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      checked={q.correct_option_index === oIndex}
                      onChange={() => updateQuestion(qIndex, { correct_option_index: oIndex })}
                      title="Mark as correct answer"
                      className="w-4 h-4 accent-[#F26B4D] cursor-pointer"
                    />
                    <MathInput
                      value={opt}
                      onChange={(val) => updateOption(qIndex, oIndex, val)}
                      placeholder={`Option ${oIndex + 1}`}
                      className="flex-1"
                    />
                    {q.options.length > 2 && (
                      <button type="button" onClick={() => removeOption(qIndex, oIndex)} className="text-red-500 hover:scale-110 transition-transform">
                        <X size={16} strokeWidth={3} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(qIndex)}
                  className="self-start text-xs font-bold text-[#F26B4D] hover:underline mt-1"
                >
                  + Add option
                </button>
              </div>
              <p className="text-[11px] text-gray-500 font-medium">Select the radio button next to the correct answer.</p>
            </div>
          ))}

          <button
            type="button"
            onClick={addQuestion}
            className="flex items-center justify-center gap-2 border-2 border-dashed border-black rounded-xl py-3 font-bold hover:bg-gray-50 transition-colors shadow-[2px_2px_0px_0px_#111]"
          >
            <Plus size={16} strokeWidth={3} /> Add Question
          </button>

          <Button type="submit" variant="primary" disabled={isSaving || uploadingIndex !== null} className="rounded-xl border-[3px] py-3 font-black text-base shadow-[4px_4px_0px_0px_#111]">
            {isSaving ? 'Saving...' : 'Save Quiz'}
          </Button>
        </form>
      </div>
    </div>
  );
}