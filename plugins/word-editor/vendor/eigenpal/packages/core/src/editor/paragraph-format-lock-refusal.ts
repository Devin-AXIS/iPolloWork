// Paragraph formatting over a content lock, answered BEFORE the write, so `can`, the toolbar
// and `exec` all say the same thing. Several paragraph writers return nothing, so a store
// refusal inside them reached the caller as `ok` with no change. Asking the store's own rule
// here first is what keeps a button from looking available and then doing nothing.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  lockForbidsEdit,
} from '../store/package/content-control-nodes.ts';
import { directParagraphProperties, propertyContainer } from '../store/store/direct-properties.ts';
import { validateTreeOp } from '../store/store/tree-op-validate.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { paragraphsInCells } from '../layout/semantic-cell-selection.ts';
import { fragmentParagraphs } from '../layout/line-segments.ts';
import { paragraphFragmentsOnPage } from '../layout/story-fragments.ts';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import { LOCKED_FORMAT_REASON } from './content-lock-format-refusal.ts';
import { partOfNodeId, storyScopeOfNodeId } from './surface-scope.ts';

/**
 * A content lock lets alignment, indents, spacing, and the line and page break settings
 * change. Paragraph style, lists, direction, tab stops, and contextual spacing stay locked.
 */
export const LOCKED_PARAGRAPH_FORMAT_REASON =
  'this content is locked; only alignment, indents, spacing, and line and page breaks can change';

type ParagraphFormatCommand = Extract<
  EditorCommand,
  {
    type:
      | 'setAlignment'
      | 'setParagraphDirection'
      | 'setLineSpacing'
      | 'setParagraphSpacing'
      | 'setIndent'
      | 'adjustIndent'
      | 'toggleList'
      | 'setParagraphStyle'
      | 'setParagraphFormat';
  }
>;

const PARAGRAPH_FORMAT_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set<
  ParagraphFormatCommand['type']
>([
  'setAlignment',
  'setParagraphDirection',
  'setLineSpacing',
  'setParagraphSpacing',
  'setIndent',
  'adjustIndent',
  'toggleList',
  'setParagraphStyle',
  'setParagraphFormat',
]);

/**
 * What a command writes, as far as a content lock is concerned.
 *
 * - `alignment`: `w:jc` alone.
 * - `placement`: properties the lock lets change (alignment, indents, spacing, keeps).
 * - `locked`: a property the lock keeps (a style, a list, direction, tab stops).
 * - `indentStep`: Increase or Decrease Indent, which moves a list item's level and every other
 *   paragraph's indent, so it is decided per paragraph.
 */
type LockReach = 'alignment' | 'placement' | 'locked' | 'indentStep';

/** The `setParagraphFormat` fields that write a property a content lock keeps. */
const LOCKED_FORMAT_FIELDS = ['direction', 'contextualSpacing', 'tabStops'] as const;

function lockReachOf(command: ParagraphFormatCommand): LockReach {
  switch (command.type) {
    case 'setAlignment':
      return 'alignment';
    case 'setLineSpacing':
    case 'setParagraphSpacing':
    case 'setIndent':
      return 'placement';
    case 'adjustIndent':
      return 'indentStep';
    case 'setParagraphDirection':
    case 'toggleList':
    case 'setParagraphStyle':
      return 'locked';
    case 'setParagraphFormat': {
      if (LOCKED_FORMAT_FIELDS.some((field) => command[field] !== undefined)) return 'locked';
      const { type: _type, alignment, ...others } = command;
      const alignsOnly =
        alignment !== undefined && Object.values(others).every((value) => value === undefined);
      return alignsOnly ? 'alignment' : 'placement';
    }
  }
}

/** The paragraphs a paragraph write reaches, with the same coverage the writer uses. */
function selectedParagraphIds(surface: PaginatedSurface): readonly string[] {
  const state = surface.state();
  const cells = state.cellSelection;
  if (cells) return [...paragraphsInCells(surface.layout(), cells.cellIds)];
  const { anchor, head } = state.selection;
  if (anchor.paragraphId === head.paragraphId) return [head.paragraphId];
  const scope = storyScopeOfNodeId(surface.session, anchor.paragraphId, { kind: 'body' });
  const order = surface.session.paragraphIdsIn(scope);
  const a = order.indexOf(anchor.paragraphId);
  const b = order.indexOf(head.paragraphId);
  if (a === -1 || b === -1) return [anchor.paragraphId, head.paragraphId];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Per story root: the paragraphs inside a control that locks content. Every paragraph the
 * store can refuse a paragraph format for is in this set, so the store is asked only about
 * these. A data binding is not here: it mirrors text, so it lets paragraph properties change.
 * Canonical roots are immutable per revision, so the root identity is a safe key.
 */
const LOCKED_PARAGRAPHS = new WeakMap<object, ReadonlySet<string>>();

function lockedParagraphs(part: OoxmlPart): ReadonlySet<string> {
  const known = LOCKED_PARAGRAPHS.get(part.root);
  if (known) return known;
  const locked = new Set<string>();
  for (const entry of contentControlsIn(part.root)) {
    if (!lockForbidsEdit(contentControlPropertiesOf(entry.node).lock)) continue;
    const pending: OoxmlNode[] = [entry.node];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.kind === 'textValue') continue;
      if (node.kind === 'paragraph') locked.add(node.id);
      for (const child of node.children) pending.push(child);
    }
  }
  LOCKED_PARAGRAPHS.set(part.root, locked);
  return locked;
}

