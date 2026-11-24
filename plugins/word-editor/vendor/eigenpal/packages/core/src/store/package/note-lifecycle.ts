/* eslint-disable max-lines -- note lifecycle seam: insert/delete/convert/bulk + style rewrite */

// Footnote/endnote package lifecycle: insert, delete, convert, set properties.
//
// These mutations touch the main document (or other stories), the notes part,
// document rels, and `[Content_Types].xml` — never a single story tree alone.
// Application is pure: given a package and an op, return a new package or a typed
// rejection, with no partial writes.
//
// Security: engine-authored XML is literals + validated integers only; relationship
// targets are relative safe paths; scans are bounded; no field/macro execution.

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
  replaceChildren,
  replaceNode,
} from './ooxml-edit.ts';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from './ooxml-tree.ts';
import { bindMissingPrefixes } from './edit-namespace-scope.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { namespaceBindingsAt } from './wml-namespace.ts';
import {
  allocateNoteId,
  findNoteById,
  noteIdOf,
  noteKindOf,
  noteRefKindOf,
  noteReferenceKindOf,
  noteTypeOf,
  type NoteKind,
  NOTE_ID_MAX,
  NOTE_ID_MIN,
} from './note-nodes.ts';
import {
  canHoldNoteCitation,
  citationSplitParent,
  freeRelationshipId,
  withContentTypeOverride,
  withFreshIds,
  withNotesRelationship,
} from './note-lifecycle-shell.ts';
import { writeDocumentNoteProperties, writeSectionNoteProperties } from './note-lifecycle-props.ts';
import {
  ancestorPathHolding,
  citationBesideControlAt,
  placeOutsideOutermostRevision,
  placeCitationAtRunBoundary,
  splitRunAroundText,
} from './note-citation-placement.ts';
import {
  isLegalEndnotePosition,
  isLegalFootnotePosition,
  isLegalNumRestart,
} from './note-properties.ts';
import {
  collectPackageNoteReferences,
  createNoteReferenceScanBudget,
  MAX_NOTE_REFERENCE_MUTATION_SCAN,
  resolveNotesPart,
  normalNoteIds,
  type NoteReferenceHit,
  type NoteReferenceScanBudget,
} from './note-references.ts';
import { isValidXmlText } from './sinks.ts';
import { applyInsertTrackedRun } from '../store/tree-op-tracked.ts';
import { paragraphOffsetIndex } from '../store/tree-op-segments.ts';
import {
  invalidRevisionAttribution,
  type RevisionAttributionInput,
} from '../store/tree-op-types.ts';

const W = WML_NAMESPACE_URI;
const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
const FOOTNOTES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const ENDNOTES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
const MAX_SECTIONS = 4_096;

/** Built-in Word character styles for note marks — not user theme aliases. */
const BUILTIN_NOTE_REFERENCE_STYLE: Readonly<Record<NoteKind, string>> = {
  footnote: 'FootnoteReference',
  endnote: 'EndnoteReference',
};

function isWmlValAttribute(attr: {
  readonly localName: string;
  readonly namespaceUri: string;
}): boolean {
  return (
    attr.localName === 'val' &&
    (attr.namespaceUri === WML_NAMESPACE_URI || attr.namespaceUri === '')
  );
}

/**
 * Rewrite `w:rStyle/@w:val` on a run that directly holds a note citation or body mark.
 *
 * Matching rule (bounded): only when the run contains a `noteReference` / `noteRef` atom
 * (typed or generic `w:footnoteReference`, `w:endnoteReference`, `w:footnoteRef`,
 * `w:endnoteRef`) AND a WML-namespaced `w:rPr/w:rStyle` whose WML `@w:val` exactly equals
 * the source kind's built-in style (`FootnoteReference` / `EndnoteReference`). Foreign
 * namespace `rStyle` / `val` attributes are preserved byte-for-byte. Custom style ids,
 * absent `rPr`, and absent `rStyle` are left unchanged — Word does not require a character
 * style on note marks for validity; layout resolves marks through element type + cascade
 * defaults.
 */
function rewriteRunBuiltinNoteReferenceStyle(
  run: OoxmlNode,
  fromKind: NoteKind,
  toKind: NoteKind
): OoxmlNode {
  if (run.kind !== 'run' || fromKind === toKind) return run;
  if (!run.children.some((child) => isNoteRefAtomInRun(child))) return run;

  const fromStyle = BUILTIN_NOTE_REFERENCE_STYLE[fromKind];
  const toStyle = BUILTIN_NOTE_REFERENCE_STYLE[toKind];

  let changed = false;
  const children = run.children.map((child) => {
    if (child.kind !== 'runProperties') return child;
    let propsChanged = false;
    const props = child.children.map((prop) => {
      if (
        prop.kind !== 'generic' ||
        prop.namespaceUri !== WML_NAMESPACE_URI ||
        prop.localName !== 'rStyle'
      ) {
        return prop;
      }
      const hasFromVal = prop.attributes.some(
        (attr) => isWmlValAttribute(attr) && attr.value === fromStyle
      );
      if (!hasFromVal) return prop;
      propsChanged = true;
      changed = true;
      return {
        ...prop,
        attributes: prop.attributes.map((attr) =>
          isWmlValAttribute(attr) && attr.value === fromStyle ? { ...attr, value: toStyle } : attr
        ),
      };
    });
    return propsChanged ? { ...child, children: props } : child;
  });
  return changed ? ({ ...run, children } as OoxmlNode) : run;
}

function isNoteRefAtomInRun(node: OoxmlNode): boolean {
  return noteReferenceKindOf(node) !== null || noteRefKindOf(node) !== null;
}

