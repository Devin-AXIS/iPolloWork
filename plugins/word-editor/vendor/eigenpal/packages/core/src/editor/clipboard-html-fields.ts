// Word's field structure in clipboard HTML.
//
// Word writes a field as conditional comments around its result: `<!--[if supportFields]>`
// holds a `field-begin` marker span, the instruction text and a `field-separator` marker, and a
// later comment holds the `field-end` marker. A browser keeps those comments as inert Comment
// nodes, and the result between them is ordinary HTML. Reading the markers back gives the
// pasted content its fields again: a table of contents stays a TOC field that can be updated,
// and its page numbers stay PAGEREF fields.
//
// SECURITY: the comment text is clipboard-supplied, and any web page can write it. It is scanned
// with a bounded tokenizer and never parsed as markup or executed; instruction text is escaped
// into `w:instrText`, and field instructions stay inert in the engine. Comment size, marker
// count and instruction length are capped. Only inert field types survive the paste: a field
// that runs a command or loads a file or address when a word processor updates it (`DDEAUTO`,
// `INCLUDETEXT`, `INCLUDEPICTURE`, `LINK`) keeps its result text and loses its field, and so
// does a field whose instruction starts with a nested field or a `HYPERLINK` to anything but
// a web, mail or phone address or a bookmark. Markers
// that do not nest into complete fields are all dropped, so the result text stays and no half
// field reaches the document.

import { parseHyperlinkInstruction } from '../layout/field-link.ts';
import { escapeXml, isEvaluableField, sanitizeHref } from '../store/package/sinks.ts';

/** Field types a paste keeps besides the ones the engine evaluates: none fetches or runs. */
const INERT_FIELDS = new Set([
  'HYPERLINK',
  'NOTEREF',
  'IF',
  'MERGEFIELD',
  'SECTIONPAGES',
  'SECTION',
  'NUMWORDS',
  'NUMCHARS',
  'AUTHOR',
  'TITLE',
  'SUBJECT',
  'CREATEDATE',
  'SAVEDATE',
  'PRINTDATE',
  'DOCPROPERTY',
  'SYMBOL',
  'EQ',
  'LISTNUM',
  'SET',
  'XE',
  'TC',
  'INDEX',
]);

/** Schemes a pasted `HYPERLINK` field may name. A relative or UNC target can open a file. */
const LINK_SCHEME = /^(?:https?|mailto|tel|ftp):/i;

/** A `HYPERLINK` field stays only with a web, mail or phone target, or a bookmark alone. */
function pasteKeepsHyperlink(instruction: string): boolean {
  const spec = parseHyperlinkInstruction(instruction);
  if (!spec) return false;
  if (spec.target === null) return spec.anchor !== null;
  const href = sanitizeHref(spec.target);
  return href.ok && LINK_SCHEME.test(href.href);
}

function pasteKeepsField(instruction: string): boolean {
  const keyword = instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  if (keyword === 'HYPERLINK') return pasteKeepsHyperlink(instruction);
  return isEvaluableField(instruction) || INERT_FIELDS.has(keyword);
}

/** A Word field comment longer than this is not field markup; it is ignored. */
const MAX_FIELD_COMMENT_LENGTH = 16_384;
/** Instruction text past this length is not a field instruction Word writes. */
const MAX_INSTRUCTION_LENGTH = 2_048;
/** Field markers one paste may carry. */
const MAX_FIELD_MARKERS = 30_000;

const BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const SEPARATE = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
/** A marker run (group 1 is its type) or an instruction run (group 2 is its text). */
const FIELD_RUN =
  /<w:r><w:fldChar w:fldCharType="(begin|separate|end)"\/><\/w:r>|<w:r><w:instrText xml:space="preserve">([^<]*)<\/w:instrText><\/w:r>/g;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body) => {
    const name = String(body);
    if (name.startsWith('#')) {
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      const valid =
        Number.isInteger(code) &&
        code >= 0x20 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : '';
    }
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name]! : whole;
  });
}

function instructionRun(text: string): string {
  const instruction = decodeEntities(text).replace(/[\t\r\n\f\v ]+/g, ' ');
  if (instruction.trim() === '') return '';
  return `<w:r><w:instrText xml:space="preserve">${escapeXml(instruction)}</w:instrText></w:r>`;
}

/** Markers left per paste, keyed by the paste's projection. */
const markersLeft = new WeakMap<object, number>();
/**
 * Per paste, for each open field, whether its instruction is still being read. A field's
 * instruction can continue after a nested field ends, in a later comment.
 */
const openFields = new WeakMap<object, boolean[]>();

/**
 * The field runs one Word `supportFields` comment stands for, in order. Empty for any other
 * comment, or when the comment is outside the bounds.
 */