/**
 * Per layout: the paragraphs that publish a list marker, which Increase Indent moves by level.
 * The same fragments `markerHolding` reads, walked once instead of once per paragraph, so a
 * select-all over a long locked block stays linear. Layouts are immutable, so identity is a key.
 */
const LIST_ITEMS = new WeakMap<SemanticLayout, ReadonlySet<string>>();

function listItemParagraphs(layout: SemanticLayout): ReadonlySet<string> {
  const known = LIST_ITEMS.get(layout);
  if (known) return known;
  const ids = new Set<string>();
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (!fragment.marker) continue;
      ids.add(fragment.paragraphId);
      for (const id of fragmentParagraphs(fragment)) ids.add(id);
    }
  }
  LIST_ITEMS.set(layout, ids);
  return ids;
}

/** Whether the paragraph holds a pending paragraph property change. */
function hasPendingParagraphChange(part: OoxmlPart, paragraphId: string): boolean {
  const paragraph = findNode(part, paragraphId);
  if (paragraph?.kind !== 'paragraph') return false;
  const properties = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
  return (
    properties !== undefined &&
    properties.kind !== 'textValue' &&
    properties.children.some(
      (child) => child.kind !== 'textValue' && child.localName === 'pPrChange'
    )
  );
}

/** The direct properties with one flat property added, or removed when it is there. */
function toggled(part: OoxmlPart, paragraphId: string, localName: string) {
  const direct = directParagraphProperties(part, paragraphId);
  const without = direct.filter((property) => property.localName !== localName);
  return without.length === direct.length ? [...direct, { localName }] : without;
}

/**
 * The write the store is asked about, tracked as the surface would track it.
 *
 * Alignment asks with the alignment it would write. A placement write asks with an indent
 * change, the representative of every property the lock lets change. A locked write asks with
 * a contextual spacing change: every property outside that set gets the same answer from the
 * lock, and this one is flat, so the probe needs no definition to point at.
 */
function probeOp(
  part: OoxmlPart,
  paragraphId: string,
  reach: Exclude<LockReach, 'indentStep'>,
  author: string | undefined
): TreeDocOp {
  const revision = author !== undefined ? { revision: { author } } : {};
  if (reach === 'alignment') {
    return {
      op: 'setParagraphProperties',
      paragraphId,
      properties: [
        ...directParagraphProperties(part, paragraphId).filter(
          (property) => property.localName !== 'jc'
        ),
        { localName: 'jc', attributes: { val: 'center' } },
      ],
      ...revision,
    };
  }
  return {
    op: 'setParagraphProperties',
    paragraphId,
    properties: toggled(part, paragraphId, reach === 'placement' ? 'ind' : 'contextualSpacing'),
    ...(reach === 'placement' ? revision : {}),
  };
}

/**
 * The refusal a paragraph formatting command meets because the selection reaches a
 * paragraph that a content lock protects, or null.
 *
 * Alignment, indents, spacing, and the keep settings pass a content lock, so they are refused
 * only where the store refuses the write: a pending tracked change the write would merge into
 * that records a locked property. Styles, lists, direction, and tab stops are refused wherever
 * the lock reaches. A data binding refuses none of them: it mirrors text, not paragraph
 * properties.
 */
export function paragraphFormatLockRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  policy: ContentLockPolicy | undefined
): Exclude<ExecResult, { ok: true }> | null {
  if (!PARAGRAPH_FORMAT_COMMANDS.has(command.type)) return null;
  const commandReach = lockReachOf(command as ParagraphFormatCommand);
  const writer = surface.author()?.trim();
  const author =
    surface.editingMode() === 'suggest' &&
    writer &&
    !surface.session.trackingSettings().doNotTrackFormatting
      ? writer
      : undefined;
  // A selection stays in one story, and the writer writes every paragraph into that part.
  const head = surface.state().selection.head.paragraphId;
  const part = partOfNodeId(surface.session, head) ?? surface.session.part();
  const locked = lockedParagraphs(part);
  if (locked.size === 0) return null;
  const listItems = commandReach === 'indentStep' ? listItemParagraphs(surface.layout()) : null;
  for (const paragraphId of selectedParagraphIds(surface)) {
    if (!locked.has(paragraphId)) continue;
    // Increase Indent moves a list item's level, which the lock keeps, and indents the rest.
    const reach: Exclude<LockReach, 'indentStep'> =
      commandReach !== 'indentStep'
        ? commandReach
        : listItems?.has(paragraphId)
          ? 'locked'
          : 'placement';
    // A lock lets these through, so only a pending tracked change that the write would merge
    // into can refuse them: skip the store for every other paragraph.
    if (
      reach !== 'locked' &&
      (author === undefined || !hasPendingParagraphChange(part, paragraphId))
    ) {
      continue;
    }
    const refused = validateTreeOp(part, probeOp(part, paragraphId, reach, author), {
      contentLockPolicy: policy,
    });
    if (refused === 'locked') {
      return {
        ok: false,
        code: 'locked',
        reason: reach === 'locked' ? LOCKED_PARAGRAPH_FORMAT_REASON : LOCKED_FORMAT_REASON,
      };
    }
  }
  return null;
}
