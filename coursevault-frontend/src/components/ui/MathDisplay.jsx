import React, { useMemo } from 'react';
import { renderMixed } from '../../utils/mathRenderer';

/**
 * Renders text that may contain maths.
 *
 * Delegates to renderMixed, which keeps prose out of math mode. The previous
 * implementation passed the whole string to KaTeX whenever it contained a
 * backslash, caret or underscore — so a question like
 *
 *   "The principle value of \cos^{-1}(-1/2) is"
 *
 * rendered as "Theprinciplevalueof cos⁻¹(−½) is", because math mode italicises
 * every letter as a variable and discards spaces between them.
 */
export default function MathDisplay({
  text,
  displayMode = false,
  className = '',
}) {
  const html = useMemo(() => {
    if (!text) return '';
    try {
      return renderMixed(text);
    } catch (error) {
      console.warn('[MathDisplay] render failed; showing plain text', error);
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [text]);

  if (!text) return null;

  return (
    <span
      className={`math-display ${className}`}
      style={{ display: displayMode ? 'block' : 'inline' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
