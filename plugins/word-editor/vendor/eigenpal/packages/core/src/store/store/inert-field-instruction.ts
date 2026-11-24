// The bounded field instructions an authoring lane may write.
//
// An instruction is caller data. It is written as `w:instrText` or `w:instr` text and never
// evaluated: the cached result stays empty until a host or the caller writes one. Only the
// first word names the field type, and only types that read the document itself are
// admitted: page numbers, references to bookmarks, notes and styles, sequence numbers, and
// dates. Every other type refuses by omission. That includes types that fetch, embed, link,
// run or prompt: DDE, DDEAUTO, INCLUDETEXT, INCLUDEPICTURE, IMPORT, LINK, MACROBUTTON,
// AUTOTEXT. Those names also refuse as any bare-word argument, so a later reader that is less
// strict about the first word cannot find one there. A quoted argument refuses when its whole
// trimmed text is one of those names, or when it holds a URL scheme (`scheme://`); a quoted
// argument that only contains such a name among other words is admitted, as plain text.

/** Field types an authoring lane may write. Each reads only the document. */
export const INERT_FIELD_KEYWORDS = [
  'PAGE',
  'NUMPAGES',
  'REF',
  'PAGEREF',
  'NOTEREF',
  'SEQ',
  'STYLEREF',
  'DATE',
  'TIME',
] as const;

/** One admitted field type. */
export type InertFieldKeyword = (typeof INERT_FIELD_KEYWORDS)[number];

/** The longest instruction an authoring lane writes, in UTF-16 units. */
export const MAX_AUTHORED_FIELD_INSTRUCTION_CHARS = 255;

/** Field types that fetch, embed, link, run, or prompt. They refuse as any word. */
const REFUSED_FIELD_WORDS: ReadonlySet<string> = new Set([
  'ADDIN',
  'ASK',
  'AUTOTEXT',
  'AUTOTEXTLIST',
  'DATABASE',
  'DDE',
  'DDEAUTO',
  'EMBED',
  'FILLIN',
  'GOTOBUTTON',
  'HYPERLINK',
  'IMPORT',
  'INCLUDE',
  'INCLUDEPICTURE',
  'INCLUDETEXT',
  'LINK',
  'MACROBUTTON',
  'OCX',
  'PRINT',
  'PRIVATE',
  'SUBSCRIBER',
]);

/** Types whose first argument names a bookmark. */
const BOOKMARK_TYPES: ReadonlySet<string> = new Set(['REF', 'PAGEREF', 'NOTEREF']);

// One token at the start of the rest: a switch, a quoted string, or a bare word. A quoted
// string holds no quote or backslash, and the whole instruction holds no control character
// (checked first); a bare word holds letters, digits, and `_ . : -` only.
const TOKEN = /^(?:(\\[A-Za-z*#@!])|"([^"\\]{0,128})"|([\p{L}\p{N}_.:-]{1,128}))(?= |$)/u;

/** C0 and C1 controls, and the line and paragraph separators. */
const CONTROL = /[\p{Cc}\u2028\u2029]/u;

/**
 * The normalized instruction, or `null` when the instruction is not one this lane writes.
 *
 * The first word must be an admitted type. Arguments are switches, quoted strings, and bare
 * words separated by spaces. PAGE and NUMPAGES take no switches, because the page update
 * computes only their plain form. REF, PAGEREF, and NOTEREF need a bookmark name, SEQ a
 * sequence name, and STYLEREF a style name. A refused field type in any word refuses, and so
 * does a quoted string that holds a URL scheme.
 */
export function inertFieldInstruction(instruction: unknown): string | null {
  if (typeof instruction !== 'string') return null;
  if (instruction.length > MAX_AUTHORED_FIELD_INSTRUCTION_CHARS) return null;
  if (CONTROL.test(instruction)) return null;
  let rest = instruction.trim();
  const words: { readonly text: string; readonly kind: 'switch' | 'quoted' | 'word' }[] = [];
  while (rest) {
    const match = TOKEN.exec(rest);
    if (!match) return null;
    const [whole, flag, quoted, word] = match;
    if (flag !== undefined) words.push({ text: flag, kind: 'switch' });
    else if (quoted !== undefined) {
      if (/[a-z][a-z0-9+.-]*:\/\//i.test(quoted)) return null;
      if (REFUSED_FIELD_WORDS.has(quoted.trim().toUpperCase())) return null;
      words.push({ text: whole, kind: 'quoted' });
    } else {
      if (REFUSED_FIELD_WORDS.has(word!.toUpperCase())) return null;
      words.push({ text: word!, kind: 'word' });
    }
    rest = rest.slice(whole.length).replace(/^ +/, '');
  }
  const [first, ...args] = words;
  if (!first || first.kind !== 'word') return null;
  const keyword = first.text.toUpperCase();
  if (!(INERT_FIELD_KEYWORDS as readonly string[]).includes(keyword)) return null;
  if ((keyword === 'PAGE' || keyword === 'NUMPAGES') && args.length > 0) return null;
  const subject = args[0];
  if (BOOKMARK_TYPES.has(keyword) && subject?.kind !== 'word') return null;
  if (keyword === 'SEQ' && subject?.kind !== 'word') return null;
  if (keyword === 'STYLEREF' && subject?.kind !== 'word' && subject?.kind !== 'quoted') return null;
  return [keyword, ...args.map((arg) => arg.text)].join(' ');
}

/** The admitted type an instruction names, or `null`. */
export function inertFieldKeyword(instruction: string): InertFieldKeyword | null {
  const normalized = inertFieldInstruction(instruction);
  return normalized === null ? null : (normalized.split(' ')[0] as InertFieldKeyword);
}
