// Where each content control IS, once the pages exist.
//
// A control is transparent to pagination — it moves nothing, reserves nothing, and produces no
// box of its own — so layout has no record for it and must not grow one: a wrapper that
// participated in the flow would be a wrapper that could change it. What a browser, an object
// model and the chrome all need instead is a DERIVED answer to "where did this control's
// content end up", and this module is that derivation, computed from published records rather
// than read back out of the DOM.
//
// TWO FRAGMENTS FOR A SPLIT CONTROL, not one union box: a control whose paragraphs cross a page
// boundary is in two places, and a single rectangle spanning both would cover the gap between
// pages — an area a selection must never claim.

import {
  MAX_CONTENT_CONTROL_NESTING,
  contentControlContentNodeOf,
  contentControlLevelOf,
  contentControlPropertiesOf,
  contentControlsIn,
  resolveContentControlLock,
  type ContentControlDataBinding,
  type ContentControlKind,
  type ContentControlLevel,
  type ContentControlLock,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { BlockFragmentRecord, LayoutBox, SemanticLayout } from './semantic-records.ts';

/** One page-local rectangle covering the part of a control that sits on that page. */
export interface ContentControlFragmentRecord extends LayoutBox {
  readonly pageIndex: number;
}

/**
 * Everything a consumer needs to point at one control without walking the tree.
 *
 * `controlId` is the canonical NODE id — the identity `w:id` cannot provide, because the file
 * may omit it and may repeat it. `id` is the file's own `w:id` where it wrote one, carried as
 * metadata for a caller that has to speak to something outside this engine.
 */
export interface ContentControlBoundaryRecord {
  readonly controlId: string;
  readonly type: ContentControlKind;
  readonly level: ContentControlLevel;
  /** 0 for a top-level control; the nesting depth otherwise. */
  readonly depth: number;
  readonly lock: ContentControlLock;
  /** The lock in force here, including every lock an enclosing control imposes. */
  readonly effectiveLock: ContentControlLock;
  readonly showingPlaceholder: boolean;
  readonly temporary: boolean;
  readonly tag?: string;
  readonly alias?: string;
  readonly id?: number;
  /** Preserved `w:dataBinding` metadata. Present means value writes are refused as bound. */
  readonly dataBinding?: ContentControlDataBinding;
  /** Paragraphs the control's content holds, in reading order. */
  readonly paragraphIds: readonly string[];
  /** One rectangle per page the content reaches, in the page's own coordinate space. */
  readonly fragments: readonly ContentControlFragmentRecord[];
}

function boxOf(fragment: BlockFragmentRecord): LayoutBox {
  return fragment.box;
}

/** Every paragraph a fragment covers, so a table fragment answers its cells' paragraphs. */
function fragmentParagraphIds(fragment: BlockFragmentRecord, into: Set<string>): void {
  if (fragment.kind === 'paragraph') {
    into.add(fragment.paragraphId);
    return;
  }
  for (const row of fragment.rows) {
    for (const cell of row.cells) {
      for (const inner of cell.blocks) fragmentParagraphIds(inner, into);
    }
  }
}

/**
 * The paragraph a control's content lives in or holds, by control node id.
 *
 * A BLOCK control answers the paragraphs inside it; an INLINE one answers the paragraph it
 * sits in, because that is the paragraph its characters are addressed against. One walk
 * answers both, tracking the enclosing paragraph as it descends.
 */
function paragraphsByControl(root: OoxmlNode): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (node: OoxmlNode, enclosing: string | null, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_CONTENT_CONTROL_NESTING * 4) return;
    for (const child of node.children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'paragraph') {
        for (const open of openControls) found.get(open)?.push(child.id);
        walk(child, child.id, depth + 1);
        continue;
      }
      if (child.kind === 'contentControl') {
        found.set(child.id, []);
        openControls.push(child.id);
        const content = contentControlContentNodeOf(child);
        if (content) walk(content, enclosing, depth + 1);
        openControls.pop();
        // An inline control holds no paragraph of its own; the one it sits in is its address.
        const own = found.get(child.id);
        if (own && own.length === 0 && enclosing !== null) own.push(enclosing);
        continue;
      }
      walk(child, enclosing, depth + 1);
    }
  };
  const openControls: string[] = [];
  walk(root, null, 0);
  return found;
}

function union(left: LayoutBox, right: LayoutBox): LayoutBox {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(left.x + left.width, right.x + right.width) - x,
    height: Math.max(left.y + left.height, right.y + right.height) - y,
  };
}

/**
 * Derive one boundary record per control the part declares, in document order.
 *
 * A control whose content the layout never placed — one inside a story this layout is not of,
 * or one holding nothing — answers no fragments rather than a zero-sized box at the origin: a
 * rectangle nothing painted is a rectangle a hit test would match.
 */
export function contentControlBoundaries(
  part: OoxmlPart,
  layout: SemanticLayout
): readonly ContentControlBoundaryRecord[] {
  const entries = contentControlsIn(part.root);
  if (entries.length === 0) return EMPTY;

  // Page geometry, indexed by paragraph: one pass over the layout for every control, rather
  // than one walk of the pages per control.
  const boxesByParagraph = new Map<string, { pageIndex: number; box: LayoutBox }[]>();
  layout.pages.forEach((page, pageIndex) => {
    const visit = (fragments: readonly BlockFragmentRecord[]): void => {
      for (const fragment of fragments) {
        const paragraphs = new Set<string>();
        fragmentParagraphIds(fragment, paragraphs);
        for (const paragraphId of paragraphs) {
          const list = boxesByParagraph.get(paragraphId) ?? [];
          list.push({ pageIndex, box: boxOf(fragment) });
          boxesByParagraph.set(paragraphId, list);
        }
      }
    };
    visit(page.fragments);
  });

  const paragraphs = paragraphsByControl(part.root);
  const records: ContentControlBoundaryRecord[] = [];
  for (const entry of entries) {
    const properties = contentControlPropertiesOf(entry.node);
    const chain = [
      ...entry.ancestors.map((ancestor) => contentControlPropertiesOf(ancestor).lock),
      properties.lock,
    ];
    const paragraphIds: readonly string[] = paragraphs.get(entry.node.id) ?? [];

    const byPage = new Map<number, LayoutBox>();
    for (const paragraphId of paragraphIds) {
      for (const placed of boxesByParagraph.get(paragraphId) ?? []) {
        const existing = byPage.get(placed.pageIndex);
        byPage.set(placed.pageIndex, existing ? union(existing, placed.box) : placed.box);
      }
    }
    const fragments = [...byPage.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([pageIndex, box]) => ({ pageIndex, ...box }));

    records.push({
      controlId: entry.node.id,
      type: properties.type,
      level: contentControlLevelOf(entry.node),
      depth: entry.depth,
      lock: properties.lock,
      effectiveLock: resolveContentControlLock(chain),
      showingPlaceholder: properties.showingPlaceholder,
      temporary: properties.temporary,
      ...(properties.tag === undefined ? {} : { tag: properties.tag }),
      ...(properties.alias === undefined ? {} : { alias: properties.alias }),
      ...(properties.id === undefined ? {} : { id: properties.id }),
      ...(properties.dataBinding === undefined ? {} : { dataBinding: properties.dataBinding }),
      paragraphIds,
      fragments,
    });
  }
  return records;
}

const EMPTY: readonly ContentControlBoundaryRecord[] = Object.freeze([]);
