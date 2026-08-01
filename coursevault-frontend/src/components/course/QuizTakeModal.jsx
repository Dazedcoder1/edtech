import React, { useState, useEffect, useRef } from 'react';
import { X, Trophy, Target, ArrowRight, RotateCcw, Award, TrendingUp, ListChecks, Clock } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { fetchAPI, resolveMediaUrl } from '../../services/api.js';
import MathDisplay from '../ui/MathDisplay.jsx';

// Formats seconds into "Xh Ym Zs" / "Ym Zs" / "Zs" -- drops leading
// zero units so a 40s quiz still just shows "40s", not "0h 0m 40s".
function formatTimeTaken(totalSeconds) {
  if (totalSeconds === undefined || totalSeconds === null) return '--';
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Small neo-brutalist stat box used in the "Your Progress" grid
function StatBox({ icon, label, value, sub, className = '' }) {
  return (
    <div className={`bg-white border-2 border-black rounded-xl p-3 md:p-4 shadow-[2px_2px_0px_0px_#111] flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5 text-gray-500 font-bold text-[10px] md:text-xs uppercase">
        {icon} {label}
      </div>
      <div className="font-black text-xl md:text-3xl">{value}</div>
      {sub && <div className="text-[10px] md:text-xs font-bold text-gray-400">{sub}</div>}
    </div>
  );
}

export default function QuizTakeModal({ quizId, onClose }) {
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scorecard, setScorecard] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // 🌟 Real open -> submit timer. Set the instant the quiz's questions
  // are actually on screen (not when the request merely fires), so the
  // measured time matches what the student experiences.
  const startTimeRef = useRef(null);

  // Seconds remaining, or null when the quiz is untimed.
  const [secondsLeft, setSecondsLeft] = useState(null);

  /*
   * The auto-submit fires from inside an interval, which closes over the
   * render that created it. Reading answers from a ref rather than state is
   * what stops a timeout from submitting whatever had been answered when the
   * timer started instead of the student's latest choices.
   */
  const answersRef = useRef({});
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // Guards against a double submit when the deadline lands while the student
  // is already pressing the button.
  const submittingRef = useRef(false);

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
      setTimedOut(false);
      startTimeRef.current = Date.now();
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

  const submitQuiz = async ({ auto = false } = {}) => {
    if (submittingRef.current || scorecard) return;

    // An automatic submit must never stop to ask — there is no one to answer
    // it, and the time is already up.
    if (!auto && Object.keys(answersRef.current).length < questions.length) {
      if (!window.confirm("You haven't answered all questions. Submit anyway?")) {
        return;
      }
    }

    // Elapsed seconds from the moment the quiz opened to right now.
    const clientTimeTakenSeconds = startTimeRef.current
      ? Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000))
      : undefined;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await fetchAPI(`/quiz/${quizId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: answersRef.current, clientTimeTakenSeconds })
      });

      setScorecard(result);
      if (auto) setTimedOut(true);
    } catch (err) {
      alert(err.message || "Failed to submit quiz");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitQuiz();
  };

  /*
   * Countdown.
   *
   * The deadline is computed once from the start time rather than by
   * decrementing a counter, so a background tab or a slow frame cannot make
   * the clock drift away from real elapsed time.
   */
  useEffect(() => {
    const limitMinutes = quiz?.time_limit;
    if (!limitMinutes || !startTimeRef.current || scorecard) {
      setSecondsLeft(null);
      return;
    }

    const deadline = startTimeRef.current + limitMinutes * 60 * 1000;

    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) submitQuiz({ auto: true });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quiz, scorecard, questions.length]);

  if (!quizId) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4 bg-black/80 backdrop-blur-sm font-sans">
      <div className="relative w-full h-full md:h-auto max-w-3xl bg-white border-0 md:border-[3px] border-black rounded-none md:rounded-2xl flex flex-col shadow-none md:shadow-[8px_8px_0px_0px_#111] max-h-full md:max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-3 md:p-5 border-b-2 md:border-b-[3px] border-black bg-[#87CEFA]">
          <div className="min-w-0 pr-2">
            <h3 className="font-black text-base md:text-2xl uppercase leading-tight truncate">{quiz?.title || "Loading Quiz..."}</h3>
            {quiz?.description && (
              <div className="text-xs md:text-sm font-bold mt-0.5 md:mt-1 text-black/70 line-clamp-2">
                <MathDisplay text={quiz.description} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {/*
              Only while the quiz is live — once the scorecard is up the clock
              is meaningless, and showing 00:00 next to a result reads as a
              failure. Goes red under a minute so the warning is peripheral
              rather than something you have to be reading to notice.
            */}
            {secondsLeft !== null && !scorecard && (
              <div
                role="timer"
                aria-live={secondsLeft <= 60 ? 'assertive' : 'off'}
                className={`flex items-center gap-1.5 px-2.5 md:px-3 h-8 md:h-10 rounded-full border-2 border-black font-black tabular-nums text-sm md:text-base shadow-[2px_2px_0px_0px_#111] ${
                  secondsLeft <= 60 ? 'bg-[#F26B4D] text-white animate-pulse' : 'bg-white'
                }`}
              >
                <Clock size={15} strokeWidth={3} className="shrink-0" />
                {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:
                {String(secondsLeft % 60).padStart(2, '0')}
              </div>
            )}
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 border-2 md:border-[3px] border-black bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-[2px_2px_0px_0px_#111]"
            >
              <X size={16} strokeWidth={3} className="md:w-5 md:h-5" />
            </button>
          </div>
        </div>

        {/* Says why the quiz submitted itself, so a student who looks up to a
            scorecard they did not trigger is not left guessing. */}
        {timedOut && scorecard && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F26B4D] text-white font-bold text-sm border-b-2 border-black">
            <Clock size={16} strokeWidth={3} className="shrink-0" />
            Time ran out — your answers were submitted automatically.
          </div>
        )}

        {isLoading && (
          <div className="p-8 md:p-12 text-center font-bold text-base md:text-xl text-gray-500">
            Loading questions...
          </div>
        )}

        {!isLoading && !scorecard && (
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto p-3 md:p-8 flex flex-col gap-4 md:gap-8 bg-[#F4F4F4]">
            {questions.map((q, index) => (
              <div key={q.id} className="bg-white border-2 border-black rounded-xl md:rounded-2xl p-3 md:p-6 shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111]">
                <h4 className="font-black text-sm md:text-xl mb-2.5 md:mb-4">
                  <span className="text-[#F26B4D] mr-1.5 md:mr-2">{index + 1}.</span> 
                  <MathDisplay text={q.question_text} />
                </h4>

                {q.image_url && (
                  <div className="my-3 md:my-5 border-2 border-black rounded-xl overflow-hidden bg-white max-h-64 flex items-center justify-center p-2 shadow-[2px_2px_0px_0px_#000]">
                    <img 
                      src={resolveMediaUrl(q.image_url)} 
                      alt={`Diagram for Question ${index + 1}`} 
                      className="max-h-60 w-auto object-contain" 
                    />
                  </div>
                )}
                
                <div className="flex flex-col gap-2 md:gap-3">
                  {q.options.map((opt, optIndex) => {
                    const isSelected = answers[q.id] === optIndex;
                    return (
                      <label 
                        key={optIndex} 
                        className={`flex items-center gap-2 md:gap-3 p-2.5 md:p-4 border-2 border-black rounded-lg md:rounded-xl cursor-pointer font-bold transition-all ${
                          isSelected ? 'bg-[#F9E076] translate-x-0.5 md:translate-x-1 shadow-[2px_2px_0px_0px_#111]' : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="w-5 h-5 md:w-6 md:h-6 flex-shrink-0 rounded-full border-2 border-black flex items-center justify-center bg-white">
                          {isSelected && <div className="w-2.5 h-2.5 md:w-3 md:h-3 bg-black rounded-full" />}
                        </div>
                        <input
                          type="radio"
                          name={`question-${q.id}`}
                          value={optIndex}
                          checked={isSelected}
                          onChange={() => handleOptionSelect(q.id, optIndex)}
                          className="hidden"
                        />
                        <span className="text-sm md:text-lg">
                          <MathDisplay text={opt} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex justify-end pt-1 md:pt-4 pb-1">
              <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full md:w-auto py-3 md:py-4 px-5 md:px-8 text-base md:text-xl rounded-xl md:rounded-2xl border-2 md:border-[3px]">
                {isSubmitting ? 'Submitting...' : 'Submit Answers'} <ArrowRight className="ml-2 inline" strokeWidth={3} size={18} />
              </Button>
            </div>
          </form>
        )}

        {scorecard && (
          /* flex-1 min-h-0 is required: a flex child defaults to
             min-height:auto and will not shrink below its content, so
             overflow-y-auto never engages and the modal's overflow-hidden
             simply clips the review list. */
          <div className="flex-1 min-h-0 flex flex-col p-4 md:p-8 bg-[#F4F4F4] text-center overflow-y-auto gap-5 md:gap-6">

            <div className="bg-white border-2 md:border-[3px] border-black rounded-xl md:rounded-2xl p-5 md:p-10 flex flex-col items-center shadow-[4px_4px_0px_0px_#111] md:shadow-[8px_8px_0px_0px_#111]">
              <div className={`w-16 h-16 md:w-28 md:h-28 rounded-full border-[3px] md:border-[4px] border-black flex items-center justify-center mb-3 md:mb-5 shadow-[4px_4px_0px_0px_#111] md:shadow-[6px_6px_0px_0px_#111] ${
                scorecard.score >= 80 ? 'bg-[#A7E2D1]' : scorecard.score >= 50 ? 'bg-[#F9E076]' : 'bg-red-400'
              }`}>
                {scorecard.score >= 80 ? <Trophy size={30} strokeWidth={2} className="md:w-14 md:h-14" /> : <Target size={30} strokeWidth={2} className="md:w-14 md:h-14" />}
              </div>

              <h2 className="text-2xl md:text-5xl font-black mb-1.5 md:mb-2">{scorecard.score}%</h2>

              <p className="text-sm md:text-xl font-bold text-gray-600 mb-4 md:mb-7">
                You got <span className="text-black bg-[#F4DFD8] px-1.5 py-0.5 md:px-2 md:py-1 rounded border-2 border-black inline-block">{scorecard.correct}</span> out of <span className="text-black bg-[#F4DFD8] px-1.5 py-0.5 md:px-2 md:py-1 rounded border-2 border-black inline-block">{scorecard.total}</span> correct!
              </p>

              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button 
                  onClick={() => { setScorecard(null); setShowReview(false); }}
                  className="flex items-center justify-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-white border-2 md:border-[3px] border-black rounded-xl font-bold text-sm md:text-lg hover:bg-gray-100 shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#111] transition-all"
                >
                  <RotateCcw size={16} strokeWidth={3} className="md:w-5 md:h-5" /> Retake Quiz
                </button>
                <button 
                  onClick={onClose} 
                  className="px-6 md:px-8 py-2.5 md:py-3 bg-[#87CEFA] border-2 md:border-[3px] border-black rounded-xl font-bold text-sm md:text-lg shadow-[3px_3px_0px_0px_#111] md:shadow-[4px_4px_0px_0px_#111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#111] transition-all"
                >
                  Done
                </button>
              </div>
            </div>

            {scorecard.stats && (
              <div className="text-left">
                <h3 className="font-black text-base md:text-xl uppercase mb-2.5 md:mb-4">Your Progress</h3>
                <div className="grid grid-cols-2 gap-2.5 md:gap-4">
                  <StatBox
                    icon={<Award size={12} strokeWidth={2.5} className="md:w-[14px] md:h-[14px]" />}
                    label="Rank"
                    value={`#${scorecard.stats.rank}`}
                    sub={`out of ${scorecard.stats.totalAttempts}`}
                  />
                  <StatBox
                    icon={<Target size={12} strokeWidth={2.5} className="md:w-[14px] md:h-[14px]" />}
                    label="Accuracy"
                    value={`${scorecard.stats.accuracy}%`}
                  />
                  <StatBox
                    icon={<TrendingUp size={12} strokeWidth={2.5} className="md:w-[14px] md:h-[14px]" />}
                    label="Percentile"
                    value={scorecard.stats.percentile}
                  />
                  <StatBox
                    icon={<ListChecks size={12} strokeWidth={2.5} className="md:w-[14px] md:h-[14px]" />}
                    label="Attempt %"
                    value={`${scorecard.stats.attemptPercent}%`}
                    sub={`${scorecard.stats.attemptedQuizzes}/${scorecard.stats.totalQuizzes} quizzes`}
                  />
                  <StatBox
                    icon={<Clock size={12} strokeWidth={2.5} className="md:w-[14px] md:h-[14px]" />}
                    label="Time Taken"
                    value={formatTimeTaken(scorecard.stats.timeTakenSeconds)}
                    className="col-span-2"
                  />
                </div>
              </div>
            )}

            {/* ------------------------------------------------- review ---- */}
            {Array.isArray(scorecard.results) && scorecard.results.length > 0 && (
              <div className="text-left">
                <button
                  type="button"
                  onClick={() => setShowReview((s) => !s)}
                  className="flex items-center gap-2 font-black text-base md:text-xl uppercase mb-2.5 md:mb-4 hover:underline"
                >
                  <ListChecks size={18} strokeWidth={2.5} />
                  {showReview ? 'Hide' : 'Review'} Answers
                  <span className="text-xs font-bold normal-case text-gray-500">
                    ({scorecard.correct} correct
                    {scorecard.incorrect > 0 && `, ${scorecard.incorrect} wrong`}
                    {scorecard.unanswered > 0 && `, ${scorecard.unanswered} skipped`})
                  </span>
                </button>

                {showReview && (
                  <div className="flex flex-col gap-3">
                    {scorecard.results.map((r, i) => {
                      const skipped = r.selectedOption === null || r.selectedOption === undefined;
                      return (
                        <div
                          key={r.questionId}
                          className={`border-2 border-black rounded-xl p-3 md:p-4 shadow-[3px_3px_0px_0px_#111] ${
                            r.isCorrect ? 'bg-[#EAF7F2]' : skipped ? 'bg-white' : 'bg-red-50'
                          }`}
                        >
                          <div className="flex items-start gap-2 font-bold text-sm md:text-base mb-2">
                            <span
                              className={`shrink-0 w-5 h-5 rounded-full border-2 border-black flex items-center justify-center text-[11px] ${
                                r.isCorrect ? 'bg-[#A7E2D1]' : skipped ? 'bg-gray-200' : 'bg-red-400'
                              }`}
                            >
                              {r.isCorrect ? '✓' : skipped ? '–' : '✕'}
                            </span>
                            <span className="text-gray-400">{i + 1}.</span>
                            <MathDisplay text={r.questionText} />
                          </div>

                          {r.imageUrl && (
                            <img
                              src={resolveMediaUrl(r.imageUrl)}
                              alt=""
                              className="max-h-40 w-auto object-contain border-2 border-black rounded-lg my-2"
                            />
                          )}

                          <div className="flex flex-col gap-1 ml-7 text-xs md:text-sm">
                            {(r.options || []).map((opt, oi) => {
                              const isAnswer = oi === r.correctOption;
                              const isPicked = oi === r.selectedOption;
                              return (
                                <div
                                  key={oi}
                                  className={`flex items-start gap-2 px-2 py-1 rounded border ${
                                    isAnswer
                                      ? 'bg-green-200 border-green-700 font-bold'
                                      : isPicked
                                      ? 'bg-red-200 border-red-600'
                                      : 'border-transparent'
                                  }`}
                                >
                                  <span className="text-gray-500 font-bold shrink-0">
                                    {'ABCDEFGH'[oi] || oi + 1}
                                  </span>
                                  <span className="min-w-0">
                                    <MathDisplay text={opt} />
                                  </span>
                                  {isAnswer && (
                                    <span className="ml-auto shrink-0 text-[10px] uppercase font-black text-green-800">
                                      correct
                                    </span>
                                  )}
                                  {isPicked && !isAnswer && (
                                    <span className="ml-auto shrink-0 text-[10px] uppercase font-black text-red-700">
                                      you chose
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {skipped && (
                              <span className="text-gray-500 italic mt-0.5">
                                You didn't answer this one.
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}