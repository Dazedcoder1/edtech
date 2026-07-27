import katex from 'katex';
import 'katex/dist/katex.min.css';

// ============================================
// ENHANCED CONVERTER - Handles all math types
// ============================================

export function convertToLatex(text) {
  if (!text) return text;
  let latex = text;

  // ============================================
  // STEP 0: Pre-processing - Clean up input
  // ============================================
  
  // Remove extra whitespace
  latex = latex.replace(/\s+/g, ' ').trim();

  // ============================================
  // STEP 1: Handle matrices
  // [[1,2],[3,4]] -> \begin{pmatrix}...\end{pmatrix}
  // ============================================
  latex = latex.replace(/\[\[([\s\S]+?)\]\]/g, (full, inner) => {
    const rows = inner
      .split(/\]\s*,\s*\[/)
      .map(row => row.replace(/^\[|\]$/g, ''))
      .map(row => row.split(',').map(cell => cell.trim()).join(' & '));
    return `\\begin{pmatrix}${rows.join(' \\\\ ')}\\end{pmatrix}`;
  });

  // ============================================
  // STEP 2: Handle square roots
  // √(expr) -> \sqrt{expr}
  // √123 -> \sqrt{123}
  // √x -> \sqrt{x}
  // ============================================
  latex = latex.replace(/√\(([^()]+)\)/g, '\\sqrt{$1}');
  latex = latex.replace(/√(\d+(?:\.\d+)?)/g, '\\sqrt{$1}');
  latex = latex.replace(/√([a-zA-Z])/g, '\\sqrt{$1}');

  // ============================================
  // STEP 3: Handle nth roots
  // ∛x -> \sqrt[3]{x}
  // ∜x -> \sqrt[4]{x}
  // ============================================
  latex = latex.replace(/∛/g, '\\sqrt[3]{}');
  latex = latex.replace(/∜/g, '\\sqrt[4]{}');

  // ============================================
  // STEP 4: Handle fractions
  // a/b -> \frac{a}{b}
  // (a+b)/(c+d) -> \frac{a+b}{c+d}
  // ============================================
  
  // Simple fractions: a/b
  latex = latex.replace(/([a-zA-Z\d])\/([a-zA-Z\d])/g, '\\frac{$1}{$2}');
  
  // Complex fractions: (a+b)/(c+d)
  latex = latex.replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, '\\frac{$1}{$2}');
  
  // Mixed: a/(b+c)
  latex = latex.replace(/([a-zA-Z\d])\s*\/\s*\(([^()]+)\)/g, '\\frac{$1}{$2}');
  
  // Mixed: (a+b)/c
  latex = latex.replace(/\(([^()]+)\)\s*\/\s*([a-zA-Z\d])/g, '\\frac{$1}{$2}');

  // ============================================
  // STEP 5: Handle superscripts and subscripts
  // ============================================
  const superscripts = {
    '⁰': '^{0}', '¹': '^{1}', '²': '^{2}', '³': '^{3}',
    '⁴': '^{4}', '⁵': '^{5}', '⁶': '^{6}', '⁷': '^{7}',
    '⁸': '^{8}', '⁹': '^{9}', '⁺': '^{+}', '⁻': '^{-}',
    '⁼': '^{=}', '⁽': '^{(}', '⁾': '^{)}', 'ⁿ': '^{n}'
  };
  
  const subscripts = {
    '₀': '_{0}', '₁': '_{1}', '₂': '_{2}', '₃': '_{3}',
    '₄': '_{4}', '₅': '_{5}', '₆': '_{6}', '₇': '_{7}',
    '₈': '_{8}', '₉': '_{9}', '₊': '_{+}', '₋': '_{-}',
    '₌': '_{=}', '₍': '_{(}', '₎': '_{)}'
  };

  // Convert superscripts
  Object.entries(superscripts).forEach(([word, latexCmd]) => {
    latex = latex.replaceAll(word, latexCmd);
  });
  
  // Convert subscripts
  Object.entries(subscripts).forEach(([word, latexCmd]) => {
    latex = latex.replaceAll(word, latexCmd);
  });

  // Word-style ^ notation
  latex = latex.replace(/([a-zA-Z\d])\^(\d+)/g, '$1^{$2}');
  latex = latex.replace(/([a-zA-Z\d])\^([a-zA-Z])/g, '$1^{$2}');
  latex = latex.replace(/\^(\d+)/g, '^{$1}');
  latex = latex.replace(/\^([a-zA-Z])/g, '^{$1}');

  // Word-style _ notation
  latex = latex.replace(/([a-zA-Z\d])_(\d+)/g, '$1_{$2}');
  latex = latex.replace(/([a-zA-Z\d])_([a-zA-Z])/g, '$1_{$2}');

  // ============================================
  // STEP 6: Handle integrals and derivatives
  // ∫ x dx -> \int x \, dx
  // ∫_a^b x dx -> \int_{a}^{b} x \, dx
  // ============================================
  latex = latex.replace(/∫/g, '\\int');
  latex = latex.replace(/∬/g, '\\iint');
  latex = latex.replace(/∭/g, '\\iiint');
  latex = latex.replace(/∮/g, '\\oint');
  
  // Add differential d
  latex = latex.replace(/\\int\s+([^d]*?)\s+d([a-zA-Z])/g, '\\int $1 \\, d$2');
  
  // Integrals with limits
  latex = latex.replace(/∫_([^{])([^}]*?)\^([^{])([^}]*?)/g, '\\int_{$1$2}^{$3$4}');
  latex = latex.replace(/∫_\{([^}]*?)\}\^\{([^}]*?)\}/g, '\\int_{$1}^{$2}');

  // ============================================
  // STEP 7: Handle vectors
  // ->a or \vec{a} -> \vec{a}
  // ============================================
  latex = latex.replace(/->([a-zA-Z])/g, '\\vec{$1}');
  latex = latex.replace(/\\vec\{([^}]*?)\}/g, '\\vec{$1}');
  
  // Vector with arrow
  latex = latex.replace(/→([a-zA-Z])/g, '\\vec{$1}');
  
  // Bold vectors
  latex = latex.replace(/\\mathbf\{([^}]*?)\}/g, '\\mathbf{$1}');

  // ============================================
  // STEP 8: Math symbols
  // ============================================
  const mathSymbols = {
    '×': ' \\times ',
    '÷': ' \\div ',
    '∑': '\\sum ',
    '∏': '\\prod ',
    'π': '\\pi ',
    'α': '\\alpha ',
    'β': '\\beta ',
    'γ': '\\gamma ',
    'δ': '\\delta ',
    'ε': '\\epsilon ',
    'ζ': '\\zeta ',
    'η': '\\eta ',
    'θ': '\\theta ',
    'ι': '\\iota ',
    'κ': '\\kappa ',
    'λ': '\\lambda ',
    'μ': '\\mu ',
    'ν': '\\nu ',
    'ξ': '\\xi ',
    'ο': '\\omicron ',
    'π': '\\pi ',
    'ρ': '\\rho ',
    'σ': '\\sigma ',
    'τ': '\\tau ',
    'υ': '\\upsilon ',
    'φ': '\\phi ',
    'χ': '\\chi ',
    'ψ': '\\psi ',
    'ω': '\\omega ',
    'Α': '\\Alpha ',
    'Β': '\\Beta ',
    'Γ': '\\Gamma ',
    'Δ': '\\Delta ',
    'Ε': '\\Epsilon ',
    'Ζ': '\\Zeta ',
    'Η': '\\Eta ',
    'Θ': '\\Theta ',
    'Ι': '\\Iota ',
    'Κ': '\\Kappa ',
    'Λ': '\\Lambda ',
    'Μ': '\\Mu ',
    'Ν': '\\Nu ',
    'Ξ': '\\Xi ',
    'Ο': '\\Omicron ',
    'Π': '\\Pi ',
    'Ρ': '\\Rho ',
    'Σ': '\\Sigma ',
    'Τ': '\\Tau ',
    'Υ': '\\Upsilon ',
    'Φ': '\\Phi ',
    'Χ': '\\Chi ',
    'Ψ': '\\Psi ',
    'Ω': '\\Omega ',
    '≤': '\\leq ',
    '≥': '\\geq ',
    '≠': '\\neq ',
    '≈': '\\approx ',
    '≡': '\\equiv ',
    '≅': '\\cong ',
    '∝': '\\propto ',
    '∞': '\\infty ',
    '±': '\\pm ',
    '∓': '\\mp ',
    '∂': '\\partial ',
    '∇': '\\nabla ',
    '∈': '\\in ',
    '∉': '\\notin ',
    '⊂': '\\subset ',
    '⊃': '\\supset ',
    '⊆': '\\subseteq ',
    '⊇': '\\supseteq ',
    '∪': '\\cup ',
    '∩': '\\cap ',
    '∧': '\\land ',
    '∨': '\\lor ',
    '¬': '\\neg ',
    '∀': '\\forall ',
    '∃': '\\exists ',
    '∠': '\\angle ',
    '⊥': '\\perp ',
    '∥': '\\parallel ',
    '∡': '\\measuredangle ',
    '□': '\\square ',
    'ℵ': '\\aleph ',
    'ℏ': '\\hbar ',
    'ℜ': '\\Re ',
    'ℑ': '\\Im ',
    'ℓ': '\\ell ',
    'ℱ': '\\mathcal{F}',
    'ℒ': '\\mathcal{L}',
    'ℋ': '\\mathcal{H}'
  };
  
  Object.entries(mathSymbols).forEach(([word, latexCmd]) => {
    latex = latex.replaceAll(word, latexCmd);
  });

  // ============================================
  // STEP 9: Handle absolute value and norms
  // |x| -> \left|x\right|
  // ||x|| -> \left\|x\right\|
  // ============================================
  latex = latex.replace(/\|\|([^|]*?)\|\|/g, '\\left\\| $1 \\right\\|');
  latex = latex.replace(/\|([^|]*?)\|/g, '\\left| $1 \\right|');

  // ============================================
  // STEP 10: Handle brackets
  // (a+b) -> \left(a+b\right)
  // [a+b] -> \left[a+b\right]
  // {a+b} -> \left\{a+b\right\}
  // ============================================
  latex = latex.replace(/\(([^()]*?)\)/g, '\\left( $1 \\right)');
  latex = latex.replace(/\[([^\[\]]*?)\]/g, '\\left[ $1 \\right]');
  latex = latex.replace(/\\{([^{}]*?)\\}/g, '\\left\\{ $1 \\right\\}');

  // ============================================
  // STEP 11: Handle binomial coefficients
  // C(n,k) -> \binom{n}{k}
  // ============================================
  latex = latex.replace(/C\(([^,]+),\s*([^)]+)\)/g, '\\binom{$1}{$2}');

  // ============================================
  // STEP 12: Handle derivatives
  // d/dx -> \frac{d}{dx}
  // d^2/dx^2 -> \frac{d^2}{dx^2}
  // ============================================
  latex = latex.replace(/d(\d*)\/d([a-zA-Z])(\d*)/g, (match, num1, var1, num2) => {
    if (num1 === '' && num2 === '') {
      return `\\frac{d}{d${var1}}`;
    } else if (num1 !== '' && num2 === '') {
      return `\\frac{d^{${num1}}}{d${var1}}`;
    } else if (num1 === '' && num2 !== '') {
      return `\\frac{d}{d${var1}^{${num2}}}`;
    } else {
      return `\\frac{d^{${num1}}}{d${var1}^{${num2}}}`;
    }
  });

  // ============================================
  // STEP 13: Handle trig functions
  // sin, cos, tan, etc.
  // ============================================
  const trigFunctions = [
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'sinh', 'cosh', 'tanh', 'coth',
    'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc'
  ];
  
  trigFunctions.forEach(func => {
    latex = latex.replace(new RegExp(`(?<![a-zA-Z])${func}(?![a-zA-Z])`, 'g'), `\\${func} `);
  });

  // ============================================
  // STEP 14: Handle logarithms
  // log, ln, lg
  // ============================================
  latex = latex.replace(/(?<![a-zA-Z])log(?![a-zA-Z])/g, '\\log ');
  latex = latex.replace(/(?<![a-zA-Z])ln(?![a-zA-Z])/g, '\\ln ');
  latex = latex.replace(/(?<![a-zA-Z])lg(?![a-zA-Z])/g, '\\log_{10} ');

  // ============================================
  // STEP 15: Handle limits
  // lim -> \lim
  // ============================================
  latex = latex.replace(/(?<![a-zA-Z])lim(?![a-zA-Z])/g, '\\lim ');

  // ============================================
  // STEP 16: Handle scientific notation
  // 1.2e3 -> 1.2 \times 10^{3}
  // ============================================
  latex = latex.replace(/(\d+\.?\d*)e([+-]?\d+)/g, '$1 \\times 10^{$2}');

  // ============================================
  // STEP 17: Handle degree symbols
  // 45° -> 45^\circ
  // ============================================
  latex = latex.replace(/°(?![a-zA-Z])/g, '^\\circ ');

  // ============================================
  // STEP 18: Clean up spacing
  // ============================================
  // Remove extra spaces around operators but keep needed spaces
  latex = latex.replace(/\s*=\s*/g, ' = ');
  latex = latex.replace(/\s*\+\s*/g, ' + ');
  latex = latex.replace(/\s*-\s*/g, ' - ');
  latex = latex.replace(/\s*\*\s*/g, ' \\cdot ');
  
  // Remove double spaces
  latex = latex.replace(/\s{2,}/g, ' ');
  
  // Clean up \, spacing for differentials
  latex = latex.replace(/\\,\s+/g, '\\,');
  
  // Clean up \left and \right spacing
  latex = latex.replace(/\\left\s+/g, '\\left');
  latex = latex.replace(/\\right\s+/g, '\\right');

  // ============================================
  // STEP 19: Final polish
  // ============================================
  // Fix common issues
  latex = latex.replace(/\{\s+/g, '{');
  latex = latex.replace(/\s+\}/g, '}');
  latex = latex.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '\\frac{$1}{$2}');
  
  // Trim final result
  latex = latex.trim();

  return latex;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function isMathText(text) {
  if (!text) return false;
  
  const mathPatterns = [
    /[×÷√∫∑∏π∂∇∈∉⊂⊃∪∩∧∨¬∀∃∠⊥∥≤≥≠≈∞±]/,
    /[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/,
    /[αβγδεζηθικλμνξπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/,
    /\^|_/,
    /\|/,
    /\[\[[\s\S]+\]\]/,
    /[a-zA-Z]\^/,
    /[a-zA-Z]_/,
    /\\[a-zA-Z]+/,
    /[=≠≤≥≈∝≡≅]/
  ];
  
  return mathPatterns.some(pattern => pattern.test(text));
}

export function renderMath(text, displayMode = false) {
  if (!text) return text;
  
  const latex = convertToLatex(text);
  
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: displayMode,
      trust: true,
      macros: {
        "\\R": "\\mathbb{R}",
        "\\N": "\\mathbb{N}",
        "\\Z": "\\mathbb{Z}",
        "\\Q": "\\mathbb{Q}",
        "\\C": "\\mathbb{C}"
      }
    });
  } catch (error) {
    console.log('Render error:', error);
    return text;
  }
}

