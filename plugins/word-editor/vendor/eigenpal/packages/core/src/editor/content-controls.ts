import { documentProtectionRefusal } from '../store/store/forms-protection.ts';
import { formsProtectionRefusal } from '../store/store/tree-op-content-controls.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
// Content-control query derivation for the Editor facade.
//
// Projects typed `w:sdt` nodes — and generic WML `sdt` fallbacks until the canonical model
// lands — into `ContentControlSummary` values. Foreign-namespace `<x:sdt>` elements stay
// opaque and are never enumerated. `contentControls` lists every Word control in reading
// order; `contentControlAt` resolves the innermost control at the caret using inline UTF-16
// ranges first (half-open `[start, end)` affinity), then block-ancestor fallback.

import type {
  CanResult,
  DocTarget,
  DocumentEditingMode,
  EditorScope,
  ExecErrorCode,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import type { ContentControlFilter, ContentControlType } from '../contracts/types.ts';
import type { ContentControlSummary } from '../contracts/document.ts';
import type { DocAnchor, DocLocation, DocRange } from '../contracts/types.ts';
import {
  WML_NAMESPACE_URI,
  contentControlContentChildren,
  contentControlsIn,
  findNode,
  isContentControl,
  parentNodeOf,
  validateTreeOp,
  type ContentControlEntry,
  type OoxmlContentControlNode,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
  type OoxmlPart,
  type SelectionMark,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { isInlineRunContainer, MAX_INLINE_CONTAINER_DEPTH } from '../store/package/ooxml-shared.ts';
import { paragraphInlineLengthOf } from '../store/store/tree-op-segments.ts';
import type { TreeApplyResult, TreeDocxSessionView } from '../binding/tree-session.ts';
import type { ParagraphAnchorIndex } from '../binding/paragraph-anchors.ts';
import { isDocAnchor, resolveDocAnchor } from './anchor-resolution.ts';
import {
  cachedContentControlSummaries,
  noteContentControlEnumerationControlVisits,
  noteContentControlEnumerationTopLevelVisit,
} from './content-control-enumeration-cache.ts';
import {
  resolveContentControlInsertion,
  type InsertContentControlCommand,
  type InsertResolution,
} from './content-control-insert.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';
import { selectionMarkOf } from './surface-selection-ops.ts';

const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

type ContentControlLike = OoxmlContentControlNode | OoxmlGenericElementNode;

/** Shared walk predicate — WML namespace required for generic `sdt` fallback. */
function isContentControlNode(node: OoxmlNode): node is ContentControlLike {
  return isContentControl(node);
}

function propertiesOf(control: OoxmlElement): OoxmlElement | undefined {
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if ((child as { kind: string }).kind === 'contentControlProperties') return child;
    if (child.localName === 'sdtPr') return child;
  }
  return undefined;
}

function wmlVal(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

function childVal(properties: OoxmlElement | undefined, localName: string): string | undefined {
  if (!properties) return undefined;
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === localName) return wmlVal(child);
  }
  return undefined;
}

function controlTypeOf(properties: OoxmlElement | undefined): ContentControlType {
  if (!properties) return 'richText';
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    const mapped = mapTypeMarker(child);
    if (mapped !== undefined) return mapped;
  }
  return 'richText';
}

function mapTypeMarker(node: OoxmlNode): ContentControlType | undefined {
  if (node.kind === 'textValue') return undefined;
  const kind = node.kind;
  const localName = node.localName;
  const namespaceUri = node.namespaceUri;

  if (kind === 'contentControlDropDownList' || localName === 'dropDownList') {
    return 'dropdown';
  }
  if (kind === 'contentControlComboBox' || localName === 'comboBox') {
    return 'comboBox';
  }
  if (kind === 'contentControlDate' || localName === 'date') return 'date';
  if (localName === 'picture') return 'picture';
  if (localName === 'docPartList') return 'buildingBlockGallery';
  if (kind === 'contentControlText' || localName === 'text') return 'plainText';
  if (localName === 'richText') return 'richText';

  if (
    localName === 'checkbox' &&
    (namespaceUri === W14_NAMESPACE_URI || kind === 'contentControlCheckbox')
  ) {
    return 'checkbox';
  }
  if (localName === 'repeatingSection' && namespaceUri === W15_NAMESPACE_URI) {
    return 'repeatingSection';
  }

  return undefined;
}

