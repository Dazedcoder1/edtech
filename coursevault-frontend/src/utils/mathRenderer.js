import katex from 'katex';

// Enhanced Word equation to LaTeX converter
export function convertToLatex(text) {
  if (!text) return text;
  
  let latex = text;
  
  // ============================================
  // STEP 1: Handle superscripts (², ³, etc.)
  // ============================================
  const superscripts = {
    '⁰': '^{0}',
    '¹': '^{1}',
    '²': '^{2}',
    '³': '^{3}',
    '⁴': '^{4}',
    '⁵': '^{5}',
    '⁶': '^{6}',
    '⁷': '^{7}',
    '⁸': '^{8}',
    '⁹': '^{9}',
    '⁺': '^{+}',
    '⁻': '^{-}',
    '⁼': '^{=}',
    '⁽': '^{(}',
    '⁾': '^{)}',
    'ⁿ': '^{n}',
  };
  
  // ============================================
  // STEP 2: Handle subscripts (₁, ₂, etc.)
  // ============================================
  const subscripts = {
    '₀': '_{0}',
    '₁': '_{1}',
    '₂': '_{2}',
    '₃': '_{3}',
    '₄': '_{4}',
    '₅': '_{5}',
    '₆': '_{6}',
    '₇': '_{7}',
    '₈': '_{8}',
    '₉': '_{9}',
    '₊': '_{+}',
    '₋': '_{-}',
    '₌': '_{=}',
    '₍': '_{(}',
    '₎': '_{)}',
  };
  
  // Convert superscripts
  Object.entries(superscripts).forEach(([word, latexCmd]) => {
    latex = latex.replaceAll(word, latexCmd);
  });
  
  // Convert subscripts
  Object.entries(subscripts).forEach(([word, latexCmd]) => {
    latex = latex.replaceAll(word, latexCmd);
  });
  
  // ============================================
  // STEP 3: Handle Word-style ^ notation
  // ============================================
  // Convert a^2 to a^{2}, a^b to a^{b}
  latex = latex.replace(/([a-zA-Z])\^(\d+)/g, '$1^{$2}');
  latex = latex.replace(/([a-zA-Z])\^([a-zA-Z])/g, '$1^{$2}');
  
  // Convert standalone ^2 to ^{2}
  latex = latex.replace(/\^(\d+)/g, '^{$1}');
  latex = latex.replace(/\^([a-zA-Z])/g, '^{$1}');
  
  // ============================================
  // STEP 4: Handle math symbols from Word
  // ============================================
  const mathSymbols = {
    '×': ' \\times ',
    '÷': ' \\div ',
    '√': '\\sqrt{',
    '∑': '\\sum ',
    '∫': '\\int ',
    'π': '\\pi ',
    'α': '\\alpha ',
    'β': '\\beta ',
    'γ': '\\gamma ',
    'δ': '\\delta ',
    'Δ': '\\Delta ',
    'θ': '\\theta ',
    'λ': '\\lambda ',
    'μ': '\\mu ',
    'σ': '\\sigma ',
    'Σ': '\\Sigma ',
    'τ': '\\tau ',
    'φ': '\\phi ',
    'ω': '\\omega ',
    'Ω': '\\Omega ',
    '≤': '\\leq ',
    '≥': '\\geq ',
    '≠': '\\neq ',
    '≈': '\\approx ',
    '∞': '\\infty ',
    '±': '\\pm ',
    '∂': '\\partial ',
    '∇': '\\nabla ',
    '∈': '\\in ',
    '∉': '\\notin ',
    '⊂': '\\subset ',
    '⊃': '\\supset ',
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
  };
  
  // Replace math symbols
  Object.entries(mathSymbols).forEach(([word, latexCmd]) => {
    latex = latex.replaceAll(word, latexCmd);
  });
  
  // ============================================
  // STEP 5: Handle absolute value bars
  // ============================================
  latex = latex.replace(/\|/g, '\\left|');
  
  // ============================================
  // STEP 6: Handle fractions and division
  // ============================================
  // Don't convert / to div if it's part of a fraction pattern
  // Only convert standalone division symbols
  latex = latex.replace(/ ÷ /g, ' \\div ');
  latex = latex.replace(/ \/ /g, ' \\div ');
  
  // ============================================
  // STEP 7: Handle special Word equation patterns
  // ============================================
  // Convert (a+b)^2 to (a+b)^{2}
  latex = latex.replace(/\(([^)]+)\)\^(\d+)/g, '($1)^{$2}');
  
  // Convert [a+b]^2 to [a+b]^{2}
  latex = latex.replace(/\[([^\]]+)\]\^(\d+)/g, '[$1]^{$2}');
  
  // ============================================
  // STEP 8: Clean up spacing
  // ============================================
  // Remove extra spaces around operators
  latex = latex.replace(/\s*=\s*/g, ' = ');
  latex = latex.replace(/\s*\+\s*/g, ' + ');
  latex = latex.replace(/\s*-\s*/g, ' - ');
  
  // Remove double spaces
  latex = latex.replace(/\s{2,}/g, ' ');
  
  // Trim
  latex = latex.trim();
  
  return latex;
}

