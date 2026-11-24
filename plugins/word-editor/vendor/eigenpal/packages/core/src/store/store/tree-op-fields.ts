// Page-number field insertion for furniture stories (and any paragraph).
//
// Authors allowlisted complex fields only — PAGE / NUMPAGES / SECTIONPAGES and the
// PAGE_X_OF_Y composition, plus the inert instructions `inert-field-instruction.ts` admits.
// Nodes are typed `fldChar` / `instrText` with schema-legal attributes; instructions are
// written as text, never evaluated.

import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';

export type PageFieldKind = 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y';

function fldChar(
  nextId: () => string,
  type: 'begin' | 'separate' | 'end',
  dirty = false
): OoxmlNode {
  return {
    id: nextId(),
    kind: 'fldChar',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'fldChar',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'fldCharType',
        prefix: 'w',
        value: type,
      },
      ...(dirty ? [dirtyAttribute()] : []),
    ],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * `w:dirty="true"` (§17.16.18): the cached result is not the field's computed value, so the
 * next reader that evaluates fields recomputes it. Never read by this engine's layout.
 */
export function dirtyAttribute(): FieldAttribute {
  return {
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'dirty',
    prefix: 'w',
    value: 'true',
  };
}

export interface FieldAttribute {
  readonly kind: 'genericExtension';
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix: string;
  readonly value: string;
}

function instrText(nextId: () => string, instruction: string): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind: 'instrText',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'instrText',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'xmlSpace',
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space',
        prefix: 'xml',
        value: 'preserve',
      },
    ],
    children: [{ id: valueId, kind: 'textValue', value: ` ${instruction} ` }],
  } as unknown as OoxmlNode;
}

function textElement(nextId: () => string, text: string): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

/** An empty `w:t`, the text of an empty cached result. */
function emptyText(nextId: () => string): OoxmlNode {
  return { ...textElement(nextId, ''), children: [] } as unknown as OoxmlNode;
}

/** The literal between the two fields of the PAGE_X_OF_Y composition. */
const PAGE_X_OF_Y_SEPARATOR = ' of ';

/** Run-child builders for one allowlisted page field (or PAGE X OF Y composition). */
export function pageFieldContentBuilders(
  field: PageFieldKind
): readonly ((mint: () => string) => OoxmlNode)[] {
  const complex = complexFieldContentBuilders;
  if (field === 'PAGE_X_OF_Y') {
    return [
      ...complex('PAGE'),
      (mint) => textElement(mint, PAGE_X_OF_Y_SEPARATOR),
      ...complex('NUMPAGES'),
    ];
  }
  return [...complex(field)];
}

/**
 * Run-child builders for one complex field with an empty cached result: `begin`, the
 * instruction, `separate`, `end`. The caller has already checked the instruction (see
 * `inert-field-instruction.ts`); it is written as text and never evaluated. With `dirty`, the
 * begin marker carries `w:dirty="true"`.
 */
export function complexFieldContentBuilders(
  instruction: string,
  dirty = false
): readonly ((mint: () => string) => OoxmlNode)[] {
  return [
    (mint) => fldChar(mint, 'begin', dirty),
    (mint) => instrText(mint, instruction),
    (mint) => fldChar(mint, 'separate'),
    (mint) => fldChar(mint, 'end'),
  ];
}

/**
 * The same field as complete runs — `begin`, instruction, `separate`, one empty result run,
 * `end` — the shape the field readers list, refresh, and delete as one field. The empty result
 * run is what a result write or `updateResult` rewrites. Each run carries its own copy of
 * `properties` (fresh `w:rPr` nodes), so the field takes the formatting of the text beside it.
 */
export function complexFieldRuns(
  mint: () => string,
  instruction: string,
  options: { readonly dirty?: boolean; readonly properties?: () => readonly OoxmlNode[] } = {}
): OoxmlNode[] {
  const [begin, code, separate, end] = complexFieldContentBuilders(
    instruction,
    options.dirty === true
  );
  return [begin!, code!, separate!, emptyText, end!].map(
    (build) =>
      ({
        id: mint(),
        kind: 'run',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'r',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [...(options.properties?.() ?? []), build(mint)],
      }) as unknown as OoxmlNode
  );
}
/**
 * The field's size in MODEL units, on `segmentsOf`'s terms.
 *
 * A complex field is one addressable unit at its `begin`; the instruction, separator and
 * `end` measure nothing. Only the PAGE_X_OF_Y literal adds characters of its own.
 */
export function pageFieldModelLength(field: PageFieldKind): number {
  return field === 'PAGE_X_OF_Y' ? 1 + PAGE_X_OF_Y_SEPARATOR.length + 1 : 1;
}
