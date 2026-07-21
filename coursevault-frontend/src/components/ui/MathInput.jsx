import React, { useState, useRef, useEffect } from 'react';
import katex from 'katex';
import { convertToLatex, isMathText } from '../../utils/mathRenderer';

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
  const inputRef = useRef(null);

  // Function to render math with KaTeX
  const renderMathWithKatex = (text) => {
    if (!text) return '';
    
    try {
      // Convert to LaTeX first
      const latex = convertToLatex(text);
      
      // Render with KaTeX
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
        trust: true,
        macros: {
          "\\R": "\\mathbb{R}",
        }
      });
    } catch (error) {
      console.log('Render error:', error);
      return text;
    }
  };

  // Handle paste event
  const handlePaste = (e) => {
    // Get pasted text
    const pastedText = e.clipboardData.getData('text');
    
    // Check if it's math
    if (isMathText(pastedText) || pastedText.includes('^') || pastedText.includes('_')) {
      e.preventDefault();
      
      // Convert to LaTeX
      const latex = convertToLatex(pastedText);
      
      // Update the value with the LaTeX
      onChange(latex);
      
      // Show rendered preview
      try {
        const renderedHtml = renderMathWithKatex(latex);
        if (renderedHtml && renderedHtml !== latex) {
          setPreviewHtml(renderedHtml);
          setShowPreview(true);
          
          // Auto-hide preview after 5 seconds
          setTimeout(() => setShowPreview(false), 5000);
        }
      } catch (error) {
        console.log('Render error:', error);
      }
    }
  };

  const handleChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    // If user types math, show preview
    if (newValue && (isMathText(newValue) || newValue.includes('^') || newValue.includes('_'))) {
      try {
        const latex = convertToLatex(newValue);
        const renderedHtml = renderMathWithKatex(latex);
        if (renderedHtml && renderedHtml !== newValue) {
          setPreviewHtml(renderedHtml);
          setShowPreview(true);
        } else {
          setShowPreview(false);
        }
      } catch (error) {
        setShowPreview(false);
      }
    } else {
      setShowPreview(false);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Check if final value is math and render it
    if (value && (isMathText(value) || value.includes('^') || value.includes('_'))) {
      try {
        const latex = convertToLatex(value);
        const renderedHtml = renderMathWithKatex(latex);
        if (renderedHtml && renderedHtml !== value) {
          setPreviewHtml(renderedHtml);
          setShowPreview(true);
        }
      } catch (error) {
        setShowPreview(false);
      }
    }
  };

  // Update preview when value changes from parent
  useEffect(() => {
    if (value && isFocused && (isMathText(value) || value.includes('^') || value.includes('_'))) {
      try {
        const latex = convertToLatex(value);
        const renderedHtml = renderMathWithKatex(latex);
        if (renderedHtml && renderedHtml !== value) {
          setPreviewHtml(renderedHtml);
          setShowPreview(true);
        }
      } catch (error) {
        setShowPreview(false);
      }
    }
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
      
      {/* Math indicator */}
      {value && (isMathText(value) || value.includes('^') || value.includes('_')) && (
        <div className="mt-1 text-xs text-blue-500 flex items-center gap-1">
          <span>📐</span>
          <span>Math content detected</span>
        </div>
      )}
    </div>
  );
}