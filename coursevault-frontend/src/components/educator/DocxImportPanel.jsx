import React, { useState, useRef } from 'react';
import { Upload, FileText, AlertTriangle, Check, X } from 'lucide-react';
import { importDocx } from '../../utils/docxImport';
import MathText from '../../utils/mathRenderer';

/**
 * Review screen for .docx question import.
 *
 * Nothing here writes to a quiz directly — the educator confirms first. Word
 * files vary enough (manual vs automatic numbering, answer keys inline or in a
 * separate section) that silently trusting the parse would eventually put a
 * wrong answer in front of students.
 */
export default function DocxImportPanel({ onImport, onCancel }) {
  const [state, setState] = useState('idle'); // idle | parsing | review | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.docx')) {
      setError('Please choose a .docx file. Older .doc files are not supported — open it in Word and "Save As" .docx first.');
      setState('error');
      return;
    }

    setState('parsing');
    setError('');
    try {
      const parsed = await importDocx(file);
      if (parsed.questions.length === 0) {
        setError(
          `No questions found. Read ${parsed.stats.paragraphs} paragraphs and ${parsed.stats.equations} equations, ` +
            `but nothing matched a question pattern. The file may use an unusual layout.`
        );
        setState('error');
        return;
      }
      setResult(parsed);
      setQuestions(parsed.questions.map((q) => ({ ...q, include: q.options.length >= 2 })));
      setState('review');
    } catch (err) {
      setError(err.message || 'Could not read that file.');
      setState('error');
    }
  };

  const toggle = (i) =>
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? { ...q, include: !q.include } : q)));

  const setCorrect = (i, optIdx) =>
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === i ? { ...q, correct_option_index: optIdx } : q))
    );

  const selected = questions.filter((q) => q.include);
  const incomplete = questions.filter((q) => q.options.length < 2).length;

  // -------------------------------------------------------------- idle/error
  if (state === 'idle' || state === 'error' || state === 'parsing') {
    return (
      <div className="border-2 border-black rounded-xl p-6 bg-white shadow-[4px_4px_0px_0px_#111]">
        <div className="flex flex-col items-center text-center gap-3">
          <FileText size={32} strokeWidth={2.5} />
          <div>
            <h4 className="font-black text-base uppercase">Import from Word</h4>
            <p className="text-xs text-gray-600 mt-1 max-w-sm">
              Equations are read from the document's own math markup, so they convert
              exactly — no formatting is lost the way it is when pasting.
            </p>
          </div>

          {state === 'parsing' ? (
            <div className="animate-pulse font-bold text-sm py-2">Reading document…</div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 border-2 border-black bg-[#F9E076] px-4 py-2 rounded-lg font-black text-sm shadow-[2px_2px_0px_0px_#000] hover:bg-[#F26B4D] transition-colors"
            >
              <Upload size={16} strokeWidth={3} /> Choose .docx file
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFile}
          />

          {state === 'error' && (
            <div className="w-full text-left text-xs bg-red-50 border-2 border-red-300 rounded-lg px-3 py-2 text-red-800">
              <AlertTriangle size={14} className="inline mr-1" />
              {error}
            </div>
          )}

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-bold text-gray-500 hover:underline"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ review
  return (
    <div className="border-2 border-black rounded-xl bg-white shadow-[4px_4px_0px_0px_#111] flex flex-col max-h-[70vh]">
      <div className="p-4 border-b-2 border-black bg-[#F4DFD8] shrink-0">
        <h4 className="font-black text-sm uppercase">Review before importing</h4>
        <p className="text-xs mt-1">
          Found <strong>{result.stats.questions}</strong> questions and{' '}
          <strong>{result.stats.equations}</strong> equations across{' '}
          {result.stats.paragraphs} paragraphs.
          {incomplete > 0 && (
            <span className="text-amber-800">
              {' '}
              {incomplete} have fewer than 2 options and are unticked.
            </span>
          )}
        </p>
        {result.stats.answersDetected > 0 ? (
          <p className="text-xs mt-1 font-bold text-green-800">
            ✓ Answer key found for {result.stats.answersDetected} of{' '}
            {result.stats.questions} — read from the highlighting in your document.
            {result.stats.answersDetected < result.stats.questions &&
              ' Set the rest by hand.'}
          </p>
        ) : (
          <p className="text-xs mt-1 font-bold">
            No answer highlighting found — set the correct answer for each below.
          </p>
        )}
      </div>

      <div className="overflow-y-auto p-4 flex flex-col gap-3">
        {questions.map((q, i) => (
          <div
            key={i}
            className={`border-2 rounded-lg p-3 transition-colors ${
              q.include ? 'border-black bg-white' : 'border-gray-300 bg-gray-100 opacity-60'
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={q.include}
                onChange={() => toggle(i)}
                className="mt-1 w-4 h-4 accent-[#F26B4D] cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">
                  <span className="text-gray-400 mr-1">{i + 1}.</span>
                  <MathText text={q.question_text} />
                </div>

                {q.options.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {q.options.map((opt, oi) => {
                      const isCorrect = q.correct_option_index === oi;
                      const fromDoc = isCorrect && q.answer_source;
                      return (
                        <label
                          key={oi}
                          className={`flex items-start gap-2 text-xs cursor-pointer rounded px-1 py-0.5 transition-colors ${
                            fromDoc
                              ? 'bg-green-100 border border-green-400'
                              : isCorrect
                              ? 'bg-orange-50'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`imp-correct-${i}`}
                            checked={isCorrect}
                            onChange={() => setCorrect(i, oi)}
                            disabled={!q.include}
                            className="mt-0.5 w-3.5 h-3.5 accent-[#F26B4D] shrink-0"
                          />
                          <span className="text-gray-400 font-bold">{'ABCD'[oi] || oi + 1}</span>
                          <span className="min-w-0">
                            <MathText text={opt} />
                          </span>
                          {fromDoc && (
                            <span className="ml-auto shrink-0 text-[10px] font-bold text-green-700 uppercase">
                              from doc
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-amber-700">
                    <AlertTriangle size={12} className="inline mr-1" />
                    No options detected — you'll need to add them manually.
                  </p>
                )}

                {q.answer_note && (
                  <p className="mt-1 text-[11px] text-green-700 font-bold">
                    Answer key in document: {q.answer_note}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}

        {result.unmatched.length > 0 && (
          <div className="border-2 border-dashed border-gray-400 rounded-lg p-3 text-xs">
            <button
              type="button"
              onClick={() => setShowSkipped((s) => !s)}
              className="font-bold underline"
            >
              {showSkipped ? 'Hide' : 'Show'} {result.unmatched.length} skipped paragraph
              {result.unmatched.length === 1 ? '' : 's'}
            </button>
            {showSkipped && (
              <ul className="mt-2 ml-4 list-disc space-y-1 text-gray-600">
                {result.unmatched.map((u, i) => (
                  <li key={i}>{u.slice(0, 160)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t-2 border-black bg-gray-50 flex items-center justify-between gap-3 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-sm font-bold text-gray-600 hover:underline"
        >
          <X size={14} strokeWidth={3} /> Cancel
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() =>
            onImport(
              selected.map(({ include, number, answer_note, answer_source, ...q }) => ({
                ...q,
                options: q.options.length >= 2 ? q.options : ['', ''],
              }))
            )
          }
          className="flex items-center gap-2 border-2 border-black bg-[#F9E076] px-4 py-2 rounded-lg font-black text-sm shadow-[2px_2px_0px_0px_#000] hover:bg-[#F26B4D] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={16} strokeWidth={3} /> Import {selected.length} question
          {selected.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
