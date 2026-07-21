import React, { useEffect, useRef } from 'react';
import katex from 'katex';
import { convertToLatex, isMathText } from '../../utils/mathRenderer';

export default function MathDisplay({ 
  text, 
  displayMode = false,
  className = '',
  fallback = null
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current && text) {
      // If it's math, render it
      if (isMathText(text) || text.includes('^') || text.includes('_') || text.includes('\\')) {
        try {
          // Convert to LaTeX
          const latex = convertToLatex(text);
          
          // Render with KaTeX
          const html = katex.renderToString(latex, {
            throwOnError: false,
            displayMode: displayMode,
            trust: true,
            macros: {
              "\\R": "\\mathbb{R}",
            }
          });
          
          // Set the HTML content
          containerRef.current.innerHTML = html;
        } catch (error) {
          console.log('Render error:', error);
          // If KaTeX fails, show the text
          containerRef.current.textContent = text;
        }
      } else {
        containerRef.current.textContent = text;
      }
    }
  }, [text, displayMode]);

  if (!text) return null;

  return (
    <span 
      ref={containerRef}
      className={`math-display ${className}`}
      style={{ display: displayMode ? 'block' : 'inline-block' }}
    />
  );
}