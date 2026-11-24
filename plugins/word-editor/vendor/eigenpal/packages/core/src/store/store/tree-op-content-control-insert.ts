// Authoring a NEW content control (store lane).
//
// Two shapes, one op. A range becomes a WRAPPER around the characters that are already
// there; a caret becomes an EMPTY control showing its type's prompt, which is what Word's
// Developer tab inserts when nothing is selected. Both are one transaction and one undo
// step, and both leave every other node in the paragraph where it was.
//
// Split out of `tree-op-content-controls.ts` so the insertion paths have room to be read
// side by side rather than to fit under a line cap.

import {
  allocateContentControlId,
  lockForbidsEdit,
  orderedContentControlProperties,
} from '../package/content-control-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { splitRunsAt } from './tree-op-apply.ts';
import {
  cloneWithFreshIds,
  contentControlEffect,
  contentControlLockAt,
  editedProperties,
  promptFor,
  textRun,
  wmlElement,
  type InsertableContentControlKind,
} from './tree-op-content-controls.ts';
import { fromEdit, isParagraphPropertiesNode, runPropertiesNodeOf } from './tree-op-nodes.ts';
import {
  indivisibleAt,
  paragraphLength,
  paragraphOffsetIndex,
  splitsSurrogate,
  type OffsetSpan,
  type ParagraphOffsetIndex,
} from './tree-op-segments.ts';
import type { TreeDocOp, TreeOpResult } from './tree-op-types.ts';

/** The ECMA-376 `CT_SdtPr` type element each insertable kind writes. */
const TYPE_ELEMENT_FOR: Readonly<Record<InsertableContentControlKind, string>> = {
  richText: 'richText',
  plainText: 'text',
  dropDownList: 'dropDownList',
  comboBox: 'comboBox',
  date: 'date',
};

type InsertOp = Extract<TreeDocOp, { op: 'insertContentControl' }>;

/** `w:sdtPr` + the type element, in schema order, with the op's metadata on it. */
export function propertiesFor(part: OoxmlPart, op: InsertOp, nextId: () => string): OoxmlElement {
  // Inside the store transaction, so the collaboration actor is already bound. A second
  // local max+1 here would ignore that bind and collide the moment two peers insert.
  const allocated = allocateContentControlId(part.root);
  const properties = editedProperties(
    undefined,
    {
      ...(op.tag === undefined ? {} : { tag: op.tag }),
      ...(op.alias === undefined ? {} : { alias: op.alias }),
      ...(allocated === null ? {} : { id: allocated }),
      ...(op.lock === undefined ? {} : { lock: op.lock }),
      // A wrapper holds content the caller chose, so it shows no prompt; an empty control
      // holds nothing but one, and the flag is what makes the first keystroke replace it
      // whole rather than append to it.
      ...(op.start === op.end ? { showingPlaceholder: true } : {}),
    },
    nextId
  );
  const typed = wmlElement(nextId, TYPE_ELEMENT_FOR[op.type]);
  return {
    ...properties,
    children: orderedContentControlProperties([...properties.children, typed]),
  } as OoxmlElement;
}

export function controlElement(
  properties: OoxmlElement,
  content: readonly OoxmlNode[],
  nextId: () => string
): OoxmlElement {
  const wrapped = wmlElement(nextId, 'sdtContent', {
    kind: 'contentControlContent' as OoxmlNode['kind'],
    children: content,
  });
  return wmlElement(nextId, 'sdt', {
    kind: 'contentControl' as OoxmlNode['kind'],
    children: [properties, wrapped],
  });
}