/** How far a note lifecycle op reaches — which parts a caller must expect to have changed. */
export type NoteLifecycleImpact = 'flow-structural' | 'global';

/**
 * A note lifecycle mutation: insert, delete, convert, or set properties.
 *
 * Package-level rather than story-level, because every one of these touches the main document,
 * the notes part, the document relationships AND `[Content_Types].xml` together.
 */
export type NoteLifecycleOp =
  | {
      readonly op: 'insertNote';
      readonly noteKind: NoteKind;
      readonly paragraphId: string;
      readonly offset: number;
      /**
       * Write the citing reference as a TRACKED insertion: the reference run goes inside a
       * `w:ins` carrying this attribution. The note body stays plain — rejecting the
       * reference removes it, and the orphaned body is swept by the same cascade an
       * untracked reference deletion triggers.
       */
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'deleteNote';
      readonly noteKind: NoteKind;
      readonly noteId: number;
    }
  | {
      readonly op: 'convertNote';
      readonly fromKind: NoteKind;
      readonly noteId: number;
    }
  | {
      /**
       * Convert every normal note of `fromKind` in document order. One atomic package
       * transaction / undo unit with the same validation as repeated `convertNote`.
       */
      readonly op: 'convertAllNotes';
      readonly fromKind: NoteKind;
    }
  | {
      readonly op: 'setNoteProperties';
      readonly scope: 'document' | 'section';
      readonly sectionIndex?: number;
      readonly footnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
      readonly endnote?: {
        readonly numFmt?: string;
        readonly numRestart?: string;
        readonly position?: string;
        readonly numStart?: number;
      };
    };

/** Why a note lifecycle op was refused. */
export type NoteLifecycleRejection = 'invalidArgs' | 'invalid-property-value' | 'tree-invariant';

/**
 * A new package, or a typed rejection.
 *
 * Application is PURE and all-or-nothing: there are no partial writes, so a refused op leaves the
 * caller's package untouched rather than half-migrated across four parts.
 */
export type NoteLifecycleResult =
  | {
      readonly ok: true;
      readonly package: OoxmlPackage;
      readonly impact: NoteLifecycleImpact;
      readonly noteId?: number;
      readonly noteKind?: NoteKind;
      readonly createdPartName?: string;
    }
  | {
      readonly ok: false;
      readonly reason: NoteLifecycleRejection;
      readonly detail?: string;
    };

const LIFECYCLE_OPS = new Set([
  'insertNote',
  'deleteNote',
  'convertNote',
  'convertAllNotes',
  'setNoteProperties',
]);

/** Whether an op is a note lifecycle op rather than a story-level one. */
export function isNoteLifecycleOp(op: { readonly op: string }): op is NoteLifecycleOp {
  return LIFECYCLE_OPS.has(op.op);
}

function fail(reason: NoteLifecycleRejection, detail?: string): NoteLifecycleResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

function isNoteKind(value: unknown): value is NoteKind {
  return value === 'footnote' || value === 'endnote';
}

function isPositiveNoteId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= NOTE_ID_MIN &&
    value <= NOTE_ID_MAX
  );
}

/** Attribution and limits applied to one note lifecycle op. */
export interface NoteLifecycleOptions {
  /**
   * Shared part + visited-node budget for reference scans. When omitted a fresh default
   * budget is used. Truncation rejects the op with the original package unchanged.
   */
  readonly scanBudget?: NoteReferenceScanBudget;
}

function createMutationScanBudget(): NoteReferenceScanBudget {
  return createNoteReferenceScanBudget(MAX_NOTE_REFERENCE_MUTATION_SCAN);
}

/**
 * Apply one note lifecycle op atomically. Rejected ops leave the input package untouched.
 */
export function applyNoteLifecycleOp(
  pkg: OoxmlPackage,
  op: NoteLifecycleOp,
  options?: NoteLifecycleOptions
): NoteLifecycleResult {
  if (!isNoteLifecycleOp(op)) return fail('invalidArgs', 'unknown-op');
  switch (op.op) {
    case 'insertNote':
      return applyInsertNote(pkg, op);
    case 'deleteNote':
      return applyDeleteNote(pkg, op, options);
    case 'convertNote':
      return applyConvertNote(pkg, op, options);
    case 'convertAllNotes':
      return applyConvertAllNotes(pkg, op, options);
    case 'setNoteProperties':
      return applySetNoteProperties(pkg, op);
  }
}

// ---------------------------------------------------------------------------
// insert
// ---------------------------------------------------------------------------

