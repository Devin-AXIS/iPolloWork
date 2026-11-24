// Seeded property test for Thai, Lao, Khmer, and Myanmar line breaking (#1384).
//
// Random Thai and mixed-script paragraphs with spaces, zero-width spaces, no-break spaces,
// dashes, hidden runs, tracked insertions, and random formatting, split into random runs and
// laid out at random widths. The oracle is written out here, independent of the engine:
// unspaced text of these scripts wraps at any cluster that fits, never at a dictionary word;
// a line may end after a space run, a zero-width space, a dash between letters, or a tab. An
// emergency cut never splits a grapheme cluster, never falls between a Khmer coeng or Myanmar
// virama and the letter it stacks, and never precedes a combining mark (a Myanmar spacing
// vowel or visarga) or a zero-width space. Every case checks:
//
// 1. Lines concatenate back to the visible text.
// 2. No line starts with a space or a zero-width space.
// 3. Every break is a legal break, or an emergency cut at an allowed stop inside a word wider
//    than the line.
// 4. Every line fits the measure, unless it is a piece of a word wider than the measure.
// 5. No line breaks early: after a legal break the next word does not fit, and after an
//    emergency cut the next cluster does not fit.
// 6. Runs split between clusters, with any formatting or hidden text, break where one plain
//    run breaks.
// 7. The AutoFit minimum equals the widest word: an unspaced run is one segment.
// 8. Right alignment puts the content of every line at the measure. A space before a
//    zero-width space is content while it fits, and hangs when it overflows.
//
// A second generator adds fields, inline pictures, tabs, and positional tabs, and checks
// properties 1 to 3 through full document layout. A third edits Thai paragraphs at random and
// compares incremental layout with a clean pass after every step.
//
// Determinism: fixed seeds and an inline mulberry32 PRNG. A failure names the seed and case.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { segmentGraphemes } from '../grapheme.ts';
import { createLayoutSession, layoutSemanticDocument, type LayoutSession } from '../index.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { paragraphMinimumWidthPt } from '../table-autofit-widths.ts';
import { layoutContext, load as loadDocument } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per UTF-16 unit at 11pt. A zero-width space takes no width, as in a shaped font. */
const UNIT = 6;
const fixed = createFixedMeasurer(UNIT, 14);
const measurer: TextMeasurer = {
  ...fixed,
  measure: (text, style) => fixed.measure(text.replace(/​/gu, ''), style),
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Independent oracle ─────────────────────────────────────────────────────────

const DASHES = '-‐–—';
const STACKING = /[្္]/u;
const MARK = /\p{M}/u;

/** Legal breaks, never before a space: after a space run, a zero-width space, a dash, a tab. */
function oracleLegalBreaks(text: string): Set<number> {
  const legal = new Set<number>();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    // Never before a space or a zero-width space (UAX #14 LB7).
    if (ch === ' ' && next !== undefined && next !== ' ' && next !== '​') legal.add(i + 1);
    // ZW SP* ÷: after a zero-width space, past the spaces that follow it.
    if (ch === '​' && next !== undefined && next !== ' ' && next !== '​') legal.add(i + 1);
    if (ch === '\t') {
      if (i > 0) legal.add(i);
      if (next !== undefined) legal.add(i + 1);
    }
    if (
      DASHES.includes(ch) &&
      i > 0 &&
      text[i - 1] !== ' ' &&
      next !== undefined &&
      next !== ' ' &&
      next !== '​' &&
      !DASHES.includes(next)
    )
      legal.add(i + 1);
  }
  return legal;
}

/**
 * Where an emergency cut may fall: a grapheme cluster start that does not follow a stacking
 * sign and does not precede a space, a zero-width space, or a combining mark that continues
 * the text before it. After a space, a zero-width space, or a tab, a mark starts a word.
 */
function oracleCutStops(text: string): Set<number> {
  const stops = new Set<number>();
  for (const cluster of segmentGraphemes(text)) {
    const at = cluster.utf16From;
    if (at === 0) continue;
    const next = text[at]!;
    const startsWord = /[ \u200b\t]/u.test(text[at - 1]!);
    // Only a letter stacks under a coeng or virama; Zawgyi uses U+1039 as a final asat.
    if (
      (STACKING.test(text[at - 1]!) && /\p{L}/u.test(next)) ||
      (MARK.test(next) && !startsWord) ||
      next === ' ' ||
      next === '\u200b'
    )
      continue;
    stops.add(at);
  }
  return stops;
}

