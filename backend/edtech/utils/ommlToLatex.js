/**
 * OMML (Office Math Markup Language) -> LaTeX.
 *
 * Word stores equations as OMML, a structured XML tree. Unlike a clipboard
 * text/plain capture — where "∫x²dx = x³/3 + C" collapses into the
 * unrecoverable "∫x2dx=3x3+C" — OMML preserves every relationship explicitly:
 * <m:sSup> knows what the exponent is, <m:f> knows numerator from denominator.
 * So this conversion is exact. There is no guessing anywhere in this file.
 *
 * DOM-agnostic by design: it only uses tagName / childNodes / getAttribute /
 * nodeValue, so the browser's DOMParser and @xmldom/xmldom in Node both work.
 * That lets the same engine serve the paste path and the .docx import path.
 *
 * ── KEEP IN SYNC ────────────────────────────────────────────────────────────
 * This file is mirrored at:
 *   coursevault-frontend/src/utils/ommlToLatex.js   (clipboard paste)
 *   backend/edtech/utils/ommlToLatex.js             (.docx import)
 * The two Docker build contexts are separate, so a shared parent folder would
 * break the image builds. Edit one, copy to the other.
 */

const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** Tag name without its namespace prefix, lower-cased. */
function local(node) {
  if (!node) return '';
  const name = node.localName || node.tagName || node.nodeName || '';
  return String(name).replace(/^.*:/, '').toLowerCase();
}

function attr(node, name) {
  if (!node || !node.getAttribute) return null;
  return (
    node.getAttribute(`m:${name}`) ??
    node.getAttribute(name) ??
    (node.getAttributeNS ? node.getAttributeNS(M_NS, name) : null)
  );
}

function elementChildren(node) {
  if (!node || !node.childNodes) return [];
  return Array.from(node.childNodes).filter((n) => n.nodeType === 1);
}

/** First element child whose local name matches. */
// `local()` lower-cases, so callers may pass OMML's camelCase names
// (begChr, subHide, limLoc, …) and still match.
function child(node, name) {
  const want = name.toLowerCase();
  return elementChildren(node).find((n) => local(n) === want) || null;
}

function childrenNamed(node, name) {
  const want = name.toLowerCase();
  return elementChildren(node).filter((n) => local(n) === want);
}

// ---------------------------------------------------------------------------
// Symbol tables
// ---------------------------------------------------------------------------

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
  'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'deg', 'dim',
  'ker', 'arg', 'sup', 'inf',
]);

const NARY = {
  '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
  '⋃': '\\bigcup', '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge',
};

const ACCENTS = {
  '⃗': '\\vec', '→': '\\vec', '̂': '\\hat', '̅': '\\bar', '̄': '\\bar',
  '̃': '\\tilde', '̇': '\\dot', '̈': '\\ddot', '̆': '\\breve', '̌': '\\check',
};

const SYMBOLS = {
  '−': '-', '–': '-', '—': '-', '·': '\\cdot ', '×': '\\times ', '÷': '\\div ',
  '±': '\\pm ', '∓': '\\mp ', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ',
  '≈': '\\approx ', '≡': '\\equiv ', '≅': '\\cong ', '∝': '\\propto ',
  '∞': '\\infty ', '∂': '\\partial ', '∇': '\\nabla ', '√': '\\surd ',
  '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊃': '\\supset ',
  '⊆': '\\subseteq ', '⊇': '\\supseteq ', '∪': '\\cup ', '∩': '\\cap ',
  '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ', '¬': '\\neg ',
  '∧': '\\land ', '∨': '\\lor ', '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ',
  '⇔': '\\Leftrightarrow ', '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ',
  '∠': '\\angle ', '⊥': '\\perp ', '∥': '\\parallel ', '°': '^{\\circ}',
  '′': "'", '″': "''", '…': '\\ldots ', '⋯': '\\cdots ', '⋮': '\\vdots ',
  '⋱': '\\ddots ', '∴': '\\therefore ', '∵': '\\because ',
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
  'ε': '\\varepsilon ', 'ϵ': '\\epsilon ', 'ζ': '\\zeta ', 'η': '\\eta ',
  'θ': '\\theta ', 'ϑ': '\\vartheta ', 'ι': '\\iota ', 'κ': '\\kappa ',
  'λ': '\\lambda ', 'μ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ',
  'ρ': '\\rho ', 'σ': '\\sigma ', 'τ': '\\tau ', 'υ': '\\upsilon ',
  'φ': '\\varphi ', 'ϕ': '\\phi ', 'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ',
  'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ',
  'Ξ': '\\Xi ', 'Π': '\\Pi ', 'Σ': '\\Sigma ', 'Υ': '\\Upsilon ',
  'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega ',
  '∆': '\\Delta ', '∼': '\\sim ', '≃': '\\simeq ', '≪': '\\ll ', '≫': '\\gg ',
  '⇌': '\\rightleftharpoons ', '↦': '\\mapsto ', '∗': '\\ast ', '∙': '\\bullet ',
  'Ω': '\\Omega ', 'µ': '\\mu ', '⋅': '\\cdot ', '∆': '\\Delta ',
  'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}',
  'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}', 'ℏ': '\\hbar ', 'ℓ': '\\ell ',
};

