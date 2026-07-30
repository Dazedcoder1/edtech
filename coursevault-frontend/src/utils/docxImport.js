/**
 * .docx -> quiz questions, entirely in the browser.
 *
 * A .docx is a ZIP containing word/document.xml. We read that member with the
 * platform's own DecompressionStream, parse it with DOMParser, and hand any
 * <m:oMath> to the OMML converter. No JSZip, no mammoth, no upload — which
 * also means the file never leaves the educator's machine.
 *
 * Why not do this on the server? The equations are already structured data;
 * shipping a 2 MB file to Node to produce a few KB of LaTeX adds a dependency,
 * an endpoint, and a round-trip for no gain.
 */

import { ommlToLatex } from './ommlToLatex';

// ---------------------------------------------------------------------------
// Minimal ZIP reader (stored + deflate, which is all Word emits)
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

function findEndOfCentralDirectory(view) {
  // The EOCD sits at the end, after a comment of up to 64 KB.
  const maxScan = Math.min(view.byteLength, 0x10000 + 22);
  for (let i = 22; i <= maxScan; i++) {
    const off = view.byteLength - i;
    if (view.getUint32(off, true) === EOCD_SIG) return off;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Extract a single named member from a ZIP archive.
 * @param {ArrayBuffer} buffer
 * @param {string} wanted e.g. "word/document.xml"
 * @returns {Promise<string|null>} UTF-8 text, or null if absent
 */
export async function readZipEntry(buffer, wanted) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('Not a valid .docx (no ZIP end-of-directory record).');

  const entryCount = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== CEN_SIG) break;

    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name === wanted) {
      // Local header repeats the name/extra lengths; they can differ from the
      // central directory's, so re-read them rather than reusing the above.
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) return decoder.decode(raw);
      if (method === 8) return decoder.decode(await inflateRaw(raw));
      throw new Error(`Unsupported ZIP compression method ${method}.`);
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

// ---------------------------------------------------------------------------
// document.xml -> paragraphs of text with inline $latex$
// ---------------------------------------------------------------------------

function localName(node) {
  return String(node.localName || node.nodeName || '').replace(/^.*:/, '').toLowerCase();
}

/**
 * Flatten one <w:p> into a string, turning each equation into a $…$ island so
 * the existing MathText renderer can display it.
 */
function paragraphToText(p) {
  let out = '';

  const walk = (node) => {
    if (node.nodeType !== 1) return;
    const name = localName(node);

    if (name === 'omath' || name === 'omathpara') {
      const latex = ommlToLatex(node).trim();
      if (latex) out += ` $${latex}$ `;
      return; // never descend — children are the visual glyphs
    }

    if (name === 't') {
      out += node.textContent ?? '';
      return;
    }
    if (name === 'tab') {
      out += ' ';
      return;
    }
    if (name === 'br') {
      out += '\n';
      return;
    }

    for (const c of Array.from(node.childNodes)) walk(c);
  };

  walk(p);
  return out.replace(/[ \t ]+/g, ' ').trim();
}

/**
 * Map each w:numId to the number format of its level 0 ("decimal",
 * "upperLetter", "bullet", …).
 *
 * This matters more than it looks. These papers use Word's automatic list
 * numbering, so the "1." before a question and the "(A)" before an option
 * exist only in the numbering definition — neither appears in document.xml's
 * text. Reading the format is the difference between finding every question
 * and finding none.
 */
export function parseNumbering(numberingXml) {
  const formats = new Map();
  if (!numberingXml) return formats;

  let doc;
  try {
    doc = new DOMParser().parseFromString(numberingXml, 'application/xml');
  } catch {
    return formats;
  }

  const abstract = new Map();
  for (const a of Array.from(doc.getElementsByTagName('w:abstractNum'))) {
    const id = a.getAttribute('w:abstractNumId');
    const level0 = Array.from(a.getElementsByTagName('w:lvl')).find(
      (l) => l.getAttribute('w:ilvl') === '0'
    );
    const fmt = level0?.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val');
    if (id && fmt) abstract.set(id, fmt);
  }

  for (const n of Array.from(doc.getElementsByTagName('w:num'))) {
    const id = n.getAttribute('w:numId');
    const absId = n.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val');
    if (id && absId && abstract.has(absId)) formats.set(id, abstract.get(absId));
  }

  return formats;
}

/**
 * Collect the character formatting of a paragraph's visible runs.
 *
 * Educators mark the correct answer visually rather than writing "Ans: C", so
 * this is the answer key. Only runs with actual text count — Word leaves
 * plenty of empty runs carrying stale formatting.
 */