function applyInsertNote(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'insertNote' }>
): NoteLifecycleResult {
  if (!isNoteKind(op.noteKind)) return fail('invalidArgs', 'noteKind');
  if (typeof op.paragraphId !== 'string' || op.paragraphId.length === 0) {
    return fail('invalidArgs', 'paragraphId');
  }
  if (!Number.isInteger(op.offset) || op.offset < 0) return fail('invalidArgs', 'offset');
  // `CT_TrackChange` makes `@w:author` required, so a tracked variant with an empty one
  // would serialize a proposal no reader can attribute or resolve. The SAME predicate and
  // code every other tracked insert answers with, so a caller branching on the reason
  // sees one fault.
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return fail('invalid-property-value', 'revision-author');
  }

  const located = locateInsertParagraph(pkg, op.paragraphId);
  if (!located.ok) return fail('invalidArgs', located.detail);
  const paragraph = located.paragraph;
  const length = paragraphLength(paragraph);
  if (op.offset > length) return fail('invalidArgs', 'offset-out-of-range');

  let next = pkg;
  const ensured = ensureNotesPart(next, op.noteKind);
  if (!ensured.ok) return ensured;
  next = ensured.package;
  const createdPartName = ensured.createdPartName;

  const notesPart = resolveNotesPart(next, op.noteKind);
  if (!notesPart) return fail('tree-invariant', 'missing-notes-part');

  const noteId = allocateNoteId(notesPart.root);
  if (noteId === null) return fail('invalidArgs', 'note-id-exhausted');

  const bodyXml = emptyNoteXml(op.noteKind, noteId);
  const bodyRead = readOoxmlPart(bodyXml, {
    name: notesPart.name,
    contentType: notesPart.contentType,
  });
  if (!bodyRead.ok) return fail('tree-invariant', 'note-body-parse');
  const noteNode = bodyRead.part.root.children.find((child) => child.kind === 'note');
  if (!noteNode) return fail('tree-invariant', 'note-body-missing');

  const notesNextId = createNodeIdAllocator(notesPart);
  const freshNote = withFreshIds(noteNode, notesNextId);
  const appended = insertChildren(notesPart, notesPart.root.id, notesPart.root.children.length, [
    freshNote,
  ]);
  if (!appended.ok) return fail('tree-invariant', 'note-body-insert');
  next = withPart(next, appended.part);

  // Re-locate body paragraph after package updates (main part may be unchanged).
  const storyPart = next.parts.get(located.partName);
  if (!storyPart) return fail('tree-invariant', 'story-missing');
  const storyParagraph = findNode(storyPart, op.paragraphId);
  if (!storyParagraph || storyParagraph.kind !== 'paragraph') {
    return fail('tree-invariant', 'paragraph-missing');
  }
  if (!isParagraphUnderBody(storyPart, op.paragraphId)) {
    return fail('tree-invariant', 'paragraph-not-in-body');
  }

  const refLocal = op.noteKind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
  const styleVal = op.noteKind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  // Suggesting proposes the CITATION: the reference run goes through the tracked-insert
  // core, which owns every placement rule typed text follows — the `w:ins` wrapper,
  // extending the author's own pending insertion, adopting the adjacent deletion of a
  // replaced selection, relocating past struck words. The note body stays plain —
  // rejecting the reference sweeps the orphaned body through the same cascade an
  // untracked reference deletion takes.
  if (op.revision) {
    const tracked = applyInsertTrackedRun(
      storyPart,
      storyParagraph as OoxmlParagraphNode,
      op.offset,
      (mint) => noteReferenceRun(mint, refLocal, noteId, styleVal),
      op.revision
    );
    if (!tracked.ok || !tracked.part) {
      // Keep the core's typed reason in the detail — an offset refusal reported as a bare
      // tree-invariant hides the actionable cause from the surface and automation hosts.
      return fail('tree-invariant', (!tracked.ok && tracked.reason) || 'reference-insert');
    }
    next = withPart(next, tracked.part);
  } else {
    const storyNextId = createNodeIdAllocator(storyPart);
    const refRun = noteReferenceRun(storyNextId, refLocal, noteId, styleVal);
    const inserted = insertNodesAtOffset(
      storyPart,
      storyParagraph as OoxmlParagraphNode,
      op.offset,
      [refRun]
    );
    if (!inserted) return fail('tree-invariant', 'reference-insert');
    next = withPart(next, inserted);
  }

  return {
    ok: true,
    package: next,
    impact: 'global',
    noteId,
    noteKind: op.noteKind,
    ...(createdPartName ? { createdPartName } : {}),
  };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

function applyDeleteNote(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'deleteNote' }>,
  options?: NoteLifecycleOptions
): NoteLifecycleResult {
  if (!isNoteKind(op.noteKind)) return fail('invalidArgs', 'noteKind');
  // Reserved non-positive ids own separators/continuation notices, not user notes.
  if (!isPositiveNoteId(op.noteId)) return fail('invalidArgs', 'noteId');

  const notesPart = resolveNotesPart(pkg, op.noteKind);
  if (!notesPart) return fail('invalidArgs', 'missing-notes-part');
  const note = findNoteById(notesPart.root, op.noteId);
  if (!note) return fail('invalidArgs', 'note-not-found');

  const removedRefs = removeReferencesEverywhere(pkg, op.noteKind, op.noteId, options?.scanBudget);
  if (!removedRefs) return fail('tree-invariant', 'reference-scan-truncated');
  let next = removedRefs;

  const currentNotes = resolveNotesPart(next, op.noteKind);
  if (!currentNotes) return fail('tree-invariant', 'notes-part-lost');
  const currentNote = findNoteById(currentNotes.root, op.noteId);
  if (!currentNote) {
    // Body already gone (e.g. only refs); still success if refs removed.
    return { ok: true, package: next, impact: 'global', noteId: op.noteId, noteKind: op.noteKind };
  }
  const removed = removeNode(currentNotes, currentNote.id);
  if (!removed.ok) return fail('tree-invariant', 'note-body-remove');
  next = withPart(next, removed.part);

  return {
    ok: true,
    package: next,
    impact: 'global',
    noteId: op.noteId,
    noteKind: op.noteKind,
  };
}

/**
 * How deleting text cascades into the notes it referenced.
 *
 * A note's body and the citation reaching it are one thing to a reader, so removing the reference
 * must remove the body too or the notes part keeps an entry nothing points at.
 */
export interface CascadeDeletedNoteReferencesOptions {
  /**
   * Independent full budgets per snapshot. When omitted each snapshot gets its own
   * default budget — never share one counter across before/after walks.
   */
  readonly beforeBudget?: NoteReferenceScanBudget;
  readonly afterBudget?: NoteReferenceScanBudget;
}

