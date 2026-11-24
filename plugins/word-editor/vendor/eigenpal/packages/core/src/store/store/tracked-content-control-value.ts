// A content control's value, and text at an edge of its content, as TRACKED changes.
//
// A dropdown, combo box, date picker or checkbox shows its value as text and records it in its
// properties (`w:lastValue`, `w:fullDate`, `w14:checked`). Suggesting a new value strikes the
// shown text and inserts the new text inside the control, the same pair typing over a selection
// writes, and moves the recorded state to the new value. Properties have no tracked form, so a
// decision on the pair re-derives the state (`content-control-decision-state.ts`).

import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { contentControlPropertiesOf as readControl } from '../package/content-control-nodes.ts';
import { decodeCheckboxGlyph, isInlineControl } from './content-control-checkbox.ts';
import { resolveRevisions } from './tree-op-revisions.ts';
import {
  applySetContentControlValue as applyStructuredValue,
  contentControlEffect,
  textRun,
} from './tree-op-content-controls.ts';
import { contentControlContentOf, contentControlPropertiesOf, fromEdit } from './tree-op-nodes.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { paragraphLength, paragraphOffsetIndex } from './tree-op-segments.ts';
import { applyDeleteTracked } from './tree-op-tracked-delete.ts';
import { build, copy, insertedRunProperties, revisionAttributes } from './tree-op-tracked.ts';
import { sameEditingMoment } from './tree-op-tracked-adjacency.ts';
import type { RevisionAttributionInput, TreeDocOp, TreeOpResult } from './tree-op-types.ts';

type ValueOp = Extract<TreeDocOp, { op: 'setContentControlValue' }>;
type StringValueWrite = (
  part: OoxmlPart,
  controlId: string,
  value: string,
  options?: EditOptions
) => TreeOpResult;

/**
 * Apply a `setContentControlValue`: written directly, or proposed when it carries a revision.
 * `writeString` is the editor-facing string path; structured values take the automation path.
 */
export function applyContentControlValueOp(
  part: OoxmlPart,
  op: ValueOp,
  options: EditOptions | undefined,
  writeString: StringValueWrite
): TreeOpResult {
  const write = (target: OoxmlPart): TreeOpResult =>
    typeof op.value === 'string'
      ? writeString(target, op.controlId, op.value, options)
      : applyStructuredValue(target, op, options);
  return op.revision
    ? applyTrackedValue(part, op.controlId, op.revision, write, options)
    : write(part);
}

const isElement = (node: OoxmlNode | undefined): node is OoxmlElement =>
  !!node && node.kind !== 'textValue';

/**
 * Where the control's content is edited as text: the paragraph inside a block control with one
 * paragraph, or the control's own content for an inline one. Null for any other shape, which
 * has no single run sequence a strike and an insertion can stand in.
 */
function contentSite(
  part: OoxmlPart,
  control: OoxmlNode
): { container: OoxmlElement; paragraphId: string; start: number; end: number } | null {
  const content = contentControlContentOf(control);
  if (!content) return null;
  if (isInlineControl(part, control.id)) {
    let paragraph = parentNodeOf(part, control.id);
    for (let depth = 0; paragraph && paragraph.kind !== 'paragraph' && depth < 64; depth++)
      paragraph = parentNodeOf(part, paragraph.id);
    if (!paragraph || paragraph.kind !== 'paragraph') return null;
    const span = paragraphOffsetIndex(paragraph).spanOf(control);
    if (!span) return null;
    return { container: content, paragraphId: paragraph.id, start: span.start, end: span.end };
  }
  const blocks = content.children.filter(isElement);
  const only = blocks[0];
  if (blocks.length !== 1 || only?.kind !== 'paragraph') return null;
  return { container: only, paragraphId: only.id, start: 0, end: paragraphLength(only) };
}

/**
 * The runs a written value put in the control: what the tracked insertion carries. A direct
 * write keeps struck text it found, which the strike already holds, so only live runs count.
 */
function writtenRuns(part: OoxmlPart, control: OoxmlNode): readonly OoxmlNode[] | null {
  const site = contentSite(part, control);
  if (!site) return null;
  const live = (nodes: readonly OoxmlNode[]): OoxmlNode[] =>
    nodes.flatMap((child) => {
      if (child.kind === 'paragraphProperties' || child.kind === 'textValue') return [];
      if (child.kind === 'revisionDelete' || child.kind === 'revisionMoveFrom') return [];
      if (child.kind === 'revisionInsert' || child.kind === 'revisionMoveTo')
        return live(child.children);
      return [child];
    });
  return live(site.container.children);
}