/** Width of text: a zero-width space takes none. */
const widthPt = (text: string): number => text.replace(/​/gu, '').length * UNIT;
/** Ink width of a word: trailing spaces (and zero-width spaces) may hang. */
const inkPt = (text: string): number => widthPt(text.replace(/[ ​]+$/u, ''));

/** The words between legal breaks, as [start, end) ranges. */
function wordsOf(text: string, legal: ReadonlySet<number>): [number, number][] {
  const cuts = Array.from(legal)
    .filter((at) => at > 0 && at < text.length)
    .sort((a, b) => a - b);
  cuts.push(text.length);
  const words: [number, number][] = [];
  let from = 0;
  for (const to of cuts) {
    words.push([from, to]);
    from = to;
  }
  return words;
}

// ── Generators ────────────────────────────────────────────────────────────────

const THAI_WORDS = [
  'ฉัน',
  'อยาก',
  'กิน',
  'ข้าว',
  'วันนี้',
  'แม่น้ำ',
  'เจ้าพระยา',
  'โรงเรียน',
  'ภาษาไทย',
  'คอมพิวเตอร์',
  'สวัสดี',
  'ขอบคุณ',
  'ประเทศ',
  'น้ำ',
  'ที่',
  'และ',
  'ๆ',
  'กรุงเทพมหานคร',
];
const OTHER_WORDS = ['ພາສາລາວ', 'ភាសាខ្មែរ', 'မြန်မာ', 'ABC', 'word', '123', '๒๕๖๕', '2026'];
const SEPARATORS = [' ', ' ', '-', '  ', '​', '​', ' ', ' ​', '​ '];