export function renderMathPreview(text) {
  return renderMath(text, false);
}

export function renderDisplayMath(text) {
  return renderMath(text, true);
}

export function getPlainText(text) {
  if (!text) return text;
  
  let plain = text
    .replace(/\\[a-zA-Z]+(?:\s|$)/g, '')
    .replace(/\^\{[^}]*\}/g, '')
    .replace(/_{[^}]*}/g, '')
    .replace(/\\left\|/g, '|')
    .replace(/\\right\|/g, '|')
    .replace(/\\begin\{[^}]*\}/g, '')
    .replace(/\\end\{[^}]*\}/g, '')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .replace(/\\cdot/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\times/g, '×');
  
  return plain;
}

export function isPureMath(text) {
  if (!text) return false;
  
  const mathCount = (text.match(/[×÷√∫∑π≤≥≠≈∞±αβγδθλμσφω]/g) || []).length;
  const superscriptCount = (text.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g) || []).length;
  const subscriptCount = (text.match(/[₀₁₂₃₄₅₆₇₈₉]/g) || []).length;
  const wordCount = (text.match(/[a-zA-Z]{3,}/g) || []).length;
  
  return (mathCount + superscriptCount + subscriptCount) > wordCount;
}

export function extractLatex(text) {
  if (!text) return '';
  return convertToLatex(text);
}