/**
 * Remove note bodies for references that disappeared between two package snapshots.
 * Used when `deleteText` or `deleteBlock` removes a `noteReference` atom so body+ref stay
 * one undo unit.
 *
 * Each snapshot gets an independent full visited/part budget. If either scan truncates
 * the cascade fails closed so a hostile package cannot skip body deletion silently —
 * without accidentally halving capacity by charging both walks to one counter.
 */
export function cascadeDeletedNoteReferences(
  before: OoxmlPackage,
  after: OoxmlPackage,
  options?: CascadeDeletedNoteReferencesOptions
): OoxmlPackage | null {
  const beforeBudget = options?.beforeBudget ?? createMutationScanBudget();
  const afterBudget = options?.afterBudget ?? createMutationScanBudget();
  const beforeHits = collectPackageNoteReferences(before, {
    budget: beforeBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  const afterHits = collectPackageNoteReferences(after, {
    budget: afterBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  if (beforeBudget.truncated || afterBudget.truncated) return null;
  const afterKeys = new Set(afterHits.map((hit) => `${hit.noteKind}:${hit.noteId}`));
  let next: OoxmlPackage = after;
  const seen = new Set<string>();
  for (const hit of beforeHits) {
    const key = `${hit.noteKind}:${hit.noteId}`;
    if (afterKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    // Only cascade normal positive ids — never delete separator notes via text delete.
    if (hit.noteId <= 0) continue;
    // A reference whose BODY the package never held has stranded nothing, so there is
    // nothing to cascade. `applyDeleteNote` refuses on a missing part or a missing body, and
    // treating that refusal as a failed cascade rolled the user's edit back: deleting a
    // reference to a note the file does not define made the delete itself impossible.
    const notesPart = resolveNotesPart(next, hit.noteKind);
    if (!notesPart || !findNoteById(notesPart.root, hit.noteId)) continue;
    const result = applyDeleteNote(next, {
      op: 'deleteNote',
      noteKind: hit.noteKind,
      noteId: hit.noteId,
    });
    if (!result.ok) return null;
    next = result.package;
  }
  return next;
}

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

function applyConvertNote(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'convertNote' }>,
  options?: NoteLifecycleOptions,
  prescanned?: readonly NoteReferenceHit[]
): NoteLifecycleResult {
  if (!isNoteKind(op.fromKind)) return fail('invalidArgs', 'fromKind');
  if (!isPositiveNoteId(op.noteId)) return fail('invalidArgs', 'noteId');

  const toKind: NoteKind = op.fromKind === 'footnote' ? 'endnote' : 'footnote';
  const sourcePart = resolveNotesPart(pkg, op.fromKind);
  if (!sourcePart) return fail('invalidArgs', 'missing-source-part');
  const sourceNote = findNoteById(sourcePart.root, op.noteId);
  if (!sourceNote) return fail('invalidArgs', 'note-not-found');
  const type = noteTypeOf(sourceNote);
  if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') {
    return fail('invalidArgs', 'separator-not-convertible');
  }

  // Scan-before-mutate: refuse before any package write if refs cannot be fully walked.
  const plannedHits = plannedReferenceHits(pkg, op.fromKind, op.noteId, options, prescanned);
  if (!plannedHits) return fail('tree-invariant', 'reference-scan-truncated');

  let next = pkg;
  const ensured = ensureNotesPart(next, toKind);
  if (!ensured.ok) return ensured;
  next = ensured.package;
  const createdPartName = ensured.createdPartName;

  const targetPart = resolveNotesPart(next, toKind);
  if (!targetPart) return fail('tree-invariant', 'missing-target-part');
  const newId = allocateNoteId(targetPart.root);
  if (newId === null) return fail('invalidArgs', 'note-id-exhausted');

  // Fresh copy into target part with rewritten localName + id.
  const targetNextId = createNodeIdAllocator(targetPart);
  const moved = bindMissingPrefixes(
    rewriteNoteNode(sourceNote, op.fromKind, toKind, newId, targetNextId),
    namespaceBindingsAt(targetPart, targetPart.root)
  );
  const appended = insertChildren(targetPart, targetPart.root.id, targetPart.root.children.length, [
    moved,
  ]);
  if (!appended.ok) return fail('tree-invariant', 'target-insert');
  next = withPart(next, appended.part);

  // Remove from source.
  const sourceNow = resolveNotesPart(next, op.fromKind);
  if (!sourceNow) return fail('tree-invariant', 'source-lost');
  const stillThere = findNoteById(sourceNow.root, op.noteId);
  if (stillThere) {
    const removed = removeNode(sourceNow, stillThere.id);
    if (!removed.ok) return fail('tree-invariant', 'source-remove');
    next = withPart(next, removed.part);
  }

  // Rewrite every previously planned reference of the old kind/id to the new kind/id.
  const rewritten = rewriteReferencesEverywhere(next, op.fromKind, toKind, newId, plannedHits);
  if (!rewritten) return fail('tree-invariant', 'reference-rewrite');
  next = rewritten;

  return {
    ok: true,
    package: next,
    impact: 'global',
    noteId: newId,
    noteKind: toKind,
    ...(createdPartName ? { createdPartName } : {}),
  };
}

function plannedReferenceHits(
  pkg: OoxmlPackage,
  fromKind: NoteKind,
  noteId: number,
  options?: NoteLifecycleOptions,
  prescanned?: readonly NoteReferenceHit[]
): readonly NoteReferenceHit[] | null {
  const matches = (hit: NoteReferenceHit): boolean =>
    hit.noteKind === fromKind && hit.noteId === noteId;
  if (prescanned) {
    const reused = prescanned.filter(matches);
    if (reused.every((hit) => referenceStillResolves(pkg, hit))) return reused;
  }
  const budget = options?.scanBudget ?? createMutationScanBudget();
  const hits = collectPackageNoteReferences(pkg, {
    budget,
    maxHits: Number.POSITIVE_INFINITY,
  }).filter(matches);
  return budget.truncated ? null : hits;
}

function referenceStillResolves(pkg: OoxmlPackage, hit: NoteReferenceHit): boolean {
  const part = pkg.parts.get(hit.partName);
  return part !== undefined && findNode(part, hit.nodeId) !== null;
}

function applyConvertAllNotes(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'convertAllNotes' }>,
  options?: NoteLifecycleOptions
): NoteLifecycleResult {
  if (!isNoteKind(op.fromKind)) return fail('invalidArgs', 'fromKind');
  const sourcePart = resolveNotesPart(pkg, op.fromKind);
  if (!sourcePart) {
    // Nothing to convert — idempotent success (matches empty convert-all UI).
    return { ok: true, package: pkg, impact: 'global' };
  }
  const ids = normalNoteIds(sourcePart);
  if (ids.length === 0) {
    return { ok: true, package: pkg, impact: 'global' };
  }

  const scanBudget = options?.scanBudget ?? createMutationScanBudget();
  const prescanned = collectPackageNoteReferences(pkg, {
    budget: scanBudget,
    maxHits: Number.POSITIVE_INFINITY,
  });
  if (scanBudget.truncated) return fail('tree-invariant', 'reference-scan-truncated');

  let next = pkg;
  let createdPartName: string | undefined;
  let lastNoteId: number | undefined;
  const toKind: NoteKind = op.fromKind === 'footnote' ? 'endnote' : 'footnote';
  for (const noteId of ids) {
    const result = applyConvertNote(
      next,
      {
        op: 'convertNote',
        fromKind: op.fromKind,
        noteId,
      },
      undefined,
      prescanned
    );
    if (!result.ok) return result;
    next = result.package;
    if (result.createdPartName) createdPartName = result.createdPartName;
    lastNoteId = result.noteId;
  }
  return {
    ok: true,
    package: next,
    impact: 'global',
    ...(lastNoteId !== undefined ? { noteId: lastNoteId, noteKind: toKind } : {}),
    ...(createdPartName ? { createdPartName } : {}),
  };
}

// ---------------------------------------------------------------------------
// setNoteProperties
// ---------------------------------------------------------------------------

function applySetNoteProperties(
  pkg: OoxmlPackage,
  op: Extract<NoteLifecycleOp, { op: 'setNoteProperties' }>
): NoteLifecycleResult {
  if (op.scope !== 'document' && op.scope !== 'section') return fail('invalidArgs', 'scope');
  if (!op.footnote && !op.endnote) return fail('invalidArgs', 'empty');

  if (op.footnote?.position !== undefined && !isLegalFootnotePosition(op.footnote.position)) {
    return fail('invalidArgs', 'footnote-position');
  }
  if (op.endnote?.position !== undefined) {
    if (op.endnote.position === 'pageBottom' || !isLegalEndnotePosition(op.endnote.position)) {
      return fail('invalidArgs', 'endnote-pageBottom');
    }
  }
  for (const side of [op.footnote, op.endnote]) {
    if (!side) continue;
    if (side.numRestart !== undefined && !isLegalNumRestart(side.numRestart)) {
      return fail('invalidArgs', 'numRestart');
    }
    if (
      side.numFmt !== undefined &&
      (typeof side.numFmt !== 'string' || !isValidXmlText(side.numFmt))
    ) {
      return fail('invalidArgs', 'numFmt');
    }
    if (
      side.numStart !== undefined &&
      (!Number.isInteger(side.numStart) || side.numStart < 0 || side.numStart > NOTE_ID_MAX)
    ) {
      return fail('invalidArgs', 'numStart');
    }
  }

  if (op.scope === 'document') {
    const written = writeDocumentNoteProperties(pkg, op);
    if (!written) return fail('tree-invariant', 'settings-write');
    return { ok: true, package: written, impact: 'global' };
  }

  if (op.sectionIndex === undefined || !Number.isInteger(op.sectionIndex) || op.sectionIndex < 0) {
    return fail('invalidArgs', 'sectionIndex');
  }
  if (op.sectionIndex >= MAX_SECTIONS) return fail('invalidArgs', 'sectionIndex');

  const written = writeSectionNoteProperties(pkg, op.sectionIndex, op);
  if (!written) return fail('invalidArgs', 'section-write');
  return { ok: true, package: written, impact: 'global' };
}

// ---------------------------------------------------------------------------
// part creation
// ---------------------------------------------------------------------------

/** Provision a notes part (separator shell, content type, relationship) when absent. */
export function ensureNotesPart(
  pkg: OoxmlPackage,
  noteKind: NoteKind
): NoteLifecycleResult & { createdPartName?: string } {
  const existing = resolveNotesPart(pkg, noteKind);
  if (existing) return { ok: true, package: pkg, impact: 'global' };

  const partName = noteKind === 'footnote' ? '/word/footnotes.xml' : '/word/endnotes.xml';
  const target = noteKind === 'footnote' ? 'footnotes.xml' : 'endnotes.xml';
  const relType = noteKind === 'footnote' ? FOOTNOTES_REL : ENDNOTES_REL;
  const contentType = noteKind === 'footnote' ? FOOTNOTES_CT : ENDNOTES_CT;
  if (pkg.parts.has(partName) || pkg.partBytes.has(partName)) {
    return fail('tree-invariant', 'part-name-collision');
  }

  const empty = emptyNotesPart(partName, contentType, noteKind);
  if (!empty) return fail('tree-invariant', 'empty-notes-part');

  let next = withPart(pkg, empty);
  const rId = freeRelationshipId(next);
  const related = withNotesRelationship(next, rId, relType, target);
  if (!related) return fail('tree-invariant', 'relationship');
  next = related;
  const typed = withContentTypeOverride(next, partName, contentType);
  if (!typed) return fail('tree-invariant', 'content-type');
  next = typed;

  return {
    ok: true,
    package: next,
    impact: 'global',
    createdPartName: partName,
  };
}

function emptyNotesPart(
  partName: string,
  contentType: string,
  noteKind: NoteKind
): OoxmlPart | null {
  const root = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const el = noteKind === 'footnote' ? 'footnote' : 'endnote';
  const xml =
    `<w:${root} xmlns:w="${W}">` +
    `<w:${el} w:type="separator" w:id="-1">` +
    `<w:p><w:r><w:separator/></w:r></w:p>` +
    `</w:${el}>` +
    `<w:${el} w:type="continuationSeparator" w:id="0">` +
    `<w:p><w:r><w:continuationSeparator/></w:r></w:p>` +
    `</w:${el}>` +
    `</w:${root}>`;
  const read = readOoxmlPart(xml, { name: partName, contentType });
  return read.ok ? read.part : null;
}

function emptyNoteXml(noteKind: NoteKind, noteId: number): string {
  const root = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const el = noteKind === 'footnote' ? 'footnote' : 'endnote';
  const ref = noteKind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
  const style = noteKind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  // Engine literals only — noteId is a validated integer.
  return (
    `<w:${root} xmlns:w="${W}">` +
    `<w:${el} w:id="${noteId}">` +
    `<w:p>` +
    `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:${ref}/></w:r>` +
    `<w:r><w:t xml:space="preserve"></w:t></w:r>` +
    `</w:p>` +
    `</w:${el}>` +
    `</w:${root}>`
  );
}

// ---------------------------------------------------------------------------
// reference / paragraph helpers
// ---------------------------------------------------------------------------

/**
 * insertNote may only target a paragraph under the main document's `w:body`.
 * Existing references in headers/footers/notes remain deletable/convertible elsewhere;
 * authoring new citations into those stories is refused atomically.
 */
function locateInsertParagraph(
  pkg: OoxmlPackage,
  paragraphId: string
):
  | { readonly ok: true; readonly partName: string; readonly paragraph: OoxmlParagraphNode }
  | {
      readonly ok: false;
      readonly detail: 'paragraph-not-found' | 'story-not-body' | 'paragraph-not-in-body';
    } {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (main) {
    const inBody = findParagraphUnderBody(main, paragraphId);
    if (inBody) {
      return { ok: true, partName: main.name, paragraph: inBody };
    }
  }

  const budget = createNoteReferenceScanBudget();
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (budget.parts >= budget.maxParts) break;
    budget.parts += 1;
    const node = findNode(part, paragraphId);
    if (node && node.kind === 'paragraph') {
      if (part.name === pkg.mainDocumentPart) {
        return { ok: false, detail: 'paragraph-not-in-body' };
      }
      return { ok: false, detail: 'story-not-body' };
    }
  }
  return { ok: false, detail: 'paragraph-not-found' };
}

function findBodyElement(part: OoxmlPart): OoxmlNode | null {
  for (const child of part.root.children) {
    if (child.kind === 'body') return child;
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'body'
    ) {
      return child;
    }
  }
  return null;
}