/** Declared content-edit lock on one control (`contentLocked` / `sdtContentLocked`). */
function contentEditingLocked(properties: OoxmlElement | undefined): boolean {
  const lock = childVal(properties, 'lock');
  return lock === 'contentLocked' || lock === 'sdtContentLocked';
}

/**
 * Effective content-edit lock — nested union matching store `effectiveLockOf` content axis.
 * An unlocked inner under a `contentLocked` outer is still locked for editing.
 */
function effectiveContentLocked(part: OoxmlPart, control: OoxmlElement): boolean {
  if (contentEditingLocked(propertiesOf(control))) return true;
  let current = parentNodeOf(part, control.id);
  while (current) {
    if (isContentControlNode(current) && contentEditingLocked(propertiesOf(current))) {
      return true;
    }
    current = parentNodeOf(part, current.id);
  }
  return false;
}

/**
 * Project a control into a public summary.
 *
 * When `part` is provided, `locked` is the nested content-edit union so an unlocked inner
 * under a `contentLocked` outer reports `locked: true`. Without a part (unit mocks), fall
 * back to the control's own declaration.
 */
function summaryOf(control: OoxmlElement, part?: OoxmlPart): ContentControlSummary {
  const properties = propertiesOf(control);
  const tag = childVal(properties, 'tag');
  const alias = childVal(properties, 'alias');
  const locked = part ? effectiveContentLocked(part, control) : contentEditingLocked(properties);
  return {
    id: control.id,
    controlType: controlTypeOf(properties),
    ...(tag !== undefined ? { tag } : {}),
    ...(alias !== undefined ? { alias } : {}),
    ...(locked ? { locked: true } : {}),
  };
}

const summaryByControlNode = new WeakMap<
  OoxmlElement,
  {
    readonly properties: OoxmlElement | undefined;
    readonly lockAncestors: string;
    readonly summary: ContentControlSummary;
  }
>();

function contentLockAncestorKey(part: OoxmlPart, control: OoxmlElement): string {
  const parts: string[] = [];
  let current = parentNodeOf(part, control.id);
  while (current) {
    if (isContentControlNode(current)) {
      parts.push(`${current.id}:${contentEditingLocked(propertiesOf(current)) ? 1 : 0}`);
    }
    current = parentNodeOf(part, current.id);
  }
  return parts.join('|');
}

function freezeContentControlSummary(summary: ContentControlSummary): ContentControlSummary {
  return Object.freeze({
    ...summary,
    ...(summary.tag !== undefined ? { tag: summary.tag } : {}),
    ...(summary.alias !== undefined ? { alias: summary.alias } : {}),
    ...(summary.locked ? { locked: true as const } : {}),
  });
}

function freezeContentControlSummaries(
  summaries: readonly ContentControlSummary[]
): readonly ContentControlSummary[] {
  return Object.freeze(summaries.map((summary) => freezeContentControlSummary(summary)));
}

function summaryForEntry(entry: ContentControlEntry, part: OoxmlPart): ContentControlSummary {
  const control = entry.node;
  const properties = propertiesOf(control);
  const lockAncestors = contentLockAncestorKey(part, control);
  const cached = summaryByControlNode.get(control);
  if (cached && cached.properties === properties && cached.lockAncestors === lockAncestors) {
    return cached.summary;
  }
  const summary = freezeContentControlSummary(summaryOf(control, part));
  summaryByControlNode.set(control, { properties, lockAncestors, summary });
  return summary;
}