// LaTeX characters that must be escaped when they appear as literal text.
const ESCAPES = {
  '\\': '\\backslash ', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
  '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\sim ', '^': '\\hat{}',
};

// Invisible math control characters. Word emits these to mark function
// application and implied multiplication; they carry no visual meaning and
// KaTeX has no glyph for them.
const INVISIBLE = new Set([
  '\u2061', // FUNCTION APPLICATION
  '\u2062', // INVISIBLE TIMES
  '\u2063', // INVISIBLE SEPARATOR
  '\u2064', // INVISIBLE PLUS
  '\u200B', // ZERO WIDTH SPACE
  '\u200C', '\u200D', '\uFEFF',
]);

// Upright multi-letter operators Word writes as ordinary text.
const OPERATOR_WORDS = new Set(['adj', 'tr', 'rank', 'curl', 'div', 'grad', 'lcm', 'mod']);

// Longest-match first, so "arcsin" wins over "arc"+"sin" and "cosh" over "cos".
const FUNC_BY_LENGTH = [...FUNCTIONS].sort((a, b) => b.length - a.length);

/**
 * Split function names out of a space-free run: "secx+tanx" -> "\sec x+\tan x".
 *
 * Restricted to runs with no spaces because those are unambiguously packed
 * maths. A run containing spaces may be prose ("Determinant of"), where
 * splitting would corrupt words that merely contain a function name.
 */