// Check if text contains mathematical content
export function isMathText(text) {
  if (!text) return false;
  
  const mathPatterns = [
    // Unicode math symbols
    /[×÷√∫∑π∂∇∈∉⊂⊃∪∩∧∨¬∀∃∠⊥∥]/,
    // Superscripts and subscripts
    /[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/,
    // Greek letters
    /[αβγδεζηθικλμνξπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/,
    // Operators
    /\^/,
    /_/,
    // Comparison operators
    /[≤≥≠≈∞±∓×÷⁄]/,
    // Brackets
    /\|/,
    /\[/,
    /\]/,
    /\(/,
    /\)/,
    // Mathematical patterns
    /[=≠≤≥≈∝]/,
    // Variable with superscript: x², a³
    /[a-zA-Z][⁰¹²³⁴⁵⁶⁷⁸⁹]/,
    // Variable with subscript: x₁, y₂
    /[a-zA-Z][₀₁₂₃₄₅₆₇₈₉]/,
    // Variable^number pattern
    /[a-zA-Z]\^\d+/,
    // variable_number pattern
    /[a-zA-Z]_\d+/,
    // Number with superscript: 2², 3³
    /\d[⁰¹²³⁴⁵⁶⁷⁸⁹]/,
  ];
  
  return mathPatterns.some(pattern => pattern.test(text));
}

// Render math with KaTeX (inline)
export function renderMath(text) {
  if (!text) return text;
  
  // Convert to LaTeX first
  const latex = convertToLatex(text);
  
  // If no math, return plain text
  if (!isMathText(text) && !latex.includes('\\')) {
    return text;
  }
  
  try {
    // Try to render with KaTeX
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
    // If KaTeX fails, return plain text
    return text;
  }
}

// Render display math (block) with KaTeX
export function renderDisplayMath(text) {
  if (!text) return text;
  
  const latex = convertToLatex(text);
  
  if (!isMathText(text) && !latex.includes('\\')) {
    return text;
  }
  
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      trust: true
    });
  } catch (error) {
    console.log('Display render error:', error);
    return text;
  }
}

// Get plain text without any formatting
export function getPlainText(text) {
  if (!text) return text;
  
  // Remove any LaTeX commands
  let plain = text.replace(/\\[a-zA-Z]+\s*/g, '');
  plain = plain.replace(/\^\{[^}]*\}/g, '');
  plain = plain.replace(/_{[^}]*}/g, '');
  plain = plain.replace(/\\left\|/g, '|');
  plain = plain.replace(/\\right\|/g, '|');
  plain = plain.replace(/\{\\}/g, '');
  plain = plain.replace(/\\div/g, '/');
  plain = plain.replace(/\\times/g, '×');
  
  return plain;
}

// NEW: Direct render function for preview
export function renderMathPreview(text) {
  if (!text) return '';
  
  try {
    const latex = convertToLatex(text);
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      trust: true,
      macros: {
        "\\R": "\\mathbb{R}",
      }
    });
  } catch (error) {
    console.log('Preview render error:', error);
    return text;
  }
}

// NEW: Check if text is pure math (no regular text)
export function isPureMath(text) {
  if (!text) return false;
  
  // Check if the text contains math patterns and very few regular words
  const mathCount = (text.match(/[×÷√∫∑π≤≥≠≈∞±αβγδθλμσφω]/g) || []).length;
  const superscriptCount = (text.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g) || []).length;
  const subscriptCount = (text.match(/[₀₁₂₃₄₅₆₇₈₉]/g) || []).length;
  const wordCount = (text.match(/[a-zA-Z]{3,}/g) || []).length;
  
  // If it has many math symbols and few words, it's pure math
  return (mathCount + superscriptCount + subscriptCount) > wordCount;
}

// NEW: Extract LaTeX from rendered HTML
export function extractLatex(text) {
  if (!text) return '';
  return convertToLatex(text);
}