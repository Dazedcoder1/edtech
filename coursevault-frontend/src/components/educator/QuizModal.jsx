import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { fetchAPI } from '../../services/api.js';
import MathInput from '../ui/MathInput.jsx';
import MathDisplay from '../ui/MathDisplay.jsx';

const emptyQuestion = () => ({
  question_text: '',
  options: ['', ''],
  correct_option_index: 0,
});

export default function QuizModal({ isOpen, onClose, moduleId, folderId, onSave }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setQuestions([emptyQuestion()]);
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
  const removeQuestion = (qIndex) => setQuestions((prev) => prev.filter((_, i) => i !== qIndex));

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
        <div className="flex justify-between items-center p-5 border-b-[3px] border-black bg-[#F9E076]">
          <h3 className="font-black text-xl uppercase">Create Quiz</h3>
          <button
            onClick={onClose}
            className="w-9 h-9 border-2 border-black bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
          >
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 flex flex-col gap-6">
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
            <div key={qIndex} className="border-2 border-black rounded-xl p-4 bg-gray-50 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="font-black text-sm uppercase">Question {qIndex + 1}</span>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(qIndex)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <MathInput
                value={q.question_text}
                onChange={(val) => updateQuestion(qIndex, { question_text: val })}
                placeholder="Question text (supports math equations)"
                multiline={true}
                rows={2}
              />

              <div className="flex flex-col gap-2">
                {q.options.map((opt, oIndex) => (
                  <div key={oIndex} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      checked={q.correct_option_index === oIndex}
                      onChange={() => updateQuestion(qIndex, { correct_option_index: oIndex })}
                      title="Mark as correct answer"
                    />
                    <MathInput
                      value={opt}
                      onChange={(val) => updateOption(qIndex, oIndex, val)}
                      placeholder={`Option ${oIndex + 1}`}
                      className="flex-1"
                    />
                    {q.options.length > 2 && (
                      <button type="button" onClick={() => removeOption(qIndex, oIndex)} className="text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(qIndex)}
                  className="self-start text-xs font-bold text-[#F26B4D] hover:underline"
                >
                  + Add option
                </button>
              </div>
              <p className="text-xs text-gray-500 font-medium">Select the radio button next to the correct answer.</p>
            </div>
          ))}

          <button
            type="button"
            onClick={addQuestion}
            className="flex items-center justify-center gap-2 border-2 border-dashed border-black rounded-xl py-3 font-bold hover:bg-gray-50"
          >
            <Plus size={16} strokeWidth={3} /> Add Question
          </button>

          <Button type="submit" variant="primary" disabled={isSaving} className="rounded-xl border-[3px] py-3">
            {isSaving ? 'Saving...' : 'Save Quiz'}
          </Button>
        </form>
      </div>
    </div>
  );
}