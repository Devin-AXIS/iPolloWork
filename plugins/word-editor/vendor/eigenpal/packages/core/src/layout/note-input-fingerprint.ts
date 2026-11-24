// Content identity for the memoized note-pagination input.

import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { LayoutNoteStoryOptions } from './note-layout.ts';
import type { NotesLayoutInput } from './note-pagination.ts';

type NotesMemoInputRole =
  | 'content-fingerprint'
  | 'identity-check'
  | 'projection-epoch-guarded'
  | 'relationship-epoch-guarded'
  | 'drawing-epoch-guarded'
  | 'pass-projector';

/**
 * Evolution ratchet for the whole-note memo.
 *
 * A note story is cached above its paragraph/table walks, so adding an input without deciding
 * how that outer memo observes it can serve an entire stale story before a precise inner cache
 * token gets read. The guarded roles fail closed when their matching content epoch is absent;
 * identity and content roles are compared in `notesMemoFor` and below, respectively.
 */
const NOTES_LAYOUT_INPUT_MEMO_ROLES = Object.freeze({
  footnotesPart: 'identity-check',
  endnotesPart: 'identity-check',
  footnotePropsBySection: 'content-fingerprint',
  endnotePropsBySection: 'content-fingerprint',
  documentFootnoteProps: 'content-fingerprint',
  documentEndnoteProps: 'content-fingerprint',
  measurer: 'identity-check',
  producer: 'content-fingerprint',
  displayMode: 'content-fingerprint',
  revisionAuthorFilter: 'content-fingerprint',
  cache: 'identity-check',
  styleCascade: 'identity-check',
  numberingIndex: 'identity-check',
  lineGridPitchBySection: 'content-fingerprint',
  defaultTabStopPt: 'content-fingerprint',
  compatibilityMode: 'content-fingerprint',
  projectLink: 'pass-projector',
  projectLinkForPart: 'relationship-epoch-guarded',
  linkRelsEpoch: 'content-fingerprint',
  projectionTokenForParagraphForPart: 'projection-epoch-guarded',
  projectionTokenForTableForPart: 'projection-epoch-guarded',
  projectionEpoch: 'content-fingerprint',
  showFieldCodes: 'content-fingerprint',
  projectFieldLink: 'pass-projector',
  documentProperties: 'content-fingerprint',
  refFields: 'content-fingerprint',
  drawingsForPart: 'drawing-epoch-guarded',
  drawingLayoutEpoch: 'content-fingerprint',
} satisfies Readonly<Record<keyof NotesLayoutInput, NotesMemoInputRole>>);

type NoteStoryOptionRole =
  NotesMemoInputRole | 'note-mark-context' | 'per-call-bound' | 'derived-owner';

/**
 * Second half of the ratchet: every option the cached story walk can consume must name the
 * outer-memo dependency that pins it, or state why it is owned by the individual call.
 */
const NOTE_STORY_OPTION_MEMO_ROLES = Object.freeze({
  measurer: 'identity-check',
  producer: 'content-fingerprint',
  cache: 'identity-check',
  styleCascade: 'identity-check',
  numberingIndex: 'identity-check',
  defaultTabStopPt: 'content-fingerprint',
  compatibilityMode: 'content-fingerprint',
  lineGridPitchPt: 'content-fingerprint',
  projectLink: 'pass-projector',
  projectLinkForPart: 'relationship-epoch-guarded',
  showFieldCodes: 'content-fingerprint',
  projectFieldLink: 'pass-projector',
  projectionTokenForParagraphForPart: 'projection-epoch-guarded',
  projectionTokenForTableForPart: 'projection-epoch-guarded',
  documentProperties: 'content-fingerprint',
  refFields: 'content-fingerprint',
  noteMarks: 'note-mark-context',
  maxFlowHeightPt: 'per-call-bound',
  drawingsForPart: 'drawing-epoch-guarded',
  ownerPartName: 'derived-owner',
  displayMode: 'content-fingerprint',
  revisionAuthorFilter: 'content-fingerprint',
} satisfies Readonly<Record<keyof LayoutNoteStoryOptions, NoteStoryOptionRole>>);

void NOTE_STORY_OPTION_MEMO_ROLES;

function hasDefinedInputWithRole(input: NotesLayoutInput, role: NotesMemoInputRole): boolean {
  for (const key of Object.keys(NOTES_LAYOUT_INPUT_MEMO_ROLES) as (keyof NotesLayoutInput)[]) {
    if (NOTES_LAYOUT_INPUT_MEMO_ROLES[key] === role && input[key] !== undefined) return true;
  }
  return false;
}

function fingerprintNoteProps(props: {
  readonly pos: string;
  readonly numFmt: string;
  readonly numStart: number;
  readonly numRestart: string;
}): string {
  return `${props.pos},${props.numFmt},${props.numStart},${props.numRestart}`;
}

/**
 * Content fingerprint paired with the identities note pagination compares separately.
 * A projector without its matching epoch fails closed by disabling the memo.
 * @internal
 */
export function fingerprintNotesInput(input: NotesLayoutInput): string | null {
  if (
    hasDefinedInputWithRole(input, 'drawing-epoch-guarded') &&
    input.drawingLayoutEpoch === undefined
  ) {
    return null;
  }
  if (
    hasDefinedInputWithRole(input, 'relationship-epoch-guarded') &&
    input.linkRelsEpoch === undefined
  ) {
    return null;
  }
  if (
    hasDefinedInputWithRole(input, 'projection-epoch-guarded') &&
    input.projectionEpoch === undefined
  ) {
    return null;
  }
  return [
    input.producer,
    input.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
    input.revisionAuthorFilter?.cacheKey ?? '',
    input.showFieldCodes ?? false,
    input.defaultTabStopPt ?? '',
    input.compatibilityMode ?? '',
    (input.lineGridPitchBySection ?? []).join(','),
    input.drawingLayoutEpoch ?? '',
    input.linkRelsEpoch ?? '',
    input.projectionEpoch ?? '',
    input.refFields?.valuesToken ?? '',
    // Projectors are rebuilt per pass but pure over the parts/epochs this memo already pins.
    input.documentProperties ? JSON.stringify(input.documentProperties) : '',
    fingerprintNoteProps(input.documentFootnoteProps),
    fingerprintNoteProps(input.documentEndnoteProps),
    input.footnotePropsBySection.map(fingerprintNoteProps).join(';'),
    input.endnotePropsBySection.map(fingerprintNoteProps).join(';'),
  ].join('\0');
}