function idsUnder(node: OoxmlNode, into = new Set<string>()): Set<string> {
  into.add(node.id);
  if (node.kind !== 'textValue') for (const child of node.children) idsUnder(child, into);
  return into;
}

/**
 * The written properties, with every node the old properties already held keeping its id.
 * Collaboration addresses a control's properties by those ids, and a fresh id on an unchanged
 * list item reads there as a node it never saw. Only nodes the write added take a new one.
 */
function keepingIds(node: OoxmlNode, known: ReadonlySet<string>, mint: () => string): OoxmlNode {
  const id = known.has(node.id) ? node.id : mint();
  if (node.kind === 'textValue') return { ...node, id };
  return {
    ...node,
    id,
    children: node.children.map((child) => keepingIds(child, known, mint)),
  } as OoxmlNode;
}

/** The text under `nodes`: as it reads before its changes when `original`, else as proposed. */
function textOf(nodes: readonly OoxmlNode[], original: boolean): string {
  let text = '';
  for (const node of nodes) {
    if (node.kind === 'textValue') continue;
    if (node.kind === (original ? 'revisionInsert' : 'revisionDelete')) continue;
    if (node.localName === 't' || node.localName === 'delText')
      text += node.children
        .map((child) => (child.kind === 'textValue' ? child.value : ''))
        .join('');
    else if (node.localName === 'sym') text += decodeCheckboxGlyph(attributeOf(node, 'char')) ?? '';
    else if (node.localName === 'tab') text += '\t';
    else text += textOf(node.children, original);
  }
  return text;
}

/**
 * Choosing again the value the control showed before the author's own pending choice takes
 * that choice back rather than proposing the same value over itself. Toggling a checkbox twice
 * otherwise left a struck box and an inserted box that change nothing. Null when the control
 * holds anyone else's change, or the value differs.
 */
function withdrawnProposal(
  part: OoxmlPart,
  control: OoxmlNode,
  runs: readonly OoxmlNode[],
  revision: RevisionAttributionInput,
  options: EditOptions | undefined
): TreeOpResult | null {
  const site = contentSite(part, control);
  if (!site) return null;
  const wrappers: OoxmlElement[] = [];
  const collect = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'revisionInsert' || node.kind === 'revisionDelete') wrappers.push(node);
    for (const child of node.children) collect(child, depth + 1);
  };
  collect(site.container, 0);
  if (wrappers.length === 0) return null;
  if (wrappers.some((wrapper) => attributeOf(wrapper, 'author') !== revision.author)) return null;
  if (textOf(site.container.children, true) !== textOf(runs, false)) return null;
  const resolved = resolveRevisions(part, 'reject', undefined, {
    ...options,
    siteNodeIds: wrappers.map((wrapper) => wrapper.id),
  });
  if (!resolved.ok || !resolved.part) return null;
  return {
    ok: true,
    part: resolved.part,
    effect: contentControlEffect(control.id, 'flow-structural'),
  };
}