function summariesForPart(part: OoxmlPart): readonly ContentControlSummary[] {
  noteContentControlEnumerationTopLevelVisit();
  const entries = contentControlsIn(part.root);
  noteContentControlEnumerationControlVisits(entries.length);
  return entries.map((entry) => summaryForEntry(entry, part));
}

function rebuildContentControlSummaries(
  session: TreeDocxSessionView
): readonly ContentControlSummary[] {
  return freezeContentControlSummaries(
    session.storyParts().flatMap((part) => summariesForPart(part))
  );
}

function allContentControlSummaries(
  session: TreeDocxSessionView
): readonly ContentControlSummary[] {
  return cachedContentControlSummaries(session, () => rebuildContentControlSummaries(session));
}

function matchesFilter(summary: ContentControlSummary, filter?: ContentControlFilter): boolean {
  if (!filter) return true;
  if (filter.tag !== undefined && summary.tag !== filter.tag) return false;
  if (filter.alias !== undefined && summary.alias !== filter.alias) return false;
  if (filter.controlType !== undefined && summary.controlType !== filter.controlType) return false;
  return true;
}

type InlineControlRange = {
  readonly control: OoxmlElement;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
};

/**
 * Every inline control's UTF-16 span inside one paragraph.
 *
 * Affinity at boundaries is half-open: a caret at `start` is inside, at `end` is outside. When
 * nested controls share an edge, the inner control yields at its exclusive end so the outer
 * control owns that offset.
 */
function inlineControlRangesOf(paragraph: OoxmlElement): InlineControlRange[] {
  const ranges: InlineControlRange[] = [];
  if (paragraph.kind !== 'paragraph') return ranges;

  const walk = (
    children: readonly OoxmlNode[],
    offset: number,
    depth: number,
    containerDepth: number
  ): number => {
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return offset;
    let position = offset;
    for (const child of children) {
      if (child.kind === 'paragraphProperties') continue;
      if (child.kind === 'run') {
        position += paragraphInlineLengthOf(paragraph, child);
        continue;
      }
      if (isInlineRunContainer(child)) {
        position = walk(child.children, position, depth, containerDepth + 1);
        continue;
      }
      if (isContentControlNode(child)) {
        // A control reached at the shared container cap is opaque and contributes zero length.
        const start = position;
        const nextDepth = depth + 1;
        position = walk(
          contentControlContentChildren(child),
          position,
          nextDepth,
          containerDepth + 1
        );
        ranges.push({ control: child, start, end: position, depth: nextDepth });
        continue;
      }
      position += paragraphInlineLengthOf(paragraph, child);
    }
    return position;
  };

  walk(paragraph.children, 0, -1, 0);
  return ranges;
}

function inlineControlsContaining(
  paragraph: OoxmlElement,
  offset: number,
  part?: OoxmlPart
): readonly ContentControlSummary[] {
  return inlineControlRangesOf(paragraph)
    .filter((range) => offset >= range.start && offset < range.end)
    .sort((left, right) => right.depth - left.depth)
    .map((range) => summaryOf(range.control, part));
}

export function collectContentControlsOracle(part: OoxmlPart): ContentControlSummary[] {
  return [...summariesForPart(part)];
}

function blockAncestorsOf(part: OoxmlPart, paragraphId: string): ContentControlSummary[] {
  const ancestors: ContentControlSummary[] = [];
  let current = parentNodeOf(part, paragraphId);
  while (current) {
    if (isContentControlNode(current)) {
      ancestors.push(summaryOf(current, part));
    }
    current = parentNodeOf(part, current.id);
  }
  return ancestors.reverse();
}

/**
 * The `contentControls` query — every control in the document, optionally filtered.
 *
 * EVERY STORY, not the body alone. Its sibling `contentControlAt` answers about the caret and
 * so already reached a header's control, which meant the two queries described different
 * documents: the list never contained the control the caret was standing in, and a host
 * building a picker from it could not offer what the user was looking at.
 */