export function wordFieldRuns(comment: string, paste: object): string[] {
  if (!comment.startsWith('[if supportFields]>') || comment.length > MAX_FIELD_COMMENT_LENGTH)
    return [];
  const body = comment.slice('[if supportFields]>'.length).replace(/<!\[endif\]\s*$/, '');
  const runs: string[] = [];
  let instruction = '';
  let open = openFields.get(paste);
  if (!open) openFields.set(paste, (open = []));
  const fields = open;
  const reading = () => fields.length > 0 && fields[fields.length - 1] === true;
  const flush = (): boolean => {
    if (instruction.length > MAX_INSTRUCTION_LENGTH) return false;
    const run = reading() ? instructionRun(instruction) : '';
    if (run) runs.push(run);
    instruction = '';
    return true;
  };
  // Tags and text alternate; neither class can match the other, so the scan is linear.
  for (const match of body.matchAll(/<([^<>]{0,1024})>|([^<]+)/g)) {
    if (match[2] !== undefined) {
      if (reading()) instruction += match[2];
      if (instruction.length > MAX_INSTRUCTION_LENGTH) return [];
      continue;
    }
    const marker = /mso-element:\s*field-(begin|separator|end)/i.exec(match[1]!)?.[1];
    if (!marker) continue;
    if (!flush()) return [];
    const left = markersLeft.get(paste) ?? MAX_FIELD_MARKERS;
    if (left <= 0) return [];
    markersLeft.set(paste, left - 1);
    const kind = marker.toLowerCase();
    runs.push(kind === 'begin' ? BEGIN : kind === 'separator' ? SEPARATE : END);
    if (kind === 'begin') fields.push(true);
    else if (kind === 'separator') fields[fields.length - 1] = false;
    else fields.pop();
  }
  if (!flush()) return [];
  return runs;
}

/** One field run in the pasted blocks, in document order. */
interface FieldRun {
  readonly kind: 'begin' | 'separate' | 'end' | 'instruction';
  readonly text: string;
}

/**
 * Which field runs of `blocks` stay, in document order. Every run goes when the markers do not
 * nest into complete fields: a selection that starts or ends inside a field carries half of
 * it, and only the result text can be kept. Otherwise the runs of a field whose type a paste
 * does not keep go, and its result text stays.
 */
function keptFieldRuns(runs: readonly FieldRun[]): readonly boolean[] {
  const keep = runs.map(() => true);
  // Each open field: whether its separator has been seen, the runs that belong to it, its
  // instruction text, and whether a nested field opened before its own keyword. Such a field's
  // type is only known once a word processor updates the nested one, so it does not stay.
  const open: {
    separated: boolean;
    own: number[];
    instruction: string;
    begin: number;
    separator: number;
    nestedFirst: boolean;
  }[] = [];
  for (const [index, run] of runs.entries()) {
    const top = open[open.length - 1];
    if (run.kind === 'begin') {
      if (top && !top.separated && top.instruction.trim() === '') top.nestedFirst = true;
      open.push({
        separated: false,
        own: [index],
        instruction: '',
        begin: index,
        separator: -1,
        nestedFirst: false,
      });
    } else if (run.kind === 'instruction') {
      if (top && !top.separated) {
        top.own.push(index);
        // The run text is escaped XML; the rules read the instruction itself.
        top.instruction += decodeEntities(run.text);
      } else {
        // Instruction text belongs between a begin and its separator, nowhere else.
        keep[index] = false;
      }
    } else if (run.kind === 'separate') {
      if (!top || top.separated) return runs.map(() => false);
      top.separated = true;
      top.separator = index;
      top.own.push(index);
    } else {
      const field = open.pop();
      if (!field) return runs.map(() => false);
      field.own.push(index);
      if (field.nestedFirst || !pasteKeepsField(field.instruction)) {
        for (const own of field.own) keep[own] = false;
        // A field nested in the instruction goes with it: it only ever fed the instruction.
        const instructionEnd = field.separator < 0 ? index : field.separator;
        for (let at = field.begin; at < instructionEnd; at += 1) keep[at] = false;
      }
    }
  }
  return open.length === 0 ? keep : runs.map(() => false);
}

function fieldRunsOf(blocks: readonly string[]): FieldRun[] {
  const runs: FieldRun[] = [];
  for (const block of blocks)
    for (const match of block.matchAll(FIELD_RUN))
      runs.push(
        match[1] !== undefined
          ? { kind: match[1] as FieldRun['kind'], text: '' }
          : { kind: 'instruction', text: match[2]! }
      );
  return runs;
}

/**
 * The blocks with only complete fields of a type a paste keeps. Unchanged when every field
 * qualifies; see {@link keptFieldRuns}.
 */
export function withCompleteFields(blocks: readonly string[]): readonly string[] {
  if (!blocks.some((block) => block.includes('<w:fldChar') || block.includes('<w:instrText')))
    return blocks;
  const keep = keptFieldRuns(fieldRunsOf(blocks));
  if (keep.every(Boolean)) return blocks;
  let index = 0;
  return blocks.map((block) => block.replace(FIELD_RUN, (whole) => (keep[index++] ? whole : '')));
}

/** {@link withCompleteFields} for each pasted note, which must hold whole fields on its own. */
export function withCompleteNoteFields<Kind extends string>(
  notes: Readonly<Record<Kind, ReadonlyMap<number, readonly string[]>>>
): Record<Kind, ReadonlyMap<number, readonly string[]>> {
  const out = {} as Record<Kind, ReadonlyMap<number, readonly string[]>>;
  for (const kind of Object.keys(notes) as Kind[]) {
    const checked = new Map<number, readonly string[]>();
    for (const [id, blocks] of notes[kind]) checked.set(id, withCompleteFields(blocks));
    out[kind] = checked;
  }
  return out;
}