function findParagraphUnderBody(part: OoxmlPart, paragraphId: string): OoxmlParagraphNode | null {
  const body = findBodyElement(part);
  if (!body) return null;
  return findParagraphInSubtree(body, paragraphId, 0);
}

function isParagraphUnderBody(part: OoxmlPart, paragraphId: string): boolean {
  return findParagraphUnderBody(part, paragraphId) !== null;
}

function findParagraphInSubtree(
  node: OoxmlNode,
  paragraphId: string,
  depth: number
): OoxmlParagraphNode | null {
  if (depth > 64) return null;
  if (node.kind === 'paragraph' && node.id === paragraphId) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findParagraphInSubtree(child, paragraphId, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * UTF-16 length in the SHARED offset model, from the MEMOIZED index.
 *
 * This module used to keep a private mirror of `segmentsOf`, and the mirror disagreed with
 * the authority on the shapes suggesting mode writes: it counted a revision wrapper's runs
 * as nothing, so a citation aimed at a caret after tracked content validated against a
 * shorter paragraph and landed characters to the left of where the reader put it.
 */
function paragraphLength(paragraph: OoxmlParagraphNode): number {
  return paragraphOffsetIndex(paragraph).length;
}

function noteReferenceRun(
  nextId: () => string,
  localName: 'footnoteReference' | 'endnoteReference',
  noteId: number,
  styleVal: string
): OoxmlNode {
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: W,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      {
        id: nextId(),
        kind: 'runProperties',
        namespaceUri: W,
        localName: 'rPr',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [
          {
            id: nextId(),
            kind: 'generic',
            namespaceUri: W,
            localName: 'rStyle',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [
              {
                kind: 'wmlVal',
                namespaceUri: W,
                localName: 'val',
                prefix: 'w',
                value: styleVal,
              },
            ],
            children: [],
          },
        ],
      },
      {
        id: nextId(),
        kind: 'noteReference',
        namespaceUri: W,
        localName,
        prefix: 'w',
        namespaceBindings: [],
        attributes: [
          {
            kind: 'genericExtension',
            namespaceUri: W,
            localName: 'id',
            prefix: 'w',
            value: String(noteId),
          },
        ],
        children: [],
      },
    ],
  } as unknown as OoxmlNode;
}