/** @internal Re-export for warm-path tests. */
export { contentControlEnumerationTestRecorder } from './content-control-enumeration-cache.ts';

export function contentControlsOf(
  surface: PaginatedSurface | null,
  filter?: ContentControlFilter
): readonly ContentControlSummary[] {
  if (!surface) return [];
  const all = allContentControlSummaries(surface.session);
  if (!filter) return all;
  return all.filter((summary) => matchesFilter(summary, filter));
}

/**
 * The `contentControlAt` query — the innermost control at the caret.
 *
 * Inline controls along the paragraph's UTF-16 offset win over block ancestors. Among inline
 * controls, the deepest range containing the offset wins; when a filter is present, the
 * innermost matching candidate is returned, which may be an outer wrapper when the inner one
 * does not match.
 */
export function contentControlAtOf(
  surface: PaginatedSurface | null,
  filter?: ContentControlFilter
): ContentControlSummary | null {
  if (!surface) return null;
  const { paragraphId, offset } = surface.state().selection.head;
  // The caret's OWN part. Against the body's, a caret in a header found no paragraph and no
  // ancestors, so the facade answered "no control here" for a control the surface had already
  // resolved — and `exec({type:'setContentControlValue'})` refused with the same words while
  // the Inspector button beside it was live.
  const part = partOfNodeId(surface.session, paragraphId) ?? surface.session.part();
  const paragraph = findNode(part, paragraphId);
  if (paragraph && paragraph.kind === 'paragraph') {
    for (const summary of inlineControlsContaining(paragraph, offset, part)) {
      if (matchesFilter(summary, filter)) return summary;
    }
  }
  const ancestors = blockAncestorsOf(part, paragraphId);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const summary = ancestors[index]!;
    if (matchesFilter(summary, filter)) return summary;
  }
  return null;
}

/** Exported for focused unit tests over mock typed nodes. */
export function contentControlSummaryOf(node: OoxmlElement): ContentControlSummary {
  return summaryOf(node);
}

/** Exported for focused unit tests over inline UTF-16 affinity. */
export function inlineContentControlsAt(
  paragraph: OoxmlElement,
  offset: number
): readonly ContentControlSummary[] {
  return inlineControlsContaining(paragraph, offset);
}

// ─── Command dispatch ────────────────────────────────────────────────────────

export type ContentControlEditorCommand =
  | InsertContentControlCommand
  | { type: 'setContentControlValue'; target?: DocTarget; value: string }
  | { type: 'removeContentControl'; target?: DocTarget };

export function isContentControlEditorCommand(command: {
  type: string;
}): command is ContentControlEditorCommand {
  return (
    command.type === 'insertContentControl' ||
    command.type === 'setContentControlValue' ||
    command.type === 'removeContentControl'
  );
}

type CommandGate = { ok: true } | { ok: false; refusal: Extract<ExecResult, { ok: false }> };

type TargetResolution =
  | { ok: true; controlId: string }
  | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

function isDocLocation(value: DocTarget): value is DocLocation {
  return typeof value === 'object' && value !== null && 'container' in value && 'path' in value;
}

function isDocRange(value: DocTarget): value is DocRange {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

function bodyOf(part: OoxmlPart): OoxmlElement | null {
  const walk = (node: OoxmlNode): OoxmlElement | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'body') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

/** Direct block children at one container level — paragraphs, tables, and controls as siblings. */
function directFlowBlocks(children: readonly OoxmlNode[]): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  for (const child of children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraph' || child.kind === 'table' || isContentControlNode(child)) {
      blocks.push(child);
    }
  }
  return blocks;
}

/** Table cell blocks in reading order — the next path level when descending into a table. */
function tableCellBlocks(table: OoxmlElement): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  for (const row of table.children) {
    if (row.kind !== 'tableRow') continue;
    for (const cell of row.children) {
      if (cell.kind !== 'tableCell') continue;
      blocks.push(...directFlowBlocks(cell.children));
    }
  }
  return blocks;
}

