// A text-relative table anchors to the next regular paragraph (17.4.57).
// Only a terminal, empty anchor is handled here. Other text still needs wrapping.
import { autofitContextOf } from './table-autofit-widths.ts';
import {
  readTwipsMeasure,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { framedTokenJoin } from './layout-cache.ts';
import { readTableStructure, type TableAnchorFrames } from './semantic-table.ts';
import { positionedTableOriginX } from './table-origin.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { TableFragmentRecord } from './semantic-records.ts';
import type { PositionedTableAnchor } from './table-float-position.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAX_TERMINAL_TABLES = 32;
const MAX_TABLE_NODES = 10000;
const MAX_ANCHOR_NODES = 10000;
type Block =
  | { readonly kind: 'table'; readonly table: OoxmlElement; readonly key: string }
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: readonly OoxmlProperty[];
      readonly listItem?: unknown;
      readonly shading?: string;
      readonly key: string;
    };

export interface TerminalTextTableGroup {
  readonly start: number;
  readonly anchorIndex: number;
  readonly tables: readonly OoxmlElement[];
  readonly token: string;
}

/** Raw content cannot disappear merely because the current revision view hides it. */
function emptyAnchor(block: Block): boolean {
  if (block.kind !== 'paragraph' || block.listItem || block.shading) return false;
  if (
    block.paragraph.children.some((node) => {
      if (node.kind === 'paragraphProperties') return false;
      if (node.kind === 'textValue' || node.namespaceUri !== W) return true;
      if (['bookmarkStart', 'bookmarkEnd', 'proofErr'].includes(node.localName))
        return node.children.length !== 0;
      return node.kind !== 'run' || node.children.some((child) => child.kind !== 'runProperties');
    })
  )
    return false;
  if (
    block.props.some((prop) =>
      ['framePr', 'numPr', 'pBdr', 'shd', 'pageBreakBefore'].includes(prop.localName)
    )
  )
    return false;
  const pending = [block.paragraph];
  let visits = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++visits > MAX_ANCHOR_NODES || node.namespaceUri !== W) return false;
    if (
      [
        'ins',
        'del',
        'moveFrom',
        'moveTo',
        'pPrChange',
        'rPrChange',
        'vanish',
        'webHidden',
      ].includes(node.localName)
    )
      return false;
    if (visits + pending.length + node.children.length > MAX_ANCHOR_NODES) return false;
    for (const child of node.children) {
      if (child.kind === 'textValue') return false;
      pending.push(child);
    }
  }
  return true;
}

/** Per immutable table node: every section prepass asks it of the tables before its anchor. */
const simpleTables = new WeakMap<OoxmlElement, boolean>();

/** Keep the admission probe and the final placement on the same simple-row path. */
function simpleTable(table: OoxmlElement): boolean {
  const cached = simpleTables.get(table);
  if (cached !== undefined) return cached;
  const simple = simpleTableUncached(table);
  simpleTables.set(table, simple);
  return simple;
}

function simpleTableUncached(table: OoxmlElement): boolean {
  const pending = [table];
  let visits = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++visits > MAX_TABLE_NODES || node.namespaceUri !== W) return false;
    if (node !== table && node.kind === 'table') return false;
    if (
      [
        'vMerge',
        'hMerge',
        'tblHeader',
        'drawing',
        'pict',
        'object',
        'fldChar',
        'fldSimple',
        'instrText',
        'footnoteReference',
        'endnoteReference',
        'ins',
        'del',
        'moveFrom',
        'moveTo',
        'sdt',
        'altChunk',
        'framePr',
      ].includes(node.localName)
    )
      return false;
    if (
      node.localName === 'tblOverlap' &&
      !node.attributes.some(
        (attr) => attr.namespaceUri === W && attr.localName === 'val' && attr.value === 'overlap'
      )
    )
      return false;
    if (visits + pending.length + node.children.length > MAX_TABLE_NODES) return false;
    for (const child of node.children) if (child.kind !== 'textValue') pending.push(child);
  }
  return true;
}

/** Do not opt in through an invalid value that the general reader defaults or clamps. */
function supportedPosition(table: OoxmlElement): boolean {
  let properties: OoxmlElement | undefined;
  for (const node of table.children) {
    if (node.kind !== 'tableProperties') continue;
    if (properties) return false;
    properties = node;
  }
  if (!properties) return false;
  const positions = properties.children.filter(
    (node) => node.kind !== 'textValue' && node.localName === 'tblpPr'
  );
  if (positions.length !== 1) return false;
  const position = positions[0]!;
  if (position.kind === 'textValue' || position.namespaceUri !== W || position.children.length)
    return false;
  const names = new Set<string>();
  for (const attr of position.attributes) {
    if (attr.namespaceUri !== W || names.has(attr.localName)) return false;
    names.add(attr.localName);
    if (attr.localName === 'vertAnchor') {
      if (attr.value !== 'text') return false;
    } else if (attr.localName === 'horzAnchor') {
      if (!['text', 'margin', 'page'].includes(attr.value)) return false;
    } else if (attr.localName === 'tblpXSpec') {
      if (!['left', 'center', 'right', 'inside', 'outside'].includes(attr.value)) return false;
    } else if (attr.localName === 'tblpX' || attr.localName === 'tblpY') {
      const offset = readTwipsMeasure(attr.value);
      if (offset === null || Math.abs(offset) > 31680) return false;
    } else if (
      ['leftFromText', 'rightFromText', 'topFromText', 'bottomFromText'].includes(attr.localName)
    ) {
      const clearance = readTwipsMeasure(attr.value);
      if (clearance === null || clearance < 0 || clearance > 31680) return false;
      if (
        (attr.localName === 'topFromText' || attr.localName === 'bottomFromText') &&
        clearance !== 0
      )
        return false;
    } else return false;
  }
  return names.has('vertAnchor');
}

