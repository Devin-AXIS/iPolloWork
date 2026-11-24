// Content-control (`w:sdt`) kind vocabulary and schema-legality helpers.
//
// Typed SDT nodes live in the same canonical tree as paragraphs and tables — there is no
// parallel semantic model. This module owns only the kind/localName maps, the `w:val`
// allowance for CT_String-shaped date leaves, parent-context promotion (so `w:lid` under
// `w:rPr` stays generic), and the CT_SdtPr / CT_Sdt* child-shape checks consumed by
// `validKnownKind`.
//
// Namespace URI strings are inlined (not imported from ooxml-shared) so this module can be
// imported by both ooxml-shared and ooxml-tree without a runtime cycle.

import type { OoxmlNode } from './ooxml-tree.ts';

const WML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** `CT_SdtPr` sequence before the type choice (ECMA-376 §17.5.2.38). */
const SDT_PR_SEQUENCE: readonly string[] = [
  'rPr',
  'alias',
  'tag',
  'id',
  'lock',
  'placeholder',
  'temporary',
  'showingPlcHdr',
  'dataBinding',
  'label',
  'tabIndex',
];

const SDT_PR_SEQUENCE_INDEX: ReadonlyMap<string, number> = new Map(
  SDT_PR_SEQUENCE.map((localName, index) => [localName, index])
);

/** ECMA-376 type choice under `CT_SdtPr` — at most one. */
const SDT_PR_TYPE_LOCAL_NAMES = new Set([
  'equation',
  'comboBox',
  'date',
  'docPartObj',
  'docPartList',
  'dropDownList',
  'picture',
  'richText',
  'text',
  'citation',
  'group',
  'bibliography',
]);

/** Property leaves that carry schema-required `w:val` and must stay typed. */
const KINDS_ALLOWING_WML_VAL = new Set([
  'contentControlDateFormat',
  'contentControlLid',
  'contentControlStoreMappedDataAs',
  'contentControlCalendar',
]);

const SDT_DATE_CHILD_KINDS = new Set([
  'contentControlDateFormat',
  'contentControlLid',
  'contentControlStoreMappedDataAs',
  'contentControlCalendar',
  'generic',
]);

const SDT_CHECKBOX_CHILD_KINDS = new Set([
  'contentControlChecked',
  'contentControlCheckedState',
  'contentControlUncheckedState',
  'generic',
]);

/** WML local names that type only under a content-control date parent (`w:lid` also lives on `w:rPr`). */
const SDT_DATE_CONTEXT_LOCAL_NAMES: Readonly<Record<string, string>> = {
  dateFormat: 'contentControlDateFormat',
  lid: 'contentControlLid',
  storeMappedDataAs: 'contentControlStoreMappedDataAs',
  calendar: 'contentControlCalendar',
};

/** W14 payload vocabulary under `w14:checkbox`. */
const SDT_CHECKBOX_CONTEXT_LOCAL_NAMES: Readonly<Record<string, string>> = {
  checked: 'contentControlChecked',
  checkedState: 'contentControlCheckedState',
  uncheckedState: 'contentControlUncheckedState',
};

/** Globally-unique WML SDT payload / wrapper local names (no collision with other typed kinds). */
const SDT_WML_ELEMENTS: Readonly<Record<string, string>> = {
  sdt: 'contentControl',
  sdtPr: 'contentControlProperties',
  sdtEndPr: 'contentControlEndProperties',
  sdtContent: 'contentControlContent',
  dropDownList: 'contentControlDropDownList',
  comboBox: 'contentControlComboBox',
  listItem: 'contentControlListItem',
  date: 'contentControlDate',
  text: 'contentControlText',
  dataBinding: 'contentControlDataBinding',
};

const SDT_W14_ELEMENTS: Readonly<Record<string, string>> = {
  checkbox: 'contentControlCheckbox',
};

/**
 * Content containers a stray `w:val` means nothing on. It is kept as written, and the container
 * stays typed, so its text still shows.
 */