function blocksOf(node: OoxmlElement): OoxmlElement[] {
  if (node.kind === 'table') return tableCellBlocks(node);
  if (isContentControlNode(node)) return directFlowBlocks(contentControlContentChildren(node));
  if (node.kind === 'body') return directFlowBlocks(node.children);
  return [];
}

function controlAtBlock(part: OoxmlPart, node: OoxmlElement, offset?: number): TargetResolution {
  if (isContentControlNode(node)) {
    return { ok: true, controlId: node.id };
  }
  if (node.kind === 'paragraph') {
    const caretOffset = offset ?? 0;
    for (const summary of inlineControlsContaining(node, caretOffset, part)) {
      return { ok: true, controlId: summary.id };
    }
    const ancestors = blockAncestorsOf(part, node.id);
    const innermost = ancestors.at(-1);
    if (innermost) return { ok: true, controlId: innermost.id };
  }
  return { ok: false, code: 'notFound', reason: 'no content control at the addressed block' };
}

function resolveDocLocationControl(part: OoxmlPart, location: DocLocation): TargetResolution {
  if (location.container.part !== 'body') {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'only the body container is supported',
      target: location,
    };
  }
  const body = bodyOf(part);
  if (!body) {
    return {
      ok: false,
      code: 'notFound',
      reason: 'the document body was not found',
      target: location,
    };
  }
  if (location.path.length === 0) {
    return { ok: false, code: 'notFound', reason: 'DocLocation path is empty', target: location };
  }
  let blocks = directFlowBlocks(body.children);
  let node: OoxmlElement | null = null;
  for (let index = 0; index < location.path.length; index += 1) {
    node = blocks[location.path[index]!] ?? null;
    if (!node) {
      return {
        ok: false,
        code: 'notFound',
        reason: `block index ${location.path[index]} is out of range`,
        target: location,
      };
    }
    if (index < location.path.length - 1) {
      blocks = blocksOf(node);
    }
  }
  if (!node) {
    return {
      ok: false,
      code: 'notFound',
      reason: 'the addressed block was not found',
      target: location,
    };
  }
  const resolved = controlAtBlock(part, node, location.offset);
  return resolved.ok ? resolved : { ...resolved, target: location };
}

function resolveDocAnchorControl(
  part: OoxmlPart,
  anchors: ParagraphAnchorIndex,
  anchor: DocAnchor
): TargetResolution {
  const resolved = resolveDocAnchor(part, anchors, anchor);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, reason: resolved.reason, target: anchor };
  }
  // The paragraph's OWN part. `resolveDocAnchor` spans every story, so the id it hands back is
  // routinely a header's — and looking it up in the body reported `paragraph 'X' was not
  // found` about a paragraph the same call had just found. `DocAnchor` is the only non-caret
  // way to target a control, so that made every control outside the body unaddressable.
  const owner = anchors.partByNode.get(resolved.span.nodeId) ?? part;
  const paragraph = findNode(owner, resolved.span.nodeId);
  if (!paragraph || paragraph.kind !== 'paragraph') {
    return {
      ok: false,
      code: 'notFound',
      reason: `paragraph '${anchor.paraId}' was not found`,
      target: anchor,
    };
  }
  const atOffset = resolved.span.start;
  for (const summary of inlineControlsContaining(paragraph, atOffset, owner)) {
    return { ok: true, controlId: summary.id };
  }
  const ancestors = blockAncestorsOf(owner, paragraph.id);
  const innermost = ancestors.at(-1);
  if (innermost) return { ok: true, controlId: innermost.id };
  return {
    ok: false,
    code: 'notFound',
    reason: `no content control encloses paragraph '${anchor.paraId}'`,
    target: anchor,
  };
}