// ============================================
// MATH TEXT COMPONENT
// ============================================

import React, { useMemo } from 'react';

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
    const latex = convertToLatex(value);
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: displayMode,
      trust: true,
      macros: {
        "\\R": "\\mathbb{R}",
        "\\N": "\\mathbb{N",
        "\\Z": "\\mathbb{Z}",
        "\\Q": "\\mathbb{Q}",
        "\\C": "\\mathbb{C}"
      }
    });
  } catch (e) {
    console.log('KaTeX render error:', e);
    return value;
  }
}

export default function MathText({ text, className = '' }) {
  const segments = useMemo(() => splitSegments(text || ''), [text]);

  if (segments.length === 0) return null;

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return seg.value.split('\n').map((line, j) => (
            <React.Fragment key={`${i}-${j}`}>
              {j > 0 && <br />}
              {line}
            </React.Fragment>
          ));
        }
        const html = renderKatex(seg.value, seg.type === 'block');
        return seg.type === 'block' ? (
          <div key={i} className="my-2 overflow-x-auto text-center" 
               dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
        );
      })}
    </span>
  );
}

// ============================================
// ADDITIONAL EXPORTS FOR COMPLEX MATH
// ============================================

// Export a function to handle multi-line equations
export function renderMultiLineMath(text) {
  if (!text) return '';
  
  // Split by new lines
  const lines = text.split('\n').filter(line => line.trim());
  
  // Wrap in align environment for multi-line
  if (lines.length > 1) {
    const aligned = lines.map(line => {
      // Check if line contains equals sign for alignment
      if (line.includes('=')) {
        const parts = line.split('=').map(p => p.trim());
        return `${parts[0]} &= ${parts.slice(1).join(' = ')}`;
      }
      return line.trim();
    }).join(' \\\\ ');
    
    return renderDisplayMath(`\\begin{aligned} ${aligned} \\end{aligned}`);
  }
  
  return renderMath(text);
}

// Export a function to handle cases/conditional equations
export function renderCasesMath(text) {
  if (!text) return '';
  
  // Detect and handle cases
  const casesRegex = /\{([^}]*?)\s*,\s*([^}]*?)\s*,\s*([^}]*?)\s*\}/;
  const match = text.match(casesRegex);
  
  if (match) {
    const conditions = match.slice(1).map(c => c.trim());
    const casesLatex = conditions.map((condition, index) => {
      return `${condition} & \\text{if } ${index === 0 ? 'condition 1' : `condition ${index + 1}`}`;
    }).join(' \\\\ ');
    return renderDisplayMath(`\\begin{cases} ${casesLatex} \\end{cases}`);
  }
  
  return renderMath(text);
}