const KINDS_IGNORING_WML_VAL = new Set([
  'paragraph',
  'run',
  'text',
  'deletedText',
  'hyperlink',
  'table',
  'tableRow',
  'tableCell',
]);

export function knownKindAllowsWmlVal(kind: string): boolean {
  return KINDS_ALLOWING_WML_VAL.has(kind) || KINDS_IGNORING_WML_VAL.has(kind);
}

/**
 * Resolve a candidate known kind for an SDT-related element. Parent context is required
 * where the same local name is legal both inside and outside SDT payloads (`w:lid`,
 * checkbox states). Returns `undefined` when the name is not an SDT vocabulary member.
 *
 * `w:sdt` under `w:r` is never typed: `CT_SdtRun` lives in `EG_PContent` (a paragraph
 * sibling of runs), not inside a run. Typing that husk would demote the run and blank
 * every sibling atom in `segmentsOf`.
 */
export function candidateSdtKind(
  namespaceUri: string,
  localName: string,
  parentCandidate: string | undefined
): string | undefined {
  if (namespaceUri === W14_NAMESPACE_URI) {
    if (parentCandidate === 'contentControlCheckbox') {
      const contextual = SDT_CHECKBOX_CONTEXT_LOCAL_NAMES[localName];
      if (contextual !== undefined) return contextual;
    }
    return SDT_W14_ELEMENTS[localName];
  }
  if (namespaceUri !== WML_NAMESPACE_URI) return undefined;
  // Misplaced run-inner wrapper → generic; keep the surrounding run typed.
  if (localName === 'sdt' && parentCandidate === 'run') return undefined;
  if (parentCandidate === 'contentControlDate') {
    const contextual = SDT_DATE_CONTEXT_LOCAL_NAMES[localName];
    if (contextual !== undefined) return contextual;
  }
  return SDT_WML_ELEMENTS[localName];
}

function atMostOne(
  children: readonly OoxmlNode[],
  predicate: (child: OoxmlNode) => boolean
): boolean {
  return children.filter(predicate).length <= 1;
}

/** `CT_SdtBlock`/`Run`/`Row`/`Cell`: `sdtPr?`, `sdtEndPr?`, `sdtContent?` in that order. */
export function validContentControlChildren(children: readonly OoxmlNode[]): boolean {
  let stage = 0;
  let seenPr = false;
  let seenEnd = false;
  let seenContent = false;
  for (const child of children) {
    if (child.kind === 'contentControlProperties') {
      if (stage > 0 || seenPr) return false;
      seenPr = true;
      stage = 1;
      continue;
    }
    if (child.kind === 'contentControlEndProperties') {
      if (stage > 1 || seenEnd) return false;
      seenEnd = true;
      stage = 2;
      continue;
    }
    if (child.kind === 'contentControlContent') {
      if (stage > 2 || seenContent) return false;
      seenContent = true;
      stage = 3;
      continue;
    }
    if (child.kind === 'textValue') return false;
    if (child.kind !== 'generic' && child.kind !== 'bookmarkStart' && child.kind !== 'bookmarkEnd')
      return false;
  }
  return true;
}

/**
 * `CT_SdtPr` sequence legality: known vocabulary stays in schema order, singulars do not
 * duplicate, at most one ECMA type element. Unknown / extension children (including
 * `w14:checkbox` and `w15:*`) are preserved in position and do not demote the properties.
 */