/** Resolve a public `DocTarget` (or the caret) to canonical control node identity. */
export function resolveContentControlTarget(
  surface: PaginatedSurface,
  target?: DocTarget
): TargetResolution {
  if (target === undefined) {
    const at = contentControlAtOf(surface);
    if (!at) {
      return { ok: false, code: 'notFound', reason: 'no content control at the current selection' };
    }
    return { ok: true, controlId: at.id };
  }
  if (isDocRange(target)) {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'DocRange targeting is not supported for content controls',
      target,
    };
  }
  const part = surface.session.part();
  if (isDocLocation(target)) return resolveDocLocationControl(part, target);
  if (isDocAnchor(target)) {
    return resolveDocAnchorControl(part, surface.session.paragraphAnchors(), target);
  }
  return { ok: false, code: 'invalidArgs', reason: 'unrecognized target shape', target };
}

function mapTreeOpRejection(reason: string): ExecErrorCode {
  switch (reason) {
    case 'locked':
    case 'bound':
    case 'typeMismatch':
    case 'invalidArgs':
    case 'unsupported':
      return reason;
    case 'unknown-control':
      return 'notFound';
    case 'indivisible-content':
      return 'unsupported';
    default:
      return 'unsupported';
  }
}

function treeOpRejectionMessage(reason: string): string {
  switch (reason) {
    case 'locked':
      return 'the content control is locked';
    case 'bound':
      return 'the content control is bound to external data';
    case 'typeMismatch':
      return 'the value does not match the control type';
    case 'invalidArgs':
      return 'the value is not valid for this control';
    case 'unsupported':
      return 'this control type is not supported';
    case 'unknown-control':
      return 'the content control was not found';
    case 'indivisible-content':
      return 'a content control cannot start or end inside a hyperlink, a field, or another inline control';
    default:
      return `the edit was refused (${reason})`;
  }
}

function treeOpRejectionToExecResult(
  reason: string,
  target?: DocTarget
): Extract<ExecResult, { ok: false }> {
  return {
    ok: false,
    code: mapTreeOpRejection(reason),
    reason: treeOpRejectionMessage(reason),
    ...(target !== undefined ? { target } : {}),
  };
}

function gateContentControlCommand(
  command: ContentControlEditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view' | 'suggesting',
  options?: { scope?: EditorScope }
): CommandGate {
  // A control is addressed by its OWN id, and `resolveContentControlTarget` reads the part out
  // of that id, so the caret path answers in whatever story the caret is in. A blanket non-body
  // refusal here used to make an explicitly-scoped call fail on a control the caret path would
  // have edited — and, because `exec` runs this same gate, refused the write too.
  //
  // What a non-body scope still cannot have is an EXPLICIT `DocLocation` or `DocAnchor` target:
  // both resolve against `session.part()`, the body's. The refusal narrows to that, and says so.
  if (options?.scope && options.scope.kind !== 'body' && command.target !== undefined) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'unsupported',
        reason: 'a location or anchor target resolves in the body only; omit it to use the caret',
      },
    };
  }
  if (!surface) {
    return { ok: false, refusal: { ok: false, code: 'notFound', reason: 'no document is loaded' } };
  }
  if (mode === 'view' || !surface.session.editable) {
    return {
      ok: false,
      refusal: { ok: false, code: 'locked', reason: 'the document is read-only' },
    };
  }
  if (command.type === 'setContentControlValue' && typeof command.value !== 'string') {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'invalidArgs',
        reason: 'setContentControlValue requires a string value',
      },
    };
  }
  return { ok: true };
}

/**
 * The reader's CURRENT mode, in the vocabulary a gate takes.
 *
 * `createDocxEditor`'s `mode` is the CONSTRUCTION value and is fixed for the life of the
 * editor, so a gate given it answers the question the host asked at open time rather than
 * the one the reader is asking now: a document switched to viewing kept a fully writable
 * set of content-control commands, because that branch is dispatched above the facade's
 * viewing gate and was the one lane that never re-read the mode.
 *
 * @internal
 */
export function gateModeOf(editingMode: DocumentEditingMode): 'edit' | 'view' | 'suggesting' {
  if (editingMode === 'viewing') return 'view';
  return editingMode === 'suggesting' ? 'suggesting' : 'edit';
}

