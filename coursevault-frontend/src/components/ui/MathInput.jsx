import React, { useState, useRef, useEffect } from 'react';
import { convertToLatex, isMathText, renderMixed } from '../../utils/mathRenderer';
import {
  readMathFromClipboard,
  insertAtCursor,
  repairMangledMath,
} from '../../utils/mathPasteHandler';

export default function MathInput({ 
  value, 
  onChange, 
  placeholder, 
  className = '',
  multiline = false,
  rows = 2
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [degradedPaste, setDegradedPaste] = useState(false);
  const [repairNotes, setRepairNotes] = useState([]);
  const [rawPaste, setRawPaste] = useState(null); // pre-repair text, for undo
  const inputRef = useRef(null);

  // Renders either bare math or prose with `$…$` islands.
  const renderMathWithKatex = (text) => {
    if (!text) return '';
    try {
      return renderMixed(text);
    } catch (error) {
      console.log('Render error:', error);
      return text;
    }
  };

  const showRendered = (text) => {
    try {
      const html = renderMathWithKatex(text);
      if (html && html !== text) {
        setPreviewHtml(html);
        setShowPreview(true);
        return;
      }
    } catch (error) {
      console.log('Render error:', error);
    }
    setShowPreview(false);
  };

  // Handle paste event.
  //
  // Prefer the clipboard's text/html flavour: when math is copied from a page
  // that used KaTeX/MathJax, the original TeX is embedded there. The text/plain
  // flavour is the flattened glyphs ("∫x2dx=3x3+C") and is unrecoverable.
  const handlePaste = (e) => {
    const result = readMathFromClipboard(e);
    if (!result.text) return;

    setDegradedPaste(false);
    setRepairNotes([]);
    setRawPaste(null);

    // Path 1 — the source embedded its original TeX. Exact, nothing to guess.
    if (result.lossless) {
      e.preventDefault();
      insertAtCursor(e.target, result.text, value, onChange);
      showRendered(result.text);
      return;
    }

    const pastedText = result.text;
    const isMathy =
      isMathText(pastedText) || pastedText.includes('^') || pastedText.includes('_');

    // Path 2 — structure was already lost. Reconstruct the most likely reading
    // and apply it, but keep the original so it can be put back.
    if (result.degraded) {
      e.preventDefault();
      const repaired = repairMangledMath(convertToLatex(pastedText));
      insertAtCursor(e.target, repaired.text, value, onChange);
      showRendered(repaired.text);
      setDegradedPaste(true);
      setRepairNotes(repaired.notes);
      setRawPaste(pastedText);
      return;
    }

    if (isMathy) {
      e.preventDefault();
      const latex = convertToLatex(pastedText);
      insertAtCursor(e.target, latex, value, onChange);
      showRendered(latex);
    }
  };

  const undoRepair = () => {
    if (rawPaste === null) return;
    onChange(rawPaste);
    showRendered(rawPaste);
    setDegradedPaste(false);
    setRepairNotes([]);
    setRawPaste(null);
  };

  const handleChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
    setDegradedPaste(false);

    if (newValue && (isMathText(newValue) || newValue.includes('^') || newValue.includes('_'))) {
      showRendered(newValue);
    } else {
      setShowPreview(false);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (value && (isMathText(value) || value.includes('^') || value.includes('_'))) {
      showRendered(value);
    }
  };

  // Update preview when value changes from parent
  useEffect(() => {
    if (value && isFocused && (isMathText(value) || value.includes('^') || value.includes('_'))) {
      showRendered(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused]);

  const InputComponent = multiline ? 'textarea' : 'input';

  return (
    <div className="w-full">
      <div className="relative">
        <InputComponent
          ref={inputRef}
          value={value || ''}
          onChange={handleChange}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          rows={multiline ? rows : undefined}
          className={`w-full border-2 border-black rounded-lg px-3 py-2 font-medium transition-colors ${
            showPreview ? 'border-blue-400 bg-blue-50' : 'bg-white'
          } ${className}`}
        />
        
        {/* Preview popup */}
        {showPreview && previewHtml && (
          <div className="absolute top-full left-0 right-0 z-20 mt-2 p-4 bg-white border-2 border-blue-400 rounded-lg shadow-lg animate-in">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">✨ Rendered Preview</span>
              <button 
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <div 
              className="preview-content p-3 bg-gray-50 rounded border border-gray-200 min-h-[40px] flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </div>
      
      {/* Degraded paste warning — the source carried no LaTeX, so exponents
          and fractions were already flattened before they reached us. */}
      {degradedPaste && (
        <div className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">
              ⚠️ This paste arrived without formatting — structure was reconstructed.
            </span>
            <button
              type="button"
              onClick={undoRepair}
              className="shrink-0 underline hover:no-underline font-semibold"
            >
              Undo
            </button>
          </div>
          {repairNotes.length > 0 && (
            <ul className="mt-1 ml-4 list-disc space-y-0.5 text-amber-700">
              {repairNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
          <div className="mt-1 text-amber-700">
            These are best guesses — check the preview before saving. If this came
            from a Word document, <strong>Import from Word (.docx)</strong> reads the
            equations exactly and needs no guessing.
          </div>
        </div>
      )}

      {/* Math indicator */}
      {!degradedPaste && value && (isMathText(value) || value.includes('^') || value.includes('_')) && (
        <div className="mt-1 text-xs text-blue-500 flex items-center gap-1">
          <span>📐</span>
          <span>Math content detected</span>
        </div>
      )}
    </div>
  );
}