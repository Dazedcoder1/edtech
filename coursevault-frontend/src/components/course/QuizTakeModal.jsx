import React, { useState, useEffect } from 'react';
import { X, Trophy, Target, ArrowRight, RotateCcw } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { fetchAPI } from '../../services/api.js';
import MathDisplay from '../ui/MathDisplay.jsx';

export default function QuizTakeModal({ quizId, onClose }) {
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scorecard, setScorecard] = useState(null);

  useEffect(() => {
    if (quizId) {
      loadQuiz();
    }
  }, [quizId]);

  const loadQuiz = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAPI(`/quiz/${quizId}`);
      setQuiz(data.quiz);
      setQuestions(data.questions || []);
      setAnswers({});
      setScorecard(null);
    } catch (err) {
      alert(err.message || "Failed to load quiz");
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleOptionSelect = (questionId, optionIndex) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: optionIndex
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (Object.keys(answers).length < questions.length) {
      if (!window.confirm("You haven't answered all questions. Submit anyway?")) {
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await fetchAPI(`/quiz/${quizId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers })
      });
      
      setScorecard(result);
    } catch (err) {
      alert(err.message || "Failed to submit quiz");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!quizId) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-sans">
      <div className="relative w-full max-w-3xl bg-white border-[3px] border-black rounded-2xl flex flex-col shadow-[8px_8px_0px_0px_#111] max-h-[90vh] overflow-hidden">
        
        <div className="flex justify-between items-center p-5 border-b-[3px] border-black bg-[#87CEFA]">
          <div>
            <h3 className="font-black text-2xl uppercase leading-none">{quiz?.title || "Loading Quiz..."}</h3>
            {quiz?.description && (
              <div className="text-sm font-bold mt-1 text-black/70">
                <MathDisplay text={quiz.description} />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 border-[3px] border-black bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#111]"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        {isLoading && (
          <div className="p-12 text-center font-bold text-xl text-gray-500">
            Loading questions...
          </div>
        )}

        {!isLoading && !scorecard && (
          <form onSubmit={handleSubmit} className="overflow-y-auto p-6 md:p-8 flex flex-col gap-8 bg-[#F4F4F4]">
            {questions.map((q, index) => (
              <div key={q.id} className="bg-white border-2 border-black rounded-2xl p-6 shadow-[4px_4px_0px_0px_#111]">
                <h4 className="font-black text-xl mb-4">
                  <span className="text-[#F26B4D] mr-2">{index + 1}.</span> 
                  <MathDisplay text={q.question_text} />
                </h4>
                
                <div className="flex flex-col gap-3">
                  {q.options.map((opt, optIndex) => {
                    const isSelected = answers[q.id] === optIndex;
                    return (
                      <label 
                        key={optIndex} 
                        className={`flex items-center gap-3 p-4 border-2 border-black rounded-xl cursor-pointer font-bold transition-all ${
                          isSelected ? 'bg-[#F9E076] translate-x-1 shadow-[2px_2px_0px_0px_#111]' : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-full border-2 border-black flex items-center justify-center bg-white`}>
                          {isSelected && <div className="w-3 h-3 bg-black rounded-full" />}
                        </div>
                        <input
                          type="radio"
                          name={`question-${q.id}`}
                          value={optIndex}
                          checked={isSelected}
                          onChange={() => handleOptionSelect(q.id, optIndex)}
                          className="hidden"
                        />
                        <span className="text-lg">
                          <MathDisplay text={opt} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex justify-end pt-4">
              <Button type="submit" variant="primary" disabled={isSubmitting} className="py-4 px-8 text-xl rounded-2xl border-[3px]">
                {isSubmitting ? 'Submitting...' : 'Submit Answers'} <ArrowRight className="ml-2 inline" strokeWidth={3} />
              </Button>
            </div>
          </form>
        )}

        {scorecard && (
          <div className="flex flex-col items-center justify-center p-12 bg-white text-center">
            <div className={`w-32 h-32 rounded-full border-[4px] border-black flex items-center justify-center mb-6 shadow-[8px_8px_0px_0px_#111] ${
              scorecard.score >= 80 ? 'bg-[#A7E2D1]' : scorecard.score >= 50 ? 'bg-[#F9E076]' : 'bg-red-400'
            }`}>
              {scorecard.score >= 80 ? <Trophy size={64} strokeWidth={2} /> : <Target size={64} strokeWidth={2} />}
            </div>

            <h2 className="text-6xl font-black mb-2">{scorecard.score}%</h2>
            
            <p className="text-2xl font-bold text-gray-600 mb-8">
              You got <span className="text-black bg-[#F4DFD8] px-2 py-1 rounded border-2 border-black inline-block">{scorecard.correct}</span> out of <span className="text-black bg-[#F4DFD8] px-2 py-1 rounded border-2 border-black inline-block">{scorecard.total}</span> correct!
            </p>

            <div className="flex gap-4">
              <button 
                onClick={() => setScorecard(null)} 
                className="flex items-center gap-2 px-6 py-3 bg-white border-[3px] border-black rounded-xl font-bold text-lg hover:bg-gray-100 shadow-[4px_4px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#111] transition-all"
              >
                <RotateCcw size={20} strokeWidth={3} /> Retake Quiz
              </button>
              <button 
                onClick={onClose} 
                className="px-8 py-3 bg-[#87CEFA] border-[3px] border-black rounded-xl font-bold text-lg shadow-[4px_4px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#111] transition-all"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}