/** Index of the paragraph child whose subtree holds `nodeId`, or -1. */
function topChildIndexOf(paragraph: OoxmlParagraphNode, nodeId: string): number {
  const holds = (node: OoxmlNode): boolean => {
    if (node.id === nodeId) return true;
    if (node.kind === 'textValue') return false;
    return node.children.some(holds);
  };
  return paragraph.children.findIndex((child) => holds(child));
}

function insertNodesAtOffset(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  nodes: readonly OoxmlNode[]
): OoxmlPart | null {
  // Note references are authored as whole runs — always insert at paragraph child level.
  // Offsets come from the memoized paragraph offset index — the SAME authority the caret
  // uses — so a caret placed after tracked content addresses the position this write
  // resolves, and the validation walk above is not repeated.
  const offsets = paragraphOffsetIndex(paragraph);
  const segments = offsets.segments;
  const nextId = createNodeIdAllocator(part);
  const length = offsets.length;

  // Inside a text value: split the owning run, then place the note run between the halves.
  for (const segment of segments) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const value = segment.node.value;
    const textParent = findTextParent(paragraph, segment.node.id);
    if (!textParent) return null;
    const run = findNode(part, segment.runId);
    if (!run || run.kind !== 'run') return null;
    // Refuse a split the citation must not host; the caller degrades to a rejection, never
    // to a silently misplaced reference.
    const splitParent = citationSplitParent(paragraph, run.id);
    if (!splitParent) return null;

    const halves = splitRunAroundText(
      run,
      textParent.id,
      textElement(nextId, value.slice(0, local)),
      textElement(nextId, value.slice(local)),
      nextId
    );
    if (!halves?.head || !halves.tail) return null;
    const rebuilt = splitParent.children.flatMap((child) =>
      child.id === run.id ? [halves.head!, ...nodes, halves.tail!] : [child]
    );
    const replaced = replaceChildren(part, splitParent.id, rebuilt);
    return replaced.ok ? replaced.part : null;
  }

  if (offset === 0) {
    const pPr = paragraph.children[0]?.kind === 'paragraphProperties' ? 1 : 0;
    const inserted = insertChildren(part, paragraph.id, pPr, nodes);
    return inserted.ok ? inserted.part : null;
  }

  if (offset >= length) {
    const inserted = insertChildren(part, paragraph.id, paragraph.children.length, nodes);
    return inserted.ok ? inserted.part : null;
  }

  // Boundary between segments: insert before the child holding the segment that starts
  // here. A boundary whose run lives INSIDE a link or wrapper resolves to its TOP-LEVEL
  // ancestor: at the container's leading edge "before the container" and "at the offset"
  // are the same place, and an interior boundary one level down joins the container's own
  // content — a citation mid-link belongs in the link, where the caret is. Deeper nesting
  // is refused rather than misplaced. Matching direct children only was worse still — the
  // boundary fell to the append fallback, at the paragraph's end.
  const boundary = segments.find((segment) => segment.start === offset);
  if (boundary) {
    const anchorId = boundary.runId || boundary.node.id;
    const direct = paragraph.children.findIndex((child) => child.id === anchorId);
    if (direct >= 0) {
      return placeCitationAtRunBoundary(part, paragraph, anchorId, boundary.node.id, nodes, nextId);
    }
    const index = topChildIndexOf(paragraph, anchorId);
    if (index >= 0) {
      const top = paragraph.children[index]!;
      const under = new Set<string>();
      const collect = (node: OoxmlNode): void => {
        under.add(node.id);
        if (node.kind === 'textValue') return;
        for (const child of node.children) collect(child);
      };
      collect(top);
      const containerStart = segments.reduce(
        (min, segment) =>
          under.has(segment.runId) || under.has(segment.node.id)
            ? Math.min(min, segment.start)
            : min,
        Number.POSITIVE_INFINITY
      );
      if (containerStart === offset) {
        const inserted = insertChildren(part, paragraph.id, index, nodes);
        return inserted.ok ? inserted.part : null;
      }
      // Split from the segment child because a shared run id would change the requested offset.
      const precisePath = ancestorPathHolding(top, boundary.node.id);
      if (precisePath) {
        const placed = placeOutsideOutermostRevision(
          part,
          paragraph,
          precisePath,
          boundary.node.id,
          nodes,
          nextId,
          // A control is atomic, so the citation may only sit beside it — which is the
          // requested position exactly when the control's own span starts at this offset.
          (node) => offsets.spanOf(node)?.start === offset
        );
        if (placed !== undefined) return placed;
      }
      const beside = citationBesideControlAt(
        paragraph,
        anchorId,
        (node) => offsets.spanOf(node)?.start === offset
      );
      if (beside) {
        const inserted = insertChildren(part, beside.holder.id, beside.index, nodes);
        return inserted.ok ? inserted.part : null;
      }
      const path = ancestorPathHolding(top, anchorId);
      const parent = path?.at(-1) ?? null;
      if (canHoldNoteCitation(parent, path ?? [])) {
        return placeCitationAtRunBoundary(part, parent, anchorId, boundary.node.id, nodes, nextId);
      }
      return null;
    }
  }

  const inserted = insertChildren(part, paragraph.id, paragraph.children.length, nodes);
  return inserted.ok ? inserted.part : null;
}