export function applyInsertContentControl(
  part: OoxmlPart,
  op: InsertOp,
  options?: EditOptions
): TreeOpResult {
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return { ok: false, reason: 'unknown-paragraph' };
  if (paragraph.kind !== 'paragraph') return { ok: false, reason: 'not-a-paragraph' };
  if (lockForbidsEdit(contentControlLockAt(part, op.paragraphId))) {
    return { ok: false, reason: 'locked' };
  }

  // `start === end` is a CARET, not an empty range: it authors the prompt-showing control
  // Word's Developer tab inserts with nothing selected. Refusing it here is what forced a
  // host to select a character first and then delete it, which is two undo steps and a
  // document edit nobody asked for.
  if (op.start < 0 || op.end > paragraphLength(paragraph) || op.start > op.end) {
    return { ok: false, reason: 'invalid-range' };
  }
  if (splitsSurrogate(paragraph, op.start) || splitsSurrogate(paragraph, op.end)) {
    return { ok: false, reason: 'splits-surrogate-pair' };
  }
  // `validateTreeOp` answers this too, which is what lets `can` predict the refusal. Repeated
  // here because the applier is reachable on its own and must fail closed rather than emit the
  // control beside the container the caller pointed into.
  if (indivisibleAt(paragraph, op.start) || indivisibleAt(paragraph, op.end)) {
    return { ok: false, reason: 'indivisible-content' };
  }
  return op.start === op.end
    ? insertEmptyContentControl(part, paragraph, op, options)
    : wrapRangeInContentControl(part, op, options);
}

/**
 * Wrap `[start, end)` in a new control.
 *
 * A control is a SIBLING of runs, never a thing inside one, so a range ending mid-run splits
 * that run at both edges first. The characters and their formatting are the ones that were
 * there; only the run boundaries move.
 */