function paragraphMarks(p) {
  const colors = new Set();
  let highlight = null;
  let shading = null;
  let bold = false;
  let underline = false;

  // Both run flavours matter. An option that is pure maths has no <w:r> at
  // all — its text is in <m:t> inside <m:r>, and the highlight that marks it
  // as the correct answer sits on that run's <w:rPr>. Looking only at <w:r>
  // finds the answer key for prose options and misses it for every formula.
  const runs = [];
  const collectRuns = (node) => {
    if (!node || node.nodeType !== 1) return;
    const name = localName(node);
    if (name === 'r') runs.push(node);
    for (const child of Array.from(node.childNodes)) collectRuns(child);
  };
  collectRuns(p);

  for (const run of runs) {
    const text = Array.from(run.childNodes)
      .filter((n) => n.nodeType === 1 && localName(n) === 't')
      .map((t) => t.textContent || '')
      .join('');
    if (!text.trim()) continue;

    const props = Array.from(run.childNodes).find(
      (n) => n.nodeType === 1 && localName(n) === 'rpr' && (n.nodeName || '').startsWith('w:')
    );
    if (!props) continue;

    const hl = props.getElementsByTagName('w:highlight')[0]?.getAttribute('w:val');
    if (hl && hl !== 'none') highlight = hl;

    const shd = props.getElementsByTagName('w:shd')[0]?.getAttribute('w:fill');
    if (shd && shd !== 'auto' && shd !== 'FFFFFF') shading = shd;

    const color = props.getElementsByTagName('w:color')[0]?.getAttribute('w:val');
    if (color && color !== 'auto' && color !== '000000') colors.add(color.toUpperCase());

    if (props.getElementsByTagName('w:b')[0]) bold = true;
    if (props.getElementsByTagName('w:u')[0]) underline = true;
  }

  return { highlight, shading, colors: [...colors], bold, underline };
}

/**
 * @returns {{paragraphs: Array<{text: string, listFormat: string|null, marks: object}>, mathCount: number}}
 */
export function parseDocumentXml(xml, numberingFormats = new Map()) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) throw new Error('Could not parse document.xml — the file may be corrupt.');

  const paragraphs = [];
  for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
    const text = paragraphToText(p);
    if (!text) continue;

    const numPr = p.getElementsByTagName('w:numPr')[0];
    const numId = numPr?.getElementsByTagName('w:numId')[0]?.getAttribute('w:val');
    const listFormat = numId ? numberingFormats.get(numId) ?? null : null;

    paragraphs.push({ text, listFormat, marks: paragraphMarks(p) });
  }

  const mathCount =
    doc.getElementsByTagName('m:oMath').length || doc.getElementsByTagName('oMath').length;

  return { paragraphs, mathCount };
}

// ---------------------------------------------------------------------------
// Paragraphs -> questions
// ---------------------------------------------------------------------------

// "1." / "1)" / "Q1." / "Q. 1" — the numbering styles these papers actually use.
const QUESTION_RE = /^(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[.)\]]\s*(.+)$/i;
// "(a)" / "a." / "A)" — one letter only, so "1. a b c" isn't mistaken for one.
const OPTION_RE = /^\(?([a-dA-D])\s*[.)\]]\s+(.+)$/;
const ANSWER_RE = /^\s*(?:Ans(?:wer)?|Sol(?:ution)?)\s*[:.)-]?\s*(.*)$/i;

/**
 * Segment flattened paragraphs into quiz questions.
 *
 * Deliberately conservative: anything it cannot confidently classify is left
 * out of `questions` and reported in `unmatched`, so the review screen can show
 * what was skipped instead of silently inventing structure.
 */
const OPTION_FORMATS = new Set(['upperLetter', 'lowerLetter', 'upperRoman', 'lowerRoman']);
const QUESTION_FORMATS = new Set(['decimal', 'decimalZero', 'ordinal']);

/**
 * Work out which option an educator marked as correct, from formatting alone.
 *
 * The rule is *relative*, never absolute. In these papers every question stem
 * is green and bold, so "bold means correct" would tag everything. What
 * actually identifies the answer is an option that looks different from its
 * own siblings — usually a yellow highlight, sometimes a unique colour.
 *
 * Signals are tried strongest-first, and each one only counts when it singles
 * out exactly one option. Ambiguity returns null so the UI can ask rather than
 * guess, because a wrong answer key is worse than no answer key.
 *
 * @returns {{index: number, reason: string} | null}
 */