function textElement(nextId: () => string, text: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'text',
    namespaceUri: W,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: nextId(), kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

function findTextParent(paragraph: OoxmlParagraphNode, valueId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'text' && node.children.some((child) => child.id === valueId)) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(paragraph);
}

/**
 * Scan every XML part under one shared budget, then remove matching references.
 * Truncation returns null without mutating `pkg`.
 */
function removeReferencesEverywhere(
  pkg: OoxmlPackage,
  noteKind: NoteKind,
  noteId: number,
  sharedBudget?: NoteReferenceScanBudget
): OoxmlPackage | null {
  const budget = sharedBudget ?? createMutationScanBudget();
  const hits = collectPackageNoteReferences(pkg, {
    budget,
    maxHits: Number.POSITIVE_INFINITY,
  }).filter((hit) => hit.noteKind === noteKind && hit.noteId === noteId);
  if (budget.truncated) return null;

  let next = pkg;
  // Apply per part so one story's edits do not invalidate another part's node ids.
  const byPart = new Map<string, string[]>();
  for (const hit of hits) {
    const list = byPart.get(hit.partName) ?? [];
    list.push(hit.nodeId);
    byPart.set(hit.partName, list);
  }
  for (const [partName, nodeIds] of byPart) {
    const current = next.parts.get(partName);
    if (!current) return null;
    let working = current;
    for (const nodeId of nodeIds) {
      if (!findNode(working, nodeId)) continue;
      const parentRun = findOwningRun(working, nodeId);
      const targetId =
        parentRun && runIsNoteReferenceOnly(parentRun, nodeId) ? parentRun.id : nodeId;
      const removed = removeNode(working, targetId);
      if (!removed.ok) return null;
      working = removed.part;
    }
    next = withPart(next, working);
  }
  return next;
}