export function validContentControlPropertiesChildren(children: readonly OoxmlNode[]): boolean {
  let lastSequence = -1;
  let seenType = false;
  const seenSequence = new Set<number>();

  for (const child of children) {
    if (child.kind === 'textValue') return false;

    if (child.kind === 'runProperties') {
      if (seenSequence.has(0) || seenType || 0 < lastSequence) return false;
      seenSequence.add(0);
      lastSequence = 0;
      continue;
    }

    if (
      child.kind === 'contentControlDropDownList' ||
      child.kind === 'contentControlComboBox' ||
      child.kind === 'contentControlDate' ||
      child.kind === 'contentControlText'
    ) {
      if (seenType) return false;
      seenType = true;
      continue;
    }

    if (child.kind === 'contentControlDataBinding') {
      const index = SDT_PR_SEQUENCE_INDEX.get('dataBinding')!;
      if (seenSequence.has(index) || seenType || index < lastSequence) return false;
      seenSequence.add(index);
      lastSequence = index;
      continue;
    }

    if (child.kind === 'contentControlCheckbox') {
      // Vendor extension — not an ECMA type choice; keep in position.
      continue;
    }

    if (child.kind !== 'generic') return false;

    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;

    const sequenceIndex = SDT_PR_SEQUENCE_INDEX.get(child.localName);
    if (sequenceIndex !== undefined) {
      if (seenSequence.has(sequenceIndex) || seenType || sequenceIndex < lastSequence) return false;
      seenSequence.add(sequenceIndex);
      lastSequence = sequenceIndex;
      continue;
    }

    if (SDT_PR_TYPE_LOCAL_NAMES.has(child.localName)) {
      if (seenType) return false;
      seenType = true;
      continue;
    }
  }

  return true;
}

export function validContentControlEndPropertiesChildren(children: readonly OoxmlNode[]): boolean {
  return (
    children.every((child) => child.kind === 'runProperties' || child.kind === 'generic') &&
    atMostOne(children, (child) => child.kind === 'runProperties')
  );
}

export function validContentControlContentChildren(children: readonly OoxmlNode[]): boolean {
  return children.every(
    (child) =>
      child.kind === 'paragraph' ||
      child.kind === 'table' ||
      child.kind === 'run' ||
      child.kind === 'tableRow' ||
      child.kind === 'tableCell' ||
      child.kind === 'contentControl' ||
      child.kind === 'hyperlink' ||
      child.kind === 'bookmarkStart' ||
      child.kind === 'bookmarkEnd' ||
      // Comment range markers belong to `EG_RangeMarkupElements` exactly as the bookmark
      // markers above do, and `CT_SdtContentRun` is `EG_PContent`, which includes that
      // group. Admitting the bookmarks and not these refused a comment anchored inside a
      // content control — legal markup the schema has always allowed.
      child.kind === 'commentRangeStart' ||
      child.kind === 'commentRangeEnd' ||
      // Revision wrappers belong to `EG_RunLevelElts`, another member of the same content
      // groups. Refusing them made a tracked strike of a control's text — markup Word
      // writes with tracking on — invalidate the whole part.
      child.kind === 'revisionInsert' ||
      child.kind === 'revisionDelete' ||
      child.kind === 'revisionMoveFrom' ||
      child.kind === 'revisionMoveTo' ||
      child.kind === 'generic'
  );
}

export function validContentControlDropDownOrComboChildren(
  children: readonly OoxmlNode[]
): boolean {
  return children.every(
    (child) => child.kind === 'contentControlListItem' || child.kind === 'generic'
  );
}

export function validContentControlDateChildren(children: readonly OoxmlNode[]): boolean {
  if (!children.every((child) => SDT_DATE_CHILD_KINDS.has(child.kind))) return false;
  return (
    atMostOne(children, (child) => child.kind === 'contentControlDateFormat') &&
    atMostOne(children, (child) => child.kind === 'contentControlLid') &&
    atMostOne(children, (child) => child.kind === 'contentControlStoreMappedDataAs') &&
    atMostOne(children, (child) => child.kind === 'contentControlCalendar')
  );
}

export function validContentControlCheckboxChildren(children: readonly OoxmlNode[]): boolean {
  if (!children.every((child) => SDT_CHECKBOX_CHILD_KINDS.has(child.kind))) return false;
  return (
    atMostOne(children, (child) => child.kind === 'contentControlChecked') &&
    atMostOne(children, (child) => child.kind === 'contentControlCheckedState') &&
    atMostOne(children, (child) => child.kind === 'contentControlUncheckedState')
  );
}

export function validEmptySdtPayload(children: readonly OoxmlNode[]): boolean {
  return children.length === 0;
}