type Rand = () => number;
const pick = <T>(rand: Rand, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

/** Words of whole Lao, Khmer, Myanmar, and Thai sentences, with their marks and signs. */
const SCRIPT_WORDS: readonly (readonly string[])[] = [
  ['ພາສາ', 'ລາວ', 'ເປັນ', 'ທີ່', 'ສວຍງາມ', 'ຫຼາຍ', 'ປະເທດ', 'ຂອງ', 'ຊ້າໆ', 'ຫຼວງພະບາງຯ'],
  ['ភាសា', 'ខ្មែរ', 'ជា', 'ផ្លូវការ', 'នៃ', 'ប្រទេស', 'កម្ពុជា', 'ស្រុក', 'ផ្សេងៗ', '។', '៕”'],
  [
    'မြန်မာ',
    'ဘာသာ',
    'စကား',
    'သည်',
    'ရုံးသုံး',
    'ကျောင်း',
    'သွား',
    'လေး',
    'တော်',
    'ကမ္ဘာ',
    // Zawgyi-encoded words open with the vowel sign U+1031.
    'ေမာင္',
    'ေက်ာင္း',
    '။',
    '၊',
  ],
  ['ภาษา', 'ไทย', 'กิน', 'ข้าว', '๚', '๚”', '๛', 'ต่างๆ', 'กรุงเทพฯ'],
];

function randomText(rand: Rand): string {
  const count = 2 + Math.floor(rand() * 14);
  // A quarter of the paragraphs are whole sentences of one script.
  const script = rand() < 0.25 ? pick(rand, SCRIPT_WORDS) : null;
  let text = '';
  for (let i = 0; i < count; i++) {
    if (i > 0 && rand() < 0.15) text += pick(rand, SEPARATORS);
    text += script
      ? pick(rand, script)
      : rand() < 0.8
        ? pick(rand, THAI_WORDS)
        : pick(rand, OTHER_WORDS);
  }
  return text.trim() || 'ฉัน';
}

/**
 * Seams anywhere, including inside a grapheme cluster, or only where an emergency cut could
 * fall (between clusters, not inside a stack, not before a spacing vowel).
 */
function randomSplit(text: string, rand: Rand, clusterAligned = false): string[] {
  const starts = Array.from(oracleCutStops(text));
  const seams = new Set<number>();
  const count = Math.floor(rand() * 5);
  for (let i = 0; i < count; i++) {
    if (clusterAligned && starts.length === 0) break;
    seams.add(
      clusterAligned ? pick(rand, starts) : 1 + Math.floor(rand() * Math.max(1, text.length - 1))
    );
  }
  const sorted = Array.from(seams)
    .filter((at) => at > 0 && at < text.length)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  let from = 0;
  for (const at of sorted) {
    parts.push(text.slice(from, at));
    from = at;
  }
  parts.push(text.slice(from));
  return parts;
}

const FORMATS = ['', '<w:b/>', '<w:i/>', '<w:color w:val="C00000"/>', '<w:u w:val="single"/>'];
const runXml = (text: string, props = '') =>
  `<w:r><w:rPr>${props}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** Visible runs with random formatting, tracked insertions, and hidden runs between them. */
function runsXml(parts: readonly string[], rand: Rand): string {
  return parts
    .map((part, index) => {
      const hidden =
        rand() < 0.15 ? runXml(rand() < 0.5 ? pick(rand, THAI_WORDS) : ' x ', '<w:vanish/>') : '';
      const visible = runXml(part, pick(rand, FORMATS));
      const wrapped =
        rand() < 0.2
          ? `<w:ins w:id="${index + 1}" w:author="A" w:date="2026-01-01T00:00:00Z">${visible}</w:ins>`
          : visible;
      return hidden + wrapped;
    })
    .join('');
}

function paragraph(body: string): OoxmlNode {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const lineTexts = (xml: string, width: number): string[] =>
  breakParagraph(paragraph(`<w:p>${xml}</w:p>`), 'p', 0, width, measurer, undefined, null).map(
    (line) => line.spans.map((span) => span.text).join('')
  );

function breakOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines.slice(0, -1)) {
    at += line.length;
    offsets.push(at);
  }
  return offsets;
}

const minimumOf = (xml: string): number =>
  paragraphMinimumWidthPt(paragraph(`<w:p>${xml}</w:p>`) as OoxmlElement, {
    context: { measurer },
    view: {
      styleCascade: undefined,
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });

/** The legal-or-cut check shared by both generators; returns the emergency cuts taken. */
function checkBreaks(
  where: string,
  text: string,
  offsets: readonly number[],
  legal: Set<number>,
  width: number,
  cutExempt: (offset: number) => boolean = () => false
): number {
  const stops = oracleCutStops(text);
  // A line can hold only an atom (a picture or a positional tab), so it paints no text.
  stops.add(text.length);
  legal.add(0);
  legal.add(text.length);
  const words = wordsOf(text, legal);
  let cuts = 0;
  for (const offset of offsets) {
    if (legal.has(offset) || cutExempt(offset)) continue;
    cuts += 1;
    expect(stops.has(offset), `${where}: cut ${offset} splits a cluster, stack, or vowel`).toBe(
      true
    );
    const word = words.find(([start, end]) => start < offset && offset < end);
    expect(word, `${where}: break ${offset} outside the text`).toBeDefined();
    const [from, to] = word!;
    expect(
      inkPt(text.slice(from, to)),
      `${where}: cut at ${offset} in a word that fits`
    ).toBeGreaterThan(width);
  }
  return cuts;
}

// ── Text paragraphs ───────────────────────────────────────────────────────────

/** Each right-aligned line as [content end, content width, text], through full layout. */
function rightAlignedLines(xml: string, width: number): [number, number, string][] {
  const part = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${xml}</w:p>` +
      `<w:sectPr><w:pgSz w:w="${Math.round((width + 20) * 20)}" w:h="40000"/>` +
      '<w:pgMar w:left="200" w:right="200" w:top="200" w:bottom="200"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!part.ok) throw new Error(part.reason);
  const out: [number, number, string][] = [];
  for (const page of layoutSemanticDocument(part.part, 1, { measurer }).pages)
    for (const fragment of page.fragments)
      if (fragment.kind === 'paragraph')
        for (const line of fragment.lines) {
          if (line.spans.length === 0) continue;
          const text = line.spans.map((span) => span.text).join('');
          // Plain trailing spaces hang. A space before a zero-width space is content while
          // it fits, and hangs with it when it overflows.
          let content = text.replace(/ +$/u, '');
          if (widthPt(content) > width + 0.01) content = content.replace(/[ ​]+$/u, '');
          const x = line.spans[0]!.box.x - fragment.box.x;
          out.push([x + widthPt(content), widthPt(content), text]);
        }
  return out;
}

const SEEDS = Array.from({ length: 50 }, (_, index) => 0x1384 + index * 7919);
const CASES = 80;