function wrapRangeInContentControl(
  part: OoxmlPart,
  op: InsertOp,
  options?: EditOptions
): TreeOpResult {
  let current = part;
  for (const edge of [op.end, op.start]) {
    const target = findNode(current, op.paragraphId);
    if (!target || target.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
    const split = splitRunsAt(current, target, edge, options);
    if (!split.ok) return { ok: false, reason: split.reason };
    current = split.part;
  }

  const reloaded = findNode(current, op.paragraphId);
  if (!reloaded || reloaded.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };
  const index = paragraphOffsetIndex(reloaded);
  const wrapped: OoxmlNode[] = [];
  let covered = false;
  for (const child of reloaded.children) {
    const span = index.spanOf(child);
    if (!span || span.start === span.end) continue;
    if (span.start >= op.start && span.end <= op.end) {
      wrapped.push(child);
      covered = true;
      continue;
    }
    if (span.start < op.end && span.end > op.start) return { ok: false, reason: 'invalid-range' };
  }
  if (!covered) return { ok: false, reason: 'invalid-range' };

  const nextId = createNodeIdAllocator(current);
  const control = controlElement(propertiesFor(current, op, nextId), wrapped, nextId);

  const wrappedIds = new Set(wrapped.map((child) => child.id));
  let placed = false;
  const children: OoxmlNode[] = [];
  for (const child of reloaded.children) {
    if (!wrappedIds.has(child.id)) {
      children.push(child);
      continue;
    }
    if (!placed) {
      children.push(control);
      placed = true;
    }
  }
  return fromEdit(
    replaceChildren(current, reloaded.id, children, options),
    contentControlEffect(reloaded.id, 'flow-structural')
  );
}

/**
 * The `w:rPr` the prompt run inherits: the run on the LEFT of the caret, falling back to the
 * one on the right at paragraph start.
 *
 * The same rule the inline custom-node insert follows, for the same reason — a field dropped
 * into a heading must not come out body-sized.
 */
function inheritedRunProperties(
  part: OoxmlPart,
  index: ParagraphOffsetIndex,
  offset: number,
  nextId: () => string
): OoxmlNode | undefined {
  const segments = index.segments;
  let anchor = null as (typeof segments)[number] | null;
  for (const segment of segments) {
    if (segment.end <= offset && segment.end > 0) anchor = segment;
  }
  anchor ??= segments.find((segment) => segment.start >= offset) ?? null;
  const run = anchor ? findNode(part, anchor.runId) : null;
  const properties = run && run.kind === 'run' ? runPropertiesNodeOf(run) : null;
  return properties ? cloneWithFreshIds(properties, nextId) : undefined;
}

/**
 * The span of the ATOM a paragraph child belongs to, for the chrome an atom is spelt with.
 *
 * `removeNodeIds` names the elements — `w:fldChar`, `w:instrText` — rather than the runs
 * holding them, so a paragraph child is matched by itself or by what it holds. One level is
 * enough: field chrome is a run wrapping exactly one of those elements.
 */
function atomSpanLookup(index: ParagraphOffsetIndex): (child: OoxmlNode) => OffsetSpan | null {
  const byNodeId = new Map<string, OffsetSpan>();
  for (const segment of index.segments) {
    if (!segment.removeNodeIds) continue;
    const span = { start: segment.start, end: segment.end };
    for (const id of segment.removeNodeIds) byNodeId.set(id, span);
  }
  if (byNodeId.size === 0) return () => null;
  return (child) => {
    const own = byNodeId.get(child.id);
    if (own) return own;
    if (child.kind === 'textValue') return null;
    for (const inner of child.children) {
      const found = byNodeId.get(inner.id);
      if (found) return found;
    }
    return null;
  };
}

/**
 * Insert an EMPTY control at a caret, holding its type's prompt.
 *
 * Word's own gesture: the control arrives showing "Click here to enter text." with
 * `w:showingPlcHdr` set, so the first character typed replaces the prompt whole. That
 * transition already exists in the applier for `insertText`; this is the other end of it.
 */
function insertEmptyContentControl(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: InsertOp,
  options?: EditOptions
): TreeOpResult {
  const offset = op.start;
  const split = splitRunsAt(part, paragraph, offset, options);
  if (!split.ok) return { ok: false, reason: split.reason };
  const current = split.part;
  const reloaded = findNode(current, op.paragraphId);
  if (!reloaded || reloaded.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };

  const index = paragraphOffsetIndex(reloaded);
  const nextId = createNodeIdAllocator(current);
  const prompt = textRun(
    nextId,
    promptFor(op.type),
    inheritedRunProperties(current, index, offset, nextId)
  );
  const control = controlElement(propertiesFor(current, op, nextId), [prompt], nextId);

  // Nothing straddles the offset: the run was split, and `indivisibleAt` already refused an
  // offset inside anything a split cannot divide. So each child lands whole on one side.
  //
  // A field's chrome — its instruction, its separator, its end marker — sits at ZERO LENGTH at
  // the field's own offset, because the field is one addressable unit and its begin run carries
  // the whole of it. A running cursor alone would therefore leave all of that chrome on the far
  // side of a caret at the field's trailing edge, putting the new control between
  // `w:fldChar begin` and the instruction it belongs to. The offset model already records which
  // nodes spell one atom, so the ATOM's span answers for each of them instead.
  const atomSpanOf = atomSpanLookup(index);

  const before: OoxmlNode[] = [];
  const after: OoxmlNode[] = [];
  let cursor = 0;
  for (const child of reloaded.children) {
    if (isParagraphPropertiesNode(child)) {
      before.push(child);
      continue;
    }
    const own = index.spanOf(child);
    const span = own && own.start !== own.end ? own : (atomSpanOf(child) ?? own);
    // A truly zero-length node — a bookmark, a comment marker — takes the bucket its POSITION
    // puts it in, exactly as the inline insert divides them.
    if (!span || span.start === span.end) {
      (cursor < offset ? before : after).push(child);
      continue;
    }
    cursor = span.end;
    (span.end <= offset ? before : after).push(child);
  }

  return fromEdit(
    replaceChildren(current, reloaded.id, [...before, control, ...after], options),
    contentControlEffect(reloaded.id, 'flow-structural')
  );
}
