import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Splits a string into plain-text / block-math / inline-math segments.
// Block math: $$ ... $$   Inline math: $ ... $
function splitSegments(text) {
  if (!text) return [];
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'block', value: match[1] });
    } else {
      segments.push({ type: 'inline', value: match[2] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

function renderKatex(value, displayMode) {
  try {
    return katex.renderToString(value, {
      throwOnError: false,
      displayMode,
    });
  } catch (e) {
    return value;
  }
}

// Usage: <MathText text="Solve $x^2 + 2x + 1 = 0$ using the formula" />
// Supports block matrices: $$\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}$$
export default function MathText({ text, className = '' }) {
  const segments = useMemo(() => splitSegments(text || ''), [text]);

  if (segments.length === 0) return null;

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          // preserve line breaks in plain text
          return seg.value.split('\n').map((line, j) => (
            <React.Fragment key={`${i}-${j}`}>
              {j > 0 && <br />}
              {line}
            </React.Fragment>
          ));
        }
        const html = renderKatex(seg.value, seg.type === 'block');
        return seg.type === 'block' ? (
          <div key={i} className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
        );
      })}
    </span>
  );
}