describe('complex-script line breaks hold their invariants on random text', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: ${CASES} random paragraphs`, () => {
      const rand = mulberry32(seed);
      let cutsTaken = 0;
      for (let index = 0; index < CASES; index++) {
        const text = randomText(rand);
        const width = UNIT * (3 + Math.floor(rand() * 18)) + (rand() < 0.3 ? 2.5 : 0);
        const where = `seed ${seed}, case ${index}, width ${width}, text ${JSON.stringify(text)}`;
        const legal = oracleLegalBreaks(text);

        // Any seams, including inside clusters: properties 1 to 3.
        const anyRuns = runsXml(randomSplit(text, rand), rand);
        const anyLines = lineTexts(anyRuns, width);
        expect(anyLines.join(''), `${where}: ${anyRuns}`).toBe(text);
        // A seam inside a cluster can push the cluster's tail past the measure, and a second
        // space after that overflowing line then opens the next one: an older limit of
        // overflowing lines, outside this property.
        const insideSpaces = (offset: number) => text[offset - 1] === ' ' && text[offset] === ' ';
        checkBreaks(
          `${where} (any seams) ${anyRuns}`,
          text,
          breakOffsets(anyLines),
          legal,
          width,
          insideSpaces
        );

        // One plain run: properties 4 and 5.
        const plain = lineTexts(runXml(text), width);
        const offsets = breakOffsets(plain);
        for (const line of plain) expect(line, `${where}: line start`).not.toMatch(/^[\u200b ]/u);
        breakOffsets(anyLines).forEach((offset) => {
          if (!insideSpaces(offset))
            expect(text[offset], `${where}: line start at ${offset}`).not.toMatch(/^[\u200b ]/u);
        });
        cutsTaken += checkBreaks(where, text, offsets, legal, width);
        const words = wordsOf(text, legal);
        const stops = [...oracleCutStops(text), ...legal].sort((a, b) => a - b);
        let at = 0;
        plain.forEach((line, lineIndex) => {
          const lineStart = at;
          at += line.length;
          // A piece of an oversized word may be wider than the line by its last cluster.
          const oversized = words.some(
            ([from, to]) => from <= lineStart && at <= to && inkPt(text.slice(from, to)) > width
          );
          if (!oversized)
            expect(inkPt(line), `${where}: line ${lineIndex} overflows`).toBeLessThanOrEqual(
              width + 0.01
            );
          if (lineIndex === plain.length - 1) return;
          if (legal.has(at)) {
            const next = words.find(([from]) => from === at)!;
            expect(
              widthPt(line) + inkPt(text.slice(next[0], next[1])),
              `${where}: line ${lineIndex} ends early`
            ).toBeGreaterThan(width + 0.01);
          } else {
            // After an emergency cut the next cluster would not fit: lines fill.
            const nextStop = stops.find((stop) => stop > at) ?? text.length;
            expect(
              widthPt(line) + inkPt(text.slice(at, nextStop)),
              `${where}: line ${lineIndex} is cut early`
            ).toBeGreaterThan(width + 0.01);
          }
        });

        // Seams between clusters, with formatting and hidden runs: property 6.
        const alignedRuns = runsXml(randomSplit(text, rand, true), rand);
        expect(breakOffsets(lineTexts(alignedRuns, width)), `${where}: ${alignedRuns}`).toEqual(
          offsets
        );

        // Property 8. Two trailing spaces keep one space of room, a separate, older behavior.
        if (index % 2 === 0)
          for (const [end, content, line] of rightAlignedLines(alignedRuns, width))
            if (content <= width + 0.01 && !/ {2}$/u.test(line.replace(/​/gu, '')))
              expect(
                Math.abs(end - width),
                `${where}: right-aligned ${JSON.stringify(line)} ends at ${end}`
              ).toBeLessThan(0.01);

        // East Asian path: a run with an East Asian language takes the paragraph table, which
        // must keep the same legal breaks and cut stops (Zawgyi asat and vowel included).
        if (index % 4 === 1) {
          const eastAsian = lineTexts(runXml(text, '<w:lang w:eastAsia="zh-CN"/>'), width);
          expect(eastAsian.join(''), `${where} (East Asian)`).toBe(text);
          // The East Asian table also opens a line before a space, which then starts the line.
          checkBreaks(
            `${where} (East Asian)`,
            text,
            breakOffsets(eastAsian),
            legal,
            width,
            (offset) => text[offset] === ' '
          );
        }

        // Property 7.
        const widest = Math.max(...words.map(([from, to]) => inkPt(text.slice(from, to))));
        expect(minimumOf(anyRuns), `${where}: AutoFit minimum`).toBeCloseTo(widest, 5);
      }
      // Anti-vacuity: the generator must reach emergency cuts inside unspaced text.
      expect(cutsTaken).toBeGreaterThan(CASES / 4);
    });
  }
});

// ── Paragraphs with fields, pictures, and tabs ───────────────────────────────

const NS =
  `xmlns:w="${W}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
/** A 12pt square inline picture. */
const PICTURE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="152400" cy="152400"/><wp:docPr id="1" name="pic"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/>' +
  '</a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="152400" cy="152400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline>' +
  '</w:drawing></w:r>';
const complexField = (instruction: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${runXml(result)}` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

interface AtomParagraph {
  readonly xml: string;
  /** The text the lines paint, pictures excluded. */
  readonly text: string;
  /** Paint offsets where an atom starts or ends; breaks there are legal. */
  readonly atomEdges: ReadonlySet<number>;
  /** Text offsets of field results. */
  readonly fieldRanges: readonly [number, number][];
}

function randomAtomParagraph(rand: Rand): AtomParagraph {
  let xml = '';
  let text = '';
  const atomEdges = new Set<number>();
  const fieldRanges: [number, number][] = [];
  const count = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) {
    const kind = pick(rand, ['text', 'text', 'ref', 'page', 'picture', 'tab', 'ptab'] as const);
    if (kind === 'text') {
      const part = randomText(rand);
      for (const piece of randomSplit(part, rand, true)) xml += runXml(piece, pick(rand, FORMATS));
      text += part;
    } else if (kind === 'ref') {
      // One space between words: inside a field result a second space can open a line, in
      // any script (a separate, older limit of layout-owned text).
      const result = (rand() < 0.7 ? randomText(rand) : 'alpha beta').replace(/ {2,}/gu, ' ');
      xml += complexField('REF heading', result);
      fieldRanges.push([text.length, text.length + result.length]);
      text += result;
    } else if (kind === 'page') {
      // The saved `7` never paints: a body PAGE shows the page it lands on, here the first.
      xml += `<w:fldSimple w:instr="PAGE">${runXml('7')}</w:fldSimple>`;
      fieldRanges.push([text.length, text.length + 1]);
      text += '1';
    } else if (kind === 'picture') {
      xml += PICTURE;
      atomEdges.add(text.length);
    } else if (kind === 'tab') {
      xml += '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:tab/></w:r>';
      text += '\t';
    } else {
      xml +=
        '<w:r><w:rPr><w:sz w:val="22"/></w:rPr>' +
        '<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="none"/></w:r>';
      text += '\t';
    }
  }
  return { xml, text, atomEdges, fieldRanges };
}

function documentLines(xml: string, width: number): string[] {
  const part = loadDocument(
    `<w:document ${NS}><w:body><w:p>${xml}</w:p><w:sectPr>` +
      `<w:pgSz w:w="${Math.round((width + 20) * 20)}" w:h="40000"/>` +
      '<w:pgMar w:left="200" w:right="200" w:top="200" w:bottom="200"/></w:sectPr></w:body></w:document>'
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
  const lines: string[] = [];
  for (const page of layout.pages)
    for (const fragment of page.fragments)
      if (fragment.kind === 'paragraph')
        for (const line of fragment.lines) lines.push(line.spans.map((span) => span.text).join(''));
  return lines;
}

const ATOM_SEEDS = Array.from({ length: 12 }, (_, index) => 0xa70 + index * 104729);
const ATOM_CASES = 40;

describe('complex-script line breaks beside fields, pictures, and tabs', () => {
  for (const seed of ATOM_SEEDS) {
    test(`seed ${seed}: ${ATOM_CASES} random paragraphs`, () => {
      const rand = mulberry32(seed);
      for (let index = 0; index < ATOM_CASES; index++) {
        const atoms = randomAtomParagraph(rand);
        const width = UNIT * (4 + Math.floor(rand() * 16));
        const where = `seed ${seed}, case ${index}, width ${width}, xml ${atoms.xml}`;
        const lines = documentLines(atoms.xml, width);
        // A positional tab that cannot advance may paint nothing, so tabs are not compared.
        expect(lines.join('').replace(/\t/gu, ''), where).toBe(atoms.text.replace(/\t/gu, ''));
        // Break offsets in the source text. A tab no line paints is skipped where the next
        // painted character is found; a break before a tab is legal either way.
        const offsets: number[] = [];
        const tabBefore: boolean[] = [];
        let at = 0;
        for (const line of lines) {
          let sawTab = false;
          for (const ch of line) {
            while (atoms.text[at] === '\t' && ch !== '\t') {
              at += 1;
              sawTab = true;
            }
            if (ch === '\t') sawTab = true;
            at += ch.length;
          }
          offsets.push(at);
          tabBefore.push(sawTab);
        }
        offsets.pop();
        const legal = oracleLegalBreaks(atoms.text);
        for (const edge of atoms.atomEdges) legal.add(edge);
        // After a tab, a word wraps within the room the tab leaves, so it may be cut there.
        checkBreaks(
          `${JSON.stringify(lines)} ${JSON.stringify(offsets)} ${where}`,
          atoms.text,
          offsets,
          legal,
          width,
          (offset) => tabBefore[offsets.indexOf(offset)] === true
        );
        for (const line of lines) expect(line, where).not.toMatch(/^[\u200b ]/u);
      }
    });
  }
});

// ── Incremental layout oracle ─────────────────────────────────────────────────

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const PAGE =
  `<w:pgSz w:w="3000" w:h="2400"/>` +
  `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>`;

interface Para {
  parts: string[];
  bold: boolean[];
}

function renderDoc(paras: readonly Para[]): string {
  const body = paras
    .map(
      (para) =>
        `<w:p>${para.parts
          .map((part, index) => runXml(part, para.bold[index] ? '<w:b/>' : ''))
          .join('')}</w:p>`
    )
    .join('');
  return `${body}<w:sectPr>${PAGE}</w:sectPr>`;
}

function randomEdit(paras: Para[], rand: Rand): string {
  const para = pick(rand, paras);
  const text = para.parts.join('');
  const clusters = segmentGraphemes(text).map((cluster) => cluster.utf16From);
  clusters.push(text.length);
  const at = pick(rand, clusters);
  const kind = pick(rand, ['insert', 'delete', 'resplit', 'bold'] as const);
  let next = text;
  if (kind === 'insert') next = text.slice(0, at) + pick(rand, THAI_WORDS) + text.slice(at);
  if (kind === 'delete') {
    const to = pick(
      rand,
      clusters.filter((end) => end >= at)
    );
    next = text.slice(0, at) + text.slice(to) || 'ฉัน';
  }
  if (kind === 'bold') {
    const index = Math.floor(rand() * para.bold.length);
    para.bold[index] = !para.bold[index];
    return `${kind} ${index}`;
  }
  para.parts = randomSplit(next, rand);
  para.bold = para.parts.map(() => rand() < 0.3);
  return `${kind} ${at}`;
}

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession) =>
  layoutSemanticDocument(part, revision, { measurer, ...(session ? { session } : {}) });

const EDIT_SEEDS = [0x1384, 11, 2026, 77, 4242];
const STEPS = 20;

describe('incremental layout of Thai paragraphs equals a clean pass', () => {
  for (const seed of EDIT_SEEDS) {
    test(`seed ${seed}: ${STEPS} random edits`, () => {
      const rand = mulberry32(seed);
      const paras: Para[] = Array.from({ length: 8 }, () => {
        const parts = randomSplit(randomText(rand) + randomText(rand), rand);
        return { parts, bold: parts.map(() => rand() < 0.3) };
      });
      const session = createLayoutSession();
      expect(lay(load(renderDoc(paras)), 1, session).pages.length).toBeGreaterThan(1);
      const log: string[] = [];
      let partialSteps = 0;
      for (let step = 0; step < STEPS; step++) {
        log.push(randomEdit(paras, rand));
        const part = load(renderDoc(paras));
        const incremental = JSON.stringify(lay(part, step + 2, session).pages);
        if (session.stats.placed < session.stats.total) partialSteps += 1;
        const fresh = JSON.stringify(lay(part, step + 2).pages);
        if (incremental !== fresh) {
          throw new Error(`seed ${seed}, step ${step}: diverged after ${JSON.stringify(log)}`);
        }
      }
      // Anti-vacuity: some passes must place only part of the document.
      expect(partialSteps).toBeGreaterThan(0);
    });
  }
});