/**
 * `can` probe for content-control commands.
 *
 * Faithfully predicts `exec`: after shape/mode/target gates, runs the same `validateTreeOp`
 * the store would apply for lock, binding, type, and value — so chrome/`Editor.can` never
 * claim a command is executable when `exec` would refuse it.
 */
export function canContentControlCommand(
  command: ContentControlEditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view' | 'suggesting',
  options?: { scope?: EditorScope }
): CanResult {
  const gated = gateContentControlCommand(command, surface, mode, options);
  if (!gated.ok) return gated.refusal;
  // An insertion has no control to resolve — it is about to create the one it addresses — so
  // it builds its op from a RANGE and validates that, through the same store validator.
  if (command.type === 'insertContentControl') {
    const insertion = resolveContentControlInsertion(surface!, command);
    if (!insertion.ok) return { ok: false, code: insertion.code, reason: insertion.reason };
    return storeVerdict(surface!, insertion.op, insertion.span.paragraphId);
  }
  const resolved = resolveContentControlTarget(surface!, command.target);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, reason: resolved.reason };
  }
  const op: TreeDocOp =
    command.type === 'setContentControlValue'
      ? { op: 'setContentControlValue', controlId: resolved.controlId, value: command.value }
      : { op: 'removeContentControl', controlId: resolved.controlId };
  return storeVerdict(surface!, op, resolved.controlId);
}

/** What the store itself would say about this op, in the vocabulary `can` answers. */
function storeVerdict(surface: PaginatedSurface, op: TreeDocOp, nodeId: string): CanResult {
  const part = partOfNodeId(surface.session, nodeId) ?? surface.session.part();
  const settings = settingsPartOf(surface.session.currentPackage());
  const rejection =
    documentProtectionRefusal(settings, op) ??
    formsProtectionRefusal(part, settings, op) ??
    validateTreeOp(part, op);
  if (rejection) {
    return {
      ok: false,
      code: mapTreeOpRejection(rejection),
      reason: treeOpRejectionMessage(rejection),
    };
  }
  return { ok: true };
}

/**
 * Gate, then commit — the whole `exec` path for a content-control command.
 *
 * The FLUSH is here rather than inside the write. The gate resolves the command against the
 * tree, and an insertion resolves OFFSETS: with a typing burst still queued, the gate read the
 * paragraph as it was while the write read it as it became, so `exec` could refuse for a reason
 * its own gate had just approved. Queued input is committed either way; this decides only
 * whether both halves read the same document.
 */
export function runContentControlCommand(
  command: ContentControlEditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view' | 'suggesting',
  options?: { scope?: EditorScope }
): ExecResult {
  surface?.flushPendingInput();
  const gated = canContentControlCommand(command, surface, mode, options);
  if (!gated.ok) return gated;
  return execContentControlCommand(surface!, command);
}

/**
 * The surface's internal gated write, when this surface carries one.
 *
 * The paginated surface exposes it by cast (the `setScale` idiom): the same collaboration
 * gate and actor attribution the typing lane commits through, without widening the public
 * surface contract. Writing `session.applyTreeOps` directly skipped both — with a replica
 * attached, a content-control edit committed locally while not ready and replicated with no
 * actor bound. A stub or foreign surface without the member falls back to the raw session
 * write, which for a surface with no replica is the identical path.
 */
type GatedTreeOpsSurface = PaginatedSurface & {
  applyGatedTreeOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: SelectionMark | null,
    selectionAfter?: SelectionMark | null,
    scope?: StoryScope
  ): TreeApplyResult;
};

function applyGatedSurfaceTreeOps(
  surface: PaginatedSurface,
  ops: readonly TreeDocOp[],
  selectionBefore: SelectionMark | null,
  selectionAfter: SelectionMark | null,
  scope: StoryScope
): TreeApplyResult {
  const gated = (surface as Partial<GatedTreeOpsSurface>).applyGatedTreeOps;
  if (typeof gated === 'function') {
    return gated.call(surface, ops, selectionBefore, selectionAfter, scope);
  }
  return surface.session.applyTreeOps(ops, selectionBefore, selectionAfter, scope);
}

