// Document-property fields (§17.16): TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS,
// and the generic `DOCPROPERTY "Name"` over that same fixed set of names.
//
// These fields DISPLAY metadata the document already carries in `docProps/core.xml`. Nothing
// here executes: the instruction is attacker-controlled and is only ever recognized, never
// evaluated as code. Recognition is bounded (one length-capped normalize pass) and every
// unrecognized instruction — including any custom-property name — resolves to null and stays
// inert.
//
// DATE-valued document-property fields (CREATEDATE / SAVEDATE / PRINTDATE) are deliberately NOT
// recognized here: date formatting is out of scope, so they stay inert rather than paint a
// nondeterministic value.
//
// DEVIATION: a `\* Upper` / `\* Lower` / `\* FirstCap` / `\* Caps` casing switch is STRIPPED for
// recognition but its transform is NOT applied — the raw property value paints. Word would
// re-case it; this renders the stored string verbatim.

import type { DocumentProperties } from '@docx-editor.dev/core/store';
import { normalizeFieldInstruction } from './field-instruction.ts';

/** The document-property keys a field may resolve to. A subset of {@link DocumentProperties}. */
export type DocumentPropertyKey =
  'title' | 'creator' | 'subject' | 'keywords' | 'lastModifiedBy' | 'description';

/** One recognized document-property field: which property it displays, nothing executable. */
export interface DocPropertyField {
  readonly property: DocumentPropertyKey;
}

/**
 * The field keyword (and the equivalent `DOCPROPERTY` name) mapped to its property key.
 *
 * A fixed table read by exact uppercased key: a file-supplied name is only ever LOOKED UP here,
 * never assigned, so a hostile `DOCPROPERTY "__proto__"` matches nothing and pollutes nothing.
 */
const KEYWORD_TO_PROPERTY: Readonly<Record<string, DocumentPropertyKey>> = Object.freeze({
  TITLE: 'title',
  AUTHOR: 'creator',
  SUBJECT: 'subject',
  KEYWORDS: 'keywords',
  LASTSAVEDBY: 'lastModifiedBy',
  COMMENTS: 'description',
});

/**
 * One TRAILING field switch — `\*`, `\@`, `\#`, `\!` plus an optional argument — anchored at the
 * end. The string is already normalized (uppercased, single-spaced), so the switch letter is
 * upper case and each alternative is a distinct character class, keeping the match linear.
 */
const TRAILING_SWITCH = /\s*\\[A-Z*@#!]\s*(?:"[^"]*"|[^\s"\\]+)?\s*$/;

/** Strip every trailing field switch, one bounded pass at a time (each pass shortens `s`). */
function stripTrailingSwitches(s: string): string {
  let out = s;
  for (;;) {
    const next = out.replace(TRAILING_SWITCH, '').trimEnd();
    if (next === out) return out;
    out = next;
  }
}

/** The first whitespace- or quote-delimited token of `s`, unquoted, or null when empty. */
function firstToken(s: string): string | null {
  const trimmed = s.trimStart();
  if (trimmed.length === 0) return null;
  if (trimmed[0] === '"') {
    const close = trimmed.indexOf('"', 1);
    const inner = close === -1 ? trimmed.slice(1) : trimmed.slice(1, close);
    return inner.length > 0 ? inner : null;
  }
  const space = trimmed.search(/\s/);
  const token = space === -1 ? trimmed : trimmed.slice(0, space);
  return token.length > 0 ? token : null;
}

/**
 * Recognize a document-property instruction, or null when it is not one (or is hostile).
 *
 * Accepts a bare keyword (`TITLE`, `AUTHOR`, …) with no argument, and `DOCPROPERTY "Name"` for
 * the same fixed set of names (matched case-insensitively). An unknown `DOCPROPERTY` name, a
 * date-valued field, or anything over the shared length cap stays inert.
 */
export function parseDocPropertyInstruction(raw: string): DocPropertyField | null {
  const normalized = normalizeFieldInstruction(raw);
  if (normalized === null || normalized.length === 0) return null;
  const stripped = stripTrailingSwitches(normalized);

  const direct = KEYWORD_TO_PROPERTY[stripped];
  if (direct) return { property: direct };

  if (!stripped.startsWith('DOCPROPERTY')) return null;
  const rest = stripped.slice('DOCPROPERTY'.length);
  // The keyword must be followed by whitespace before the name: `DOCPROPERTYX` is not a match.
  if (rest.length === 0 || !/^\s/.test(rest)) return null;
  const name = firstToken(rest);
  if (name === null) return null;
  const property = KEYWORD_TO_PROPERTY[name];
  return property ? { property } : null;
}

/**
 * Resolve a recognized field to the text it paints, or null when the property is missing or
 * empty (the field then paints nothing, exactly as an empty cached result would).
 */
export function docPropertyValue(
  field: DocPropertyField,
  props: DocumentProperties | undefined
): string | null {
  if (!props) return null;
  const value = props[field.property];
  return value !== undefined && value.length > 0 ? value : null;
}