export function detectCorrectOption(optionMarks) {
  if (!optionMarks || optionMarks.length < 2) return null;

  const uniqueBy = (predicate, reason) => {
    const hits = [];
    optionMarks.forEach((m, i) => {
      if (m && predicate(m)) hits.push(i);
    });
    return hits.length === 1 ? { index: hits[0], reason } : null;
  };

  // 1. Highlighter pen — the clearest possible intent.
  const highlighted = uniqueBy((m) => !!m.highlight, 'highlighted');
  if (highlighted) return highlighted;

  // 2. Cell/character shading.
  const shaded = uniqueBy((m) => !!m.shading, 'shaded');
  if (shaded) return shaded;

  // 3. A colour that only one option uses.
  const counts = new Map();
  for (const m of optionMarks) {
    for (const c of m?.colors || []) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const soloColors = [...counts.entries()].filter(([, n]) => n === 1).map(([c]) => c);
  if (soloColors.length === 1) {
    const colored = uniqueBy((m) => (m.colors || []).includes(soloColors[0]), 'colour');
    if (colored) return colored;
  }

  // Bold and underline are deliberately NOT used.
  //
  // They looked tempting but produce false answer keys. In the determinants
  // paper, bold on a trailing "[2022 Series-C]" reference singled out option A
  // for det(A⁻¹) — where the correct answer is B, 1/det(A). Bold is applied
  // for emphasis, headings and citations far more often than for answers, and
  // a confidently wrong answer key is worse than none: the educator would have
  // no reason to look at it again.
  return null;
}

export function segmentQuestions(paragraphs) {
  const questions = [];
  const unmatched = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    current.question_text = current.question_text.trim();

    // Answer key from formatting, decided per question against its own options.
    const detected = detectCorrectOption(current._optionMarks);
    if (detected) {
      current.correct_option_index = detected.index;
      current.answer_source = detected.reason;
    }
    delete current._optionMarks;

    if (current.question_text) questions.push(current);
    current = null;
  };

  const startQuestion = (text) => {
    flush();
    current = {
      number: questions.length + 1,
      question_text: text.trim(),
      options: [],
      correct_option_index: 0,
      answer_source: null,
      image_url: '',
      _optionMarks: [],
    };
  };

  for (const para of paragraphs) {
    // Accept both shapes so the function stays testable with plain strings.
    const text = typeof para === 'string' ? para : para.text;
    const fmt = typeof para === 'string' ? null : para.listFormat;
    const marks = typeof para === 'string' ? null : para.marks;
    if (!text) continue;

    // "Answer: C" — record it and point correct_option_index at that option.
    const answer = text.match(ANSWER_RE);
    if (answer && current) {
      const marked = answer[1].trim().match(/^\(?([a-dA-D])\)?/);
      if (marked) {
        const idx = marked[1].toLowerCase().charCodeAt(0) - 97;
        if (idx >= 0 && idx < current.options.length) current.correct_option_index = idx;
      }
      current.answer_note = answer[1].trim();
      continue;
    }

    // --- Primary signal: Word's own list numbering --------------------------
    if (fmt && OPTION_FORMATS.has(fmt)) {
      if (current && current.options.length < 8) {
        current.options.push(text.trim());
        current._optionMarks.push(marks);
      } else {
        unmatched.push(text);
      }
      continue;
    }

    if (fmt && QUESTION_FORMATS.has(fmt)) {
      startQuestion(text);
      continue;
    }

    // --- Fallback: numbering typed by hand ---------------------------------
    const option = text.match(OPTION_RE);
    if (option && current && current.options.length < 8) {
      current.options.push(option[2].trim());
      current._optionMarks.push(marks);
      continue;
    }

    const question = text.match(QUESTION_RE);
    if (question) {
      startQuestion(question[2]);
      current.number = Number(question[1]);
      continue;
    }

    // Unnumbered paragraph directly under a question with no options yet:
    // treat as a continuation of the stem rather than dropping it.
    if (current && current.options.length === 0 && fmt === null) {
      current.question_text += ` ${text}`;
    } else {
      unmatched.push(text);
    }
  }
  flush();

  return { questions, unmatched };
}

/**
 * Full pipeline: File -> reviewable questions.
 * @param {File|Blob} file
 */
export async function importDocx(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unzip .docx files. Please use a recent Chrome, Edge, Firefox or Safari.');
  }

  const buffer = await file.arrayBuffer();
  const xml = await readZipEntry(buffer, 'word/document.xml');
  if (!xml) throw new Error('No word/document.xml inside the file — is it really a .docx?');

  const numberingXml = await readZipEntry(buffer, 'word/numbering.xml');
  const numberingFormats = parseNumbering(numberingXml);

  const { paragraphs, mathCount } = parseDocumentXml(xml, numberingFormats);
  const { questions, unmatched } = segmentQuestions(paragraphs);

  return {
    questions,
    unmatched,
    stats: {
      paragraphs: paragraphs.length,
      equations: mathCount,
      questions: questions.length,
      skipped: unmatched.length,
      answersDetected: questions.filter((q) => q.answer_source).length,
    },
  };
}