function applyTrackedValue(
  part: OoxmlPart,
  controlId: string,
  revision: RevisionAttributionInput,
  write: (target: OoxmlPart) => TreeOpResult,
  options: EditOptions | undefined
): TreeOpResult {
  const control = findNode(part, controlId);
  if (!control || control.kind !== 'contentControl')
    return { ok: false, reason: 'unknown-content-control' };
  const before = readControl(control);
  // A temporary control removes itself once written, so there is no control left to hold
  // the proposal.
  if (before.temporary) return { ok: false, reason: 'unsupported' };
  // The direct write is the single source of the new value and its validation: the proposal
  // takes its runs and its properties, and refuses whatever it refuses.
  const written = write(part);
  if (!written.ok) return written;
  const target = findNode(written.part, controlId);
  const runs = target && writtenRuns(written.part, target);
  const nextProperties = target && contentControlPropertiesOf(target);
  if (!target || !runs || !nextProperties || !contentSite(part, control))
    return { ok: false, reason: 'unsupported' };
  const withdrawn = withdrawnProposal(part, control, runs, revision, options);
  if (withdrawn) return withdrawn;

  // Strike what the control shows, a prompt included. Dropping the prompt left a rejection
  // nothing to restore, so the control came back empty; struck, it comes back exactly as it
  // was, and the decision shows it as the prompt again (`content-control-decision-state.ts`).
  let current = part;
  const site = contentSite(part, control)!;
  if (site.end > site.start) {
    const paragraph = findNode(current, site.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return { ok: false, reason: 'unsupported' };
    const struck = applyDeleteTracked(current, paragraph, site.start, site.end, revision, options);
    if (!struck.ok) return struck;
    current = struck.part;
  }
  const struckControl = findNode(current, controlId);
  const after = struckControl && contentSite(current, struckControl);
  if (!struckControl || !after) return { ok: false, reason: 'unsupported' };

  const mint = createNodeIdAllocator(current);
  const id = options?.trackedRevisionIds?.mint() ?? nextRevisionId(current)();
  const insertion = build(
    mint(),
    'revisionInsert',
    'ins',
    revisionAttributes(id, revision),
    runs.map((run) => copy(mint, run))
  );
  const inserted = replaceChildren(
    current,
    after.container.id,
    [...after.container.children, insertion],
    options
  );
  if (!inserted.ok) return fromEdit(inserted, contentControlEffect(controlId, 'flow-structural'));
  const oldProperties = contentControlPropertiesOf(findNode(inserted.part, controlId)!);
  if (!oldProperties) return { ok: false, reason: 'unsupported' };
  return fromEdit(
    replaceNode(
      inserted.part,
      oldProperties.id,
      keepingIds(nextProperties, idsUnder(oldProperties), mint),
      options
    ),
    contentControlEffect(controlId, 'flow-structural')
  );
}

/** The first or last run under `nodes`, looking through wrappers, for the face text takes. */
function edgeRun(nodes: readonly OoxmlNode[], last: boolean): OoxmlNode | null {
  for (const node of last ? [...nodes].reverse() : nodes) {
    if (node.kind === 'textValue' || node.kind === 'paragraphProperties') continue;
    if (node.kind === 'run') return node;
    const found = edgeRun(node.children, last);
    if (found) return found;
  }
  return null;
}

const attributeOf = (node: OoxmlElement, localName: string) =>
  node.attributes.find((attribute) => attribute.localName === localName)?.value;

/**
 * Tracked text at the start or end of a control's content, placed INSIDE the control. The
 * general placement gives a boundary offset to the run beside the control, so text meant for
 * the field landed next to it. Null for any other offset, which that placement already puts in
 * the control.
 */
export function trackedTextAtControlEdge(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: Extract<TreeDocOp, { op: 'insertText' }>,
  options: EditOptions | undefined
): TreeOpResult | null {
  const control = op.inside === undefined ? null : findNode(part, op.inside);
  if (!control || control.kind !== 'contentControl' || !op.revision) return null;
  if (readControl(control).showingPlaceholder) return null;
  const site = contentSite(part, control);
  if (!site || site.paragraphId !== paragraph.id) return null;
  const atEnd = op.offset === site.end;
  if (!atEnd && op.offset !== site.start) return null;
  const children = site.container.children;
  const mint = createNodeIdAllocator(part);
  const face = edgeRun(children, atEnd);
  const properties = face ? insertedRunProperties(mint, face)[0] : undefined;
  const run = textRun(mint, op.text, properties);
  const neighbour = atEnd
    ? children[children.length - 1]
    : children.find((child) => child.kind !== 'paragraphProperties');
  // Typing on at the edge of your own insertion from a moment ago extends it.
  const extend =
    isElement(neighbour) &&
    neighbour.kind === 'revisionInsert' &&
    attributeOf(neighbour, 'author') === op.revision.author &&
    sameEditingMoment(attributeOf(neighbour, 'date'), op.revision.date);
  const placed: OoxmlNode = extend
    ? ({
        ...neighbour,
        children: atEnd ? [...neighbour.children, run] : [run, ...neighbour.children],
      } as OoxmlNode)
    : build(
        mint(),
        'revisionInsert',
        'ins',
        revisionAttributes(
          options?.trackedRevisionIds?.mint() ?? nextRevisionId(part)(),
          op.revision
        ),
        [run]
      );
  const next = extend
    ? children.map((child) => (child === neighbour ? placed : child))
    : atEnd
      ? [...children, placed]
      : [
          ...children.filter((child) => child.kind === 'paragraphProperties'),
          placed,
          ...children.filter((child) => child.kind !== 'paragraphProperties'),
        ];
  return fromEdit(
    replaceChildren(part, site.container.id, next, options),
    contentControlEffect(paragraph.id, 'text-local')
  );
}