function findOwningRun(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'run' && node.children.some((child) => child.id === nodeId)) {
      return node;
    }
    for (const child of node.children) stack.push(child);
  }
  return null;
}

function runIsNoteReferenceOnly(run: OoxmlElement, refId: string): boolean {
  for (const child of run.children) {
    if (child.kind === 'runProperties') continue;
    if (child.id === refId) continue;
    return false;
  }
  return true;
}

/**
 * Rewrite previously scanned reference hits. Callers must have already verified the scan
 * completed without truncation against the pre-mutation package.
 */
function rewriteReferencesEverywhere(
  pkg: OoxmlPackage,
  fromKind: NoteKind,
  toKind: NoteKind,
  toId: number,
  plannedHits: readonly { readonly partName: string; readonly nodeId: string }[]
): OoxmlPackage | null {
  let next = pkg;
  const toLocal = toKind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
  const byPart = new Map<string, string[]>();
  for (const hit of plannedHits) {
    const list = byPart.get(hit.partName) ?? [];
    list.push(hit.nodeId);
    byPart.set(hit.partName, list);
  }

  for (const [partName, nodeIds] of byPart) {
    const current = next.parts.get(partName);
    if (!current) return null;
    let working = current;
    for (const nodeId of nodeIds) {
      const node = findNode(working, nodeId);
      if (!node || node.kind === 'textValue') return null;
      const replacedNode: OoxmlNode = {
        ...node,
        kind: 'noteReference',
        localName: toLocal,
        attributes: node.attributes.map((attr) =>
          attr.localName === 'id' &&
          (attr.namespaceUri === WML_NAMESPACE_URI || attr.namespaceUri === '')
            ? { ...attr, value: String(toId) }
            : attr
        ),
      } as OoxmlNode;
      const replaced = replaceNode(working, nodeId, replacedNode);
      if (!replaced.ok) return null;
      working = replaced.part;
      const parentRun = findOwningRun(working, nodeId);
      if (parentRun) {
        const styledRun = rewriteRunBuiltinNoteReferenceStyle(parentRun, fromKind, toKind);
        if (styledRun !== parentRun) {
          const runReplaced = replaceNode(working, parentRun.id, styledRun);
          if (!runReplaced.ok) return null;
          working = runReplaced.part;
        }
      }
    }
    next = withPart(next, working);
  }

  // Defensive: plannedHits may be empty when the note body exists without citations.
  return next;
}

function rewriteNoteNode(
  source: OoxmlNode,
  fromKind: NoteKind,
  toKind: NoteKind,
  newId: number,
  nextId: () => string
): OoxmlNode {
  const localName = toKind === 'footnote' ? 'footnote' : 'endnote';
  const refLocal = toKind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
  const mapNode = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return { ...node, id: nextId() };
    let kind = node.kind;
    let name = node.localName;
    let attributes = node.attributes;
    if (node.id === source.id || (node.kind === 'note' && noteIdOf(node) === noteIdOf(source))) {
      kind = 'note';
      name = localName;
      attributes = node.attributes.map((attr) =>
        attr.localName === 'id' ? { ...attr, value: String(newId) } : attr
      );
      if (!attributes.some((attr) => attr.localName === 'id')) {
        attributes = [
          ...attributes,
          {
            kind: 'genericExtension',
            namespaceUri: W,
            localName: 'id',
            prefix: 'w',
            value: String(newId),
          },
        ];
      }
    } else if (
      node.kind === 'noteRef' ||
      (noteKindOf(node) === null &&
        (node.localName === 'footnoteRef' || node.localName === 'endnoteRef'))
    ) {
      kind = 'noteRef';
      name = refLocal;
    }
    const mappedChildren = node.children.map(mapNode);
    let result = {
      ...node,
      id: nextId(),
      kind,
      localName: name,
      attributes,
      children: mappedChildren,
    } as OoxmlNode;
    if (node.kind === 'run') {
      result = rewriteRunBuiltinNoteReferenceStyle(result, fromKind, toKind);
    }
    return result;
  };
  return mapNode(source);
}