export function terminalTextTableGroup(
  blocks: readonly Block[],
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined,
  compatibilityMode?: number
): TerminalTextTableGroup | undefined {
  const anchorIndex = blocks.length - 1;
  const anchor = blocks[anchorIndex];
  if (!anchor || !emptyAnchor(anchor)) return undefined;
  let start = anchorIndex;
  const tables: OoxmlElement[] = [];
  const tokens = [anchor.key];
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.kind !== 'table') break;
    if (!simpleTable(block.table) || !supportedPosition(block.table)) return undefined;
    const structure = readTableStructure(
      block.table,
      contentWidth,
      0,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    );
    const float = structure?.float;
    if (!float || float.vertAnchor !== 'text' || float.ySpec) return undefined;
    if (tables.length >= MAX_TERMINAL_TABLES) return undefined;
    tables.push(block.table);
    tokens.push(block.key);
    start = index;
  }
  if (!tables.length) return undefined;
  return { start, anchorIndex, tables: tables.reverse(), token: framedTokenJoin(tokens) };
}

export interface TerminalTablePlacement {
  readonly fragments: readonly TableFragmentRecord[];
  readonly bottom: number;
  readonly cellBreakKeys: readonly (readonly string[])[];
}

/** Attach each placed table's logical-anchor wrap metadata. */
export function withTerminalFloatingWrap(
  fragments: readonly TableFragmentRecord[],
  positioned: readonly PositionedTableAnchor[],
  columnIndex: number
): TableFragmentRecord[] {
  return fragments.map((fragment) => {
    const source = positioned.find((entry) => entry.table.id === fragment.tableId)!;
    return {
      ...fragment,
      floatingWrap: {
        anchorId: source.anchorId,
        columnIndex,
        float: source.float,
        sourceOrder: source.sourceIndex,
      },
    };
  });
}

/** Decline the whole group unless its table/anchor union fits this content rectangle. */
export function placeTerminalTextTables(
  group: TerminalTextTableGroup,
  input: {
    readonly cursorY: number;
    readonly anchorHeight: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
    readonly frames: TableAnchorFrames;
    readonly deps: TableFlowDeps;
    readonly styleCascade: StyleCascadeTable | undefined;
    readonly displayMode: RevisionDisplayMode;
    readonly authorFilter: RevisionAuthorFilter | undefined;
  }
): TerminalTablePlacement | undefined {
  const { cursorY, anchorHeight, contentWidth, contentHeight } = input;
  if (
    !Number.isFinite(anchorHeight) ||
    anchorHeight <= 0 ||
    cursorY + anchorHeight > contentHeight + 0.001
  )
    return undefined;
  const structures = group.tables.map((table) =>
    readTableStructure(
      table,
      contentWidth,
      0,
      input.styleCascade,
      input.displayMode,
      input.authorFilter,
      input.deps.compatibilityMode,
      autofitContextOf(input.deps)
    )
  );
  const placements: { left: number; top: number; right: number; bottom: number }[] = [];
  let bottom = cursorY + anchorHeight;
  let probeLine = 0;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(input.deps),
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `terminal-table-probe-${probeLine++}`,
  };
  for (let index = 0; index < structures.length; index += 1) {
    const structure = structures[index];
    if (!structure?.float || !structure.rows.length) return undefined;
    const width = structure.columnWidthsPt.reduce((sum, value) => sum + value, 0);
    const left = positionedTableOriginX(structure, input.frames, input.deps.compatibilityMode);
    const top = cursorY + structure.float.yPt;
    if (
      ![left, top, width].every(Number.isFinite) ||
      width <= 0 ||
      left < 0 ||
      // A legacy right-aligned table may hang its right cell margin past the column.
      left + width >
        contentWidth +
          ((structure.float.xSpec === 'right' || structure.float.xSpec === 'outside') &&
          hasCompatibilityRule(input.deps.compatibilityMode, 'floatingTableContentOrigin')
            ? structure.defaultMargins.right
            : 0) +
          0.001 ||
      // Upward offsets need collision checks against preceding paragraph text.
      top < cursorY ||
      top > contentHeight
    )
      return undefined;
    const probe = layoutTableFragment(
      structure,
      left,
      top,
      0,
      group.tables[index]!.id,
      0,
      probeDeps
    );
    if (!Number.isFinite(probe.bottom) || probe.bottom > contentHeight + 0.001) return undefined;
    // Collision handling is outside this lane. Never introduce overlapping table text.
    if (
      placements.some(
        (placed) =>
          left < placed.right &&
          left + width > placed.left &&
          top < placed.bottom &&
          probe.bottom > placed.top
      )
    )
      return undefined;
    bottom = Math.max(bottom, probe.bottom);
    placements.push({ left, top, right: left + width, bottom: probe.bottom });
  }
  const cellBreakKeys: string[][] = [];
  const fragments = structures.map((structure, index) => {
    const keys: string[] = [];
    cellBreakKeys.push(keys);
    const { left, top } = placements[index]!;
    const placed = layoutTableFragment(structure!, left, top, 0, group.tables[index]!.id, 0, {
      ...input.deps,
      onCellBreakKey: (key) => keys.push(key),
    });
    return { ...placed.fragment, outOfFlow: true as const };
  });
  return { fragments, bottom, cellBreakKeys };
}
