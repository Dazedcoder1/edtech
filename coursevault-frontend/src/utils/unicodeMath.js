/**
 * Word UnicodeMath (linear format) -> LaTeX.
 *
 * Word stores an equation one of two ways depending on its display mode:
 *
 *   Professional -> structured OMML   (handled by ommlToLatex.js — exact)
 *   Linear       -> UnicodeMath text  (handled here — also exact)
 *
 * UnicodeMath is a real, documented notation, not mangled output. It uses a
 * few private characters that leak through as literal text if you don't know
 * to look for them:
 *
 *   ▒  U+2592  separates an n-ary operator's limits from its operand
 *   〖〗 U+3016/7 "invisible" brackets — pure grouping, no visual delimiter
 *   ■  U+25A0  introduces an array/matrix
 *   @         row separator inside an array
 *   &         column separator inside an array
 *   ⒜         a literal ( that should not be treated as grouping
 *
 * Feeding that to a generic LaTeX heuristic produces exactly the breakage this
 * was written to fix:
 *
 *   ∫_(-π/2)^(π/2)▒〖sin^7 x dx〗
 *     -> \int_\left( - \pi /2 \right)^\left( \pi /2 \right)▒〖\sin ^{7} x dx〗
 *
 * Two independent faults there: the ▒/〖〗 characters survive into the output,
 * and `_\left(` is invalid LaTeX because a sub/superscript argument longer
 * than one token must be braced.
 */

const NARY_OPS = {
  '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '∯': '\\oiint',
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
  '⋃': '\\bigcup', '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge',
};

const OPENERS = { '(': ')', '[': ']', '{': '}', '〖': '〗', '⟨': '⟩' };

/** True when the string carries UnicodeMath-specific markup. */
export function isUnicodeMath(text) {
  return typeof text === 'string' && /[▒〖〗■]/.test(text);
}

/**
 * Index of the bracket closing the one at `start`, honouring nesting.
 * Returns -1 when unbalanced.
 */
function matchBracket(s, start) {
  const open = s[start];
  const close = OPENERS[open];
  if (!close) return -1;

  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Read the argument that follows a `^` or `_` at index `i`.
 * @returns {{text: string, next: number}}
 */
function readScriptArgument(s, i) {
  if (i >= s.length) return { text: '', next: i };

  const ch = s[i];

  if (OPENERS[ch]) {
    const end = matchBracket(s, i);
    if (end > 0) {
      const inner = s.slice(i + 1, end);
      // 〖〗 are pure grouping; ( ) are meaningful only as grouping here too,
      // because Word emits them for multi-token scripts.
      return { text: inner, next: end + 1 };
    }
  }

  // A backslash command counts as one token: ^\pi
  const cmd = s.slice(i).match(/^\\[a-zA-Z]+/);
  if (cmd) return { text: cmd[0], next: i + cmd[0].length };

  // Otherwise a single character (digit, letter, sign followed by digits).
  const signed = s.slice(i).match(/^[+-]?\d+(?:\.\d+)?/);
  if (signed) return { text: signed[0], next: i + signed[0].length };

  return { text: ch, next: i + 1 };
}

/** ■(a&b@c&d) -> \begin{matrix} a & b \\ c & d \end{matrix} */
function convertArray(body) {
  const rows = body.split('@').map((row) =>
    row
      .split('&')
      .map((cell) => convert(cell).trim())
      .join(' & ')
  );
  return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
}

/**
 * Core scanner. Walks the string once, resolving structure as it goes rather
 * than applying regexes to already-transformed text (which is how the old
 * heuristic corrupted its own output).
 */
function convert(input) {
  const s = String(input);
  let out = '';
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // --- n-ary operator, optionally with limits and a ▒ operand -------------
    if (NARY_OPS[ch]) {
      out += NARY_OPS[ch];
      i += 1;

      // Limits may appear in either order: ∫_a^b or ∫^b_a
      for (let pass = 0; pass < 2; pass++) {
        if (s[i] === '_' || s[i] === '^') {
          const marker = s[i];
          const arg = readScriptArgument(s, i + 1);
          out += `${marker}{${convert(arg.text)}}`;
          i = arg.next;
        }
      }

      // ▒ marks where the operand begins; it is not itself rendered.
      if (s[i] === '▒') {
        i += 1;
        out += ' ';
      }
      continue;
    }

    // --- invisible grouping brackets ---------------------------------------
    if (ch === '〖') {
      const end = matchBracket(s, i);
      if (end > 0) {
        out += `{${convert(s.slice(i + 1, end))}}`;
        i = end + 1;
        continue;
      }
      i += 1; // unbalanced — drop the marker rather than emit it
      continue;
    }
    if (ch === '〗') {
      i += 1;
      continue;
    }

    // --- arrays -------------------------------------------------------------
    if (ch === '■') {
      if (s[i + 1] === '(') {
        const end = matchBracket(s, i + 1);
        if (end > 0) {
          out += convertArray(s.slice(i + 2, end));
          i = end + 1;
          continue;
        }
      }
      i += 1;
      continue;
    }

    // --- scripts: always brace the argument ---------------------------------
    if (ch === '^' || ch === '_') {
      const arg = readScriptArgument(s, i + 1);
      out += `${ch}{${convert(arg.text)}}`;
      i = arg.next;
      continue;
    }

    // --- a stray ▒ outside an n-ary is just a separator ----------------------
    if (ch === '▒') {
      out += ' ';
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Convert a UnicodeMath string to LaTeX.
 *
 * Structural markup only — Greek letters, operators and function names are
 * left for convertToLatex(), which already owns those tables.
 */
export function unicodeMathToLatex(text) {
  if (!text) return text;
  return convert(text)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export default unicodeMathToLatex;