function splitFunctions(text) {
  if (/\s/.test(text)) return null;
  if (!FUNC_BY_LENGTH.some((f) => text.toLowerCase().includes(f))) return null;

  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i).toLowerCase();
    const hit = FUNC_BY_LENGTH.find((f) => rest.startsWith(f));
    if (hit) {
      out += `\\${hit} `;
      i += hit.length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

function escapeText(text) {
  let out = '';
  for (const ch of String(text)) {
    if (INVISIBLE.has(ch)) continue;
    if (SYMBOLS[ch] !== undefined) out += SYMBOLS[ch];
    else if (ESCAPES[ch] !== undefined) out += ESCAPES[ch];
    else out += ch;
  }
  return out;
}

/** Wrap in braces unless it's already a single token or braced group. */
function group(latex) {
  const s = (latex || '').trim();
  if (s === '') return '{}';
  if (s.length === 1) return s;
  if (/^\\[a-zA-Z]+$/.test(s)) return s;
  return `{${s}}`;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function convertChildren(node) {
  return elementChildren(node).map(convertNode).join('');
}

/** Contents of an <m:e> / <m:num> / <m:den> style wrapper. */
function convertSlot(node) {
  return node ? convertChildren(node).trim() : '';
}

function convertRun(node) {
  // A run's visible text lives in <m:t>; ignore <m:rPr>/<w:rPr> formatting.
  const text = childrenNamed(node, 't').map((t) => t.textContent ?? '').join('');
  if (!text) return '';

  const props = child(node, 'rpr');
  const style = props ? attr(child(props, 'sty'), 'val') : null;

  // sty="p" means upright — Word uses it for function names like sin/tan/log.
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (FUNCTIONS.has(lower)) return `\\${lower} `;
  if (OPERATOR_WORDS.has(lower)) return `\\mathrm{${trimmed}} `;

  // sty="p" means upright — Word uses it for function and operator names.
  if (style === 'p' && /^[A-Za-z]+$/.test(trimmed)) {
    return `\\mathrm{${trimmed}}`;
  }

  const split = splitFunctions(text);
  if (split !== null) {
    // Re-escape the non-function remainder, leaving the \commands intact.
    return split.replace(/(\\[a-zA-Z]+ )|([^\\]+)/g, (m, cmd, plain) =>
      cmd ? cmd : escapeText(plain)
    );
  }

  return escapeText(text);
}

function convertFraction(node) {
  const props = child(node, 'fpr');
  const type = props ? attr(child(props, 'type'), 'val') : null;
  const num = convertSlot(child(node, 'num'));
  const den = convertSlot(child(node, 'den'));

  if (type === 'lin') return `${group(num)}/${group(den)}`;
  if (type === 'noBar') return `\\binom{${num}}{${den}}`;
  if (type === 'skw') return `{}^{${num}}\\!/\\!_{${den}}`;
  return `\\frac{${num}}{${den}}`;
}

function convertRadical(node) {
  const props = child(node, 'radpr');
  const hidden = props ? attr(child(props, 'degHide'), 'val') : null;
  const deg = convertSlot(child(node, 'deg'));
  const body = convertSlot(child(node, 'e'));
  const degreeHidden = hidden === '1' || hidden === 'true' || deg === '';
  return degreeHidden ? `\\sqrt{${body}}` : `\\sqrt[${deg}]{${body}}`;
}

function convertNary(node) {
  const props = child(node, 'narypr');
  // OMML's default n-ary operator when m:chr is omitted is the integral sign.
  const chr = (props ? attr(child(props, 'chr'), 'val') : null) || '∫';
  const op = NARY[chr] || `\\${'operatorname'}{${escapeText(chr)}}`;

  const subHidden = props && attr(child(props, 'subHide'), 'val') === '1';
  const supHidden = props && attr(child(props, 'supHide'), 'val') === '1';
  const limLoc = props ? attr(child(props, 'limLoc'), 'val') : null;

  const sub = subHidden ? '' : convertSlot(child(node, 'sub'));
  const sup = supHidden ? '' : convertSlot(child(node, 'sup'));
  const body = convertSlot(child(node, 'e'));

  // undOvr = limits sit under/over the operator rather than beside it.
  const limits = limLoc === 'undOvr' && (sub || sup) ? '\\limits' : '';

  let out = op + limits;
  if (sub) out += `_{${sub}}`;
  if (sup) out += `^{${sup}}`;

  // "…xdx" reads as a product; the differential wants a thin space: "…x\,dx".
  const spaced = body.replace(/\s*d([a-zA-Z])\s*$/, '\\,d$1');
  return `${out} ${spaced}`;
}

function convertFunc(node) {
  const name = convertSlot(child(node, 'fname'));
  const body = convertSlot(child(node, 'e'));
  const sep = /[\\^_]$|\}$/.test(name) ? ' ' : ' ';
  return `${name}${sep}${body}`;
}

const OPEN_DELIM = {
  '(': '(', '[': '[', '{': '\\{', '|': '|', '‖': '\\|', '⟨': '\\langle',
  '⌊': '\\lfloor', '⌈': '\\lceil', '': '.',
};
const CLOSE_DELIM = {
  ')': ')', ']': ']', '}': '\\}', '|': '|', '‖': '\\|', '⟩': '\\rangle',
  '⌋': '\\rfloor', '⌉': '\\rceil', '': '.',
};
// A delimiter wrapping a bare matrix maps onto a LaTeX matrix environment,
// which typesets far better than \left| ... \begin{matrix} ... \right|.
const MATRIX_ENV = { '(': 'pmatrix', '[': 'bmatrix', '{': 'Bmatrix', '|': 'vmatrix', '‖': 'Vmatrix' };

function convertDelim(node) {
  const props = child(node, 'dpr');
  const beg = props ? attr(child(props, 'begChr'), 'val') : null;
  const end = props ? attr(child(props, 'endChr'), 'val') : null;
  const sepChr = props ? attr(child(props, 'sepChr'), 'val') : null;

  const open = beg === null ? '(' : beg;
  const close = end === null ? ')' : end;
  const slots = childrenNamed(node, 'e');

  // Determinant / matrix shorthand.
  if (slots.length === 1) {
    const inner = elementChildren(slots[0]).filter((n) => local(n) !== 'ctrlpr');
    if (inner.length === 1 && local(inner[0]) === 'm' && MATRIX_ENV[open]) {
      return convertMatrix(inner[0], MATRIX_ENV[open]);
    }
  }

  const sep = sepChr === null ? ',' : sepChr;
  const body = slots.map(convertSlot).join(sep === '|' ? ' \\mid ' : `${sep} `);

  const L = OPEN_DELIM[open] ?? escapeText(open);
  const R = CLOSE_DELIM[close] ?? escapeText(close);
  return `\\left${L} ${body} \\right${R}`;
}

function convertMatrix(node, env = 'matrix') {
  const rows = childrenNamed(node, 'mr').map((row) =>
    childrenNamed(row, 'e').map(convertSlot).join(' & ')
  );
  return `\\begin{${env}} ${rows.join(' \\\\ ')} \\end{${env}}`;
}

function convertAccent(node) {
  const props = child(node, 'accpr');
  const chr = (props ? attr(child(props, 'chr'), 'val') : null) || '̂';
  const cmd = ACCENTS[chr] || '\\hat';
  return `${cmd}{${convertSlot(child(node, 'e'))}}`;
}

function convertNode(node) {
  const name = local(node);

  switch (name) {
    case 'omath':
    case 'omathpara':
    case 'e':
    case 'num':
    case 'den':
      return convertChildren(node);

    case 'r':
      return convertRun(node);
    case 't':
      return escapeText(node.textContent ?? '');

    case 'f':
      return convertFraction(node);
    case 'rad':
      return convertRadical(node);
    case 'nary':
      return convertNary(node);
    case 'func':
      return convertFunc(node);
    case 'd':
      return convertDelim(node);
    case 'm':
      return convertMatrix(node);
    case 'acc':
      return convertAccent(node);

    case 'ssup':
      return `${group(convertSlot(child(node, 'e')))}^{${convertSlot(child(node, 'sup'))}}`;
    case 'ssub':
      return `${group(convertSlot(child(node, 'e')))}_{${convertSlot(child(node, 'sub'))}}`;
    case 'ssubsup':
      return (
        `${group(convertSlot(child(node, 'e')))}` +
        `_{${convertSlot(child(node, 'sub'))}}` +
        `^{${convertSlot(child(node, 'sup'))}}`
      );
    case 'spre':
      return (
        `{}_{${convertSlot(child(node, 'sub'))}}` +
        `^{${convertSlot(child(node, 'sup'))}}` +
        `${group(convertSlot(child(node, 'e')))}`
      );

    case 'bar': {
      const props = child(node, 'barpr');
      const pos = props ? attr(child(props, 'pos'), 'val') : null;
      const cmd = pos === 'top' ? '\\overline' : '\\underline';
      return `${cmd}{${convertSlot(child(node, 'e'))}}`;
    }

    case 'limlow':
      return `${convertSlot(child(node, 'e'))}\\limits_{${convertSlot(child(node, 'lim'))}}`;
    case 'limupp':
      return `${convertSlot(child(node, 'e'))}\\limits^{${convertSlot(child(node, 'lim'))}}`;

    case 'groupchr':
      return convertSlot(child(node, 'e'));
    case 'borderbox':
      return `\\boxed{${convertSlot(child(node, 'e'))}}`;
    case 'box':
      return convertSlot(child(node, 'e'));
    case 'eqarr':
      return `\\begin{aligned} ${childrenNamed(node, 'e').map(convertSlot).join(' \\\\ ')} \\end{aligned}`;

    // Formatting-only nodes carry no mathematical content.
    case 'ctrlpr':
    case 'rpr':
    case 'fpr':
    case 'radpr':
    case 'narypr':
    case 'dpr':
    case 'funcpr':
    case 'ssuppr':
    case 'ssubpr':
    case 'ssubsuppr':
    case 'mpr':
    case 'accpr':
    case 'barpr':
    case 'sty':
      return '';

    default:
      // Unknown wrapper: descend rather than drop content on the floor.
      return convertChildren(node);
  }
}

/** Tidy spacing without changing meaning. */
function tidy(latex) {
  return latex
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([_^])/g, '$1')
    .replace(/([_^])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\\left\s+/g, '\\left')
    .replace(/\\right\s+/g, '\\right')
    .trim();
}

/**
 * Convert one <m:oMath> element to LaTeX.
 * @param {Element} node
 * @returns {string}
 */
export function ommlToLatex(node) {
  if (!node) return '';
  return tidy(convertNode(node));
}

/**
 * Convert every <m:oMath> found under `root`.
 * @returns {string[]}
 */
export function ommlAllToLatex(root) {
  if (!root || !root.getElementsByTagName) return [];
  const found = [];
  const seen = new Set();
  for (const tag of ['m:oMath', 'oMath']) {
    for (const el of Array.from(root.getElementsByTagName(tag))) {
      if (!seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    }
  }
  return found.map(ommlToLatex);
}

export default ommlToLatex;