/** Commit a content-control tree op through the surface session and refresh layout. */
export function execContentControlCommand(
  surface: PaginatedSurface,
  command: ContentControlEditorCommand
): ExecResult {
  if (command.type === 'insertContentControl') return execInsertContentControl(surface, command);
  const resolved = resolveContentControlTarget(surface, command.target);
  if (!resolved.ok) {
    const target = resolved.target ?? command.target;
    return {
      ok: false,
      code: resolved.code,
      reason: resolved.reason,
      ...(target !== undefined ? { target } : {}),
    };
  }

  // A direct session write below `commit`: queued typing must land first, or a
  // control edit that shrinks the caret paragraph makes the later flush refuse.
  surface.flushPendingInput();
  const mark = selectionMarkOf(surface.state().selection);
  const op: TreeDocOp =
    command.type === 'setContentControlValue'
      ? { op: 'setContentControlValue', controlId: resolved.controlId, value: command.value }
      : { op: 'removeContentControl', controlId: resolved.controlId };

  // The STORY the control is in, from its own id. Left to default, this wrote against the body
  // store, which has never heard of a control in a header — so the facade refused a verb the
  // surface performs happily, on the same control.
  //
  // Through the GATED apply, not `session.applyTreeOps`: with a replica attached the write
  // must ask the collaboration gate and carry the actor, like every other lane.
  const result = applyGatedSurfaceTreeOps(
    surface,
    [op],
    mark,
    mark,
    storyScopeOfNodeId(surface.session, resolved.controlId, { kind: 'body' })
  );
  if (result.rejected) {
    return treeOpRejectionToExecResult(result.reason ?? 'unsupported', command.target);
  }

  surface.layout();
  // The STORE's own verdict, not a revision comparison. `session.revision()` is the BODY
  // store's clock, and a header, a footer and a notes part each count their own — so every
  // successful write outside the body compared equal and reported `changed: false`, which the
  // contract defines as a no-op. A caller was told its header write did nothing.
  return { ok: true, changed: result.committed };
}

/**
 * Commit an insertion, and leave the caret where the user can use it.
 *
 * A WRAP keeps the characters selected: nothing moved, and the selection is still the span the
 * caller named. A CARET insertion collapses at the control's content start, which is where the
 * prompt lives — typing there replaces the prompt whole rather than appending to it.
 */
function execInsertContentControl(
  surface: PaginatedSurface,
  command: InsertContentControlCommand
): ExecResult {
  // BEFORE the range is read, not after. An insertion addresses OFFSETS, and offsets taken
  // against a paragraph that queued typing is about to rewrite point at the wrong characters.
  // Its neighbours can resolve first because a control id survives a flush and an offset does
  // not. The facade flushes ahead of the gate for the same reason; this is idempotent.
  surface.flushPendingInput();
  const insertion: InsertResolution = resolveContentControlInsertion(surface, command);
  if (!insertion.ok) {
    const target = insertion.target ?? command.target;
    return {
      ok: false,
      code: insertion.code,
      reason: insertion.reason,
      ...(target !== undefined ? { target } : {}),
    };
  }

  const { paragraphId, start, end } = insertion.span;
  const before = selectionMarkOf(surface.state().selection);
  const after = { paragraphId, start, end };
  // The gated apply, for the reason the value/remove path states above.
  const result = applyGatedSurfaceTreeOps(
    surface,
    [insertion.op],
    before,
    after,
    storyScopeOfNodeId(surface.session, paragraphId, { kind: 'body' })
  );
  if (result.rejected) {
    return treeOpRejectionToExecResult(result.reason ?? 'unsupported', command.target);
  }

  surface.layout();
  return { ok: true, changed: result.committed };
}
