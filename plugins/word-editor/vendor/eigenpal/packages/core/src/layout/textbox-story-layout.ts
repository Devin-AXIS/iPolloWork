// Textbox story layout.
//
// A text-box drawing (`wps:wsp` → `wps:txbx` → `w:txbxContent`) carries a STORY: ordinary
// paragraphs flowed inside the drawing's declared extent — same shape as a footnote story
// ({@link layoutNoteStory}), but bounded by the box instead of the page. The extent height is
// authoritative: content that does not fit clips with a named fallback reason, never grows
// the box. The width is authoritative too, except for unwrapped text (`noWrap`): those lines
// never break at the box edge, and the box takes its widest line plus the insets.
//
// PAGE / NUMPAGES / SECTIONPAGES fields inside the story project through the same
// `pageContext` path the host story uses, so a footer whose page number lives inside an
// anchored text box evaluates per page exactly like a direct footer field. Cached field
// result text is never trusted.
//
// Line / fragment ids are namespaced by drawing node id so the body's incremental
// convergence counter never moves because a textbox changed. All bounds are explicit:
// nesting depth, fragment count, and the extent clip all fail closed with reasons.

import { withFieldResultsProducer } from './field-results-producer.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { emuToPoints } from './drawing-layout.ts';
import { drawingResourceLayoutToken } from './inline-drawing-source.ts';
import { forEachStoryDrawing } from './semantic-record-queries.ts';
import type { FieldPageContext } from './field-projection.ts';
import { framedTokenJoin, type ParagraphLayoutCache } from './layout-cache.ts';
import {
  resolveStoryListItems,
  withNumberingStyleLinks,
  type ResolvedListItem,
} from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { flowBlocksInBox, type HostedStoryFlowDeps } from './semantic-table-layout.ts';
import type { BlockFragmentRecord, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { drawingTextCascade } from './drawing-text-cascade.ts';
import { textboxStoryBlocks } from './story-roots.ts';
import { fitTextboxFrame, textboxContentFrame } from './textbox-frame-layout.ts';
import type { TextboxOutlineProjection } from '../store/package/legacy-vml-textbox-geometry.ts';

/** Layout passes a box that fits its text takes for its line width to settle. */
const MAX_FIT_PASSES = 4;

/** Hard ceiling on textbox-in-textbox story descent (mirrors `MAX_TABLE_NESTING`'s role). */
export const MAX_TEXTBOX_STORY_NESTING = 4;

/**
 * Line measure for the first pass over unwrapped text: the widest page OOXML allows (22in).
 * A line longer than this still breaks here, which keeps every bound fixed.
 */
const UNWRAPPED_MEASURE_PT = 1584;

/** Hard ceiling on fragments emitted for one textbox story. */
export const MAX_TEXTBOX_STORY_FRAGMENTS = 256;

/**
 * Why textbox story layout stopped short.
 *
 * Every one is a BOUND rather than a bug: nesting depth, fragment counts and the extent all
 * come from a file. Falling back with a reason keeps the drawing rendered (clipped) instead
 * of failing the layout pass.
 */
export type TextboxStoryFallbackReason =
  | 'textbox-nesting-limit'
  | 'textbox-fragment-limit'
  /** Flowed content is taller than the extent; trailing fragments were dropped. */
  | 'textbox-height-clip';

/**
 * One text box's story laid out inside its extent, in content-box-relative coordinates.
 *
 * Fragments origin at the content box's top-left; paint places the content box at
 * `drawing origin + contentOffset` and clips to the extent.
 */
export interface TextboxStoryLayout {
  /** Content-box-relative fragments (origin at the content box's top-left). */
  readonly fragments: readonly BlockFragmentRecord[];
  /** Height the blocks flow to (points), before vertical anchoring. */
  readonly flowHeight: number;
  /** Offset of the content box inside the drawing extent: insets plus vertical anchoring. */
  readonly contentOffset: Readonly<{ x: number; y: number }>;
  /** Content box width (extent minus horizontal insets; the widest line when unwrapped). */
  readonly contentWidth: number;
  /**
   * Box width (points) that unwrapped text sizes its shape to: the widest line plus the
   * insets. Placement resolves the shape at this width. Absent when the extent width holds.
   */
  readonly extentWidth?: number;
  /** Box height a story that fits its shape sizes it to; absent when the extent height holds. */
  readonly extentHeight?: number;
  /** Content box height (extent minus vertical insets). */
  readonly contentHeight: number;
  /** Solid fill of the hosting shape, painted behind the story; null for no fill. */
  readonly fillHex: string | null;
  /** Solid outline of the hosting shape; null for no outline. */
  readonly strokeHex: string | null;
  /** Outline width in points; 0 when absent. */
  readonly strokeWidthPt: number;
  /**
   * Clockwise turn of the content box about `pivot`, in drawing-extent points. Absent when
   * the story is upright: vertical text and text that turns with its shape set it.
   */
  readonly contentRotation?: Readonly<{
    degrees: number;
    pivot: Readonly<{ x: number; y: number }>;
  }>;
  /** Shape outline painted instead of a rectangle; absent for a rectangle. */
  readonly outline?: TextboxOutlineProjection;
  /** Clockwise turn of the fill and outline about the extent centre; absent when upright. */
  readonly chromeRotationDegrees?: number;
  /** The outline is centred on the extent edge rather than inside it. */
  readonly strokeCentered?: true;
  /** Outline dash pattern in points; absent for solid. */
  readonly strokeDashPt?: readonly number[];
  /** How outline dashes end; absent for flat ends. */
  readonly strokeCap?: 'round' | 'square';
  /** Shadow colour, opacity and page offset in points. */
  readonly shadow?: Readonly<{
    hex: string;
    alpha: number;
    dx: number;
    dy: number;
    /** The solid silhouette, seen only outside the shape; no text shadow. */
    obscured: boolean;
  }>;
  /** True when layout hit a named bound and returned a truncated / empty story. */
  readonly fallbackReason?: TextboxStoryFallbackReason;
  /** DrawingML shape text: lines past the box paint outside it, not clipped at the drawing. */
  readonly overflowVisible?: true;
  /**
   * The drawing's `vectorShape` paints the box; the fill, outline and shadow fields here only
   * describe it, and painters draw just the text.
   */
  readonly chromeByVector?: true;
  /**
   * Resource identities of the drawings the clip DROPPED, in flow order.
   *
   * The furniture invalidation token walks laid-out records, and a dropped fragment leaves
   * none — while a `withPageContext` projection of the same story can wrap differently
   * (PAGE digits) and keep the drawing. Without this a picture clipped out of the baseline
   * but painted by a projection never reaches the session context, so its decode settling
   * moves nothing and the unchanged-pass early exit reuses the placeholder pages forever
   * (#467). Absent when the clip dropped no drawings, so the common story keys byte-for-byte
   * as before.
   */
  readonly clippedResourceToken?: string;
}

export interface TextboxStoryLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: StyleCascadeTable;
  readonly defaultTabStopPt?: number;
  readonly compatibilityMode?: number;
  /**
   * Widest box, in points, that unwrapped text may grow to: the host column. A longer line
   * wraps at this width less the insets. Absent, unwrapped text grows to its widest line.
   */
  readonly maxUnwrappedBoxWidthPt?: number;
  /** Host story's page-field context; PAGE-family fields inside the story project against it. */
  readonly pageContext?: FieldPageContext;
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
  /** Document properties, for a document-property field inside the text-box story. */
  readonly documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties;
  /** Sanitized hyperlink seams inherited from the story containing this text box. */
  readonly projectLink?: import('./field-pieces.ts').HyperlinkProjector;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
  /** Field-code inspection projection. @internal */
  readonly showFieldCodes?: boolean;
  /** Story nesting depth; a textbox laid out from inside another textbox passes depth + 1. */
  readonly depth?: number;
  /**
   * `numbering.xml`, so a `w:numPr` paragraph in the box resolves a marker.
   *
   * Absent, the story lays out as before: no marker record, and no numbering indent merged
   * into the paragraph's own. Counters are PER BOX ({@link textboxStoryListItems}) — a text
   * box is its own story root, like a note, so its lists restart at `w:start` rather than
   * continuing the host story's.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * Inline drawing context for the part the text box lives in.
   *
   * A picture inside `w:txbxContent` is an ordinary inline drawing of the HOST part — same
   * relationships, same resources — so the host's context is the right one. Scoped to inline
   * drawings: an anchored drawing inside a text box would need frame and exclusion semantics
   * against the box, which is a separate question.
   */
  readonly inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  /** Per-paragraph projection + resource token for the break cache key. */
  readonly drawingTokenForParagraph?: (
    paragraph: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
  /** Host-part semantic projection token for each paragraph in this text-box story. */
  readonly projectionTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Memoized aggregate projection token for a table in this text-box story. */
  readonly projectionTokenForTable?: (table: OoxmlNode) => string;
}

/** Stable line-id namespace for one textbox story. */
export function textboxLineIdPrefix(drawingNodeId: string): string {
  return `txbx-${drawingNodeId}`;
}

/** Stable per-object ids for memo inputs, so a memo never keeps an older input alive. */
let nextInputId = 1;
const inputIds = new WeakMap<object, number>();
function inputId(input: object | undefined): number {
  if (input === undefined) return 0;
  let id = inputIds.get(input);
  if (id === undefined) {
    id = nextInputId;
    nextInputId += 1;
    inputIds.set(input, id);
  }
  return id;
}

/**
 * Inputs are held as ids, not objects: the undo history keeps old nodes alive, and a memo on
 * each holding its numbering index kept one whole index per revision.
 */
interface TextboxStoryListResolve {
  readonly rawIndex: number;
  readonly styleCascade: number;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: number;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
}

/**
 * Memoized per immutable `w:txbxContent` node, validated against the RAW inputs by identity.
 * Sound because any edit inside the box republishes the content node; a numbering or cascade
 * change keeps the node and misses on the input compare instead.
 */
const textboxStoryListResolves = new WeakMap<OoxmlNode, TextboxStoryListResolve>();

/**
 * Resolve every list paragraph of one text-box story, keyed by paragraph node id.
 *
 * Counters are created fresh per box — a text box is its own story root laid out
 * independently of its host (the {@link textboxStoryBlocks} rule), so its lists restart at
 * `w:start` the way a header's or a note's do, rather than continuing the host story's.
 * Returns undefined when numbering is absent or the box holds no list paragraphs.
 */
export function textboxStoryListItems(
  content: OoxmlNode,
  numberingIndex: NumberingIndex | undefined,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): ReadonlyMap<string, ResolvedListItem> | undefined {
  if (!numberingIndex || numberingIndex.nums.size === 0) return undefined;
  const memo = textboxStoryListResolves.get(content);
  if (
    memo &&
    memo.rawIndex === inputId(numberingIndex) &&
    memo.styleCascade === inputId(styleCascade) &&
    memo.displayMode === displayMode &&
    memo.authorFilter === inputId(authorFilter)
  ) {
    return memo.listItems;
  }
  const linked = withNumberingStyleLinks(numberingIndex, styleCascade);
  const blocks = textboxStoryBlocks(content, displayMode, authorFilter);
  const resolved = resolveStoryListItems(blocks, linked, styleCascade);
  const listItems = resolved.size > 0 ? resolved : undefined;
  textboxStoryListResolves.set(content, {
    rawIndex: inputId(numberingIndex),
    styleCascade: inputId(styleCascade),
    displayMode,
    authorFilter: inputId(authorFilter),
    listItems,
  });
  return listItems;
}

/** Hard ceiling on nodes visited when discovering `w:txbxContent` under one block. */
const MAX_HOSTED_STORY_SCAN_NODES = 20_000;

/** Bounded text-box story discovery used by layout and export font provisioning. @internal */
export interface HostedContentsScan {
  readonly contents: readonly OoxmlNode[];
  /** True when the budget stopped the walk before the whole subtree was seen. */
  readonly truncated: boolean;
}

const NO_HOSTED_CONTENTS: HostedContentsScan = Object.freeze({
  contents: Object.freeze([]),
  truncated: false,
});

/**
 * The `w:txbxContent` nodes a block hosts — a TREE fact, memoized per immutable block node.
 *
 * Found by name rather than through drawing projections, so an `mc:Fallback` twin of a live
 * box is included too; its list state mirrors the live copy's, which only widens the token
 * below, never wrongs it. No descent INTO a found content: a box inside a box does not lay
 * out (nested stories degrade to the placeholder path), so its list state paints nothing.
 */
const hostedTextboxContentsByBlock = new WeakMap<OoxmlNode, HostedContentsScan>();

/** The allocation-light path for the overwhelmingly common non-table block. */
function scanHostedTextboxContents(block: OoxmlNode): HostedContentsScan {
  const found: OoxmlNode[] = [];
  let visited = 0;
  let truncated = false;
  const stack: OoxmlNode[] = [block];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visited += 1;
    if (visited > MAX_HOSTED_STORY_SCAN_NODES) {
      truncated = true;
      break;
    }
    if (node.kind !== 'textValue' && node.localName === 'txbxContent') {
      found.push(node);
      continue;
    }
    if (!('children' in node)) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return found.length > 0 || truncated
    ? Object.freeze({ contents: Object.freeze(found), truncated })
    : NO_HOSTED_CONTENTS;
}

/** Discover text-box stories hosted by one layout block. @internal */
export function hostedTextboxContents(block: OoxmlNode): HostedContentsScan {
  const cached = hostedTextboxContentsByBlock.get(block);
  if (cached) return cached;
  // Only a table-level scan is followed by cold scans of many descendant cell paragraphs.
  // Preserve the raw-node stack for direct paragraph calls instead of paying a frame object
  // per visited node where there are no descendant paragraph results to seed.
  if (block.kind !== 'table') {
    const scan = scanHostedTextboxContents(block);
    hostedTextboxContentsByBlock.set(block, scan);
    return scan;
  }
  const found: OoxmlNode[] = [];
  let visited = 0;
  let truncated = false;
  interface ParagraphScan {
    readonly paragraph: OoxmlNode;
    readonly contents: OoxmlNode[];
  }
  type ScanFrame =
    | {
        readonly phase: 'enter';
        readonly node: OoxmlNode;
        readonly paragraphOwners: readonly ParagraphScan[];
      }
    | { readonly phase: 'exit-paragraph'; readonly scan: ParagraphScan };
  const stack: ScanFrame[] = [{ phase: 'enter', node: block, paragraphOwners: [] }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.phase === 'exit-paragraph') {
      if (!hostedTextboxContentsByBlock.has(frame.scan.paragraph)) {
        hostedTextboxContentsByBlock.set(
          frame.scan.paragraph,
          frame.scan.contents.length > 0
            ? Object.freeze({
                contents: Object.freeze(frame.scan.contents),
                truncated: false,
              })
            : NO_HOSTED_CONTENTS
        );
      }
      continue;
    }
    const node = frame.node;
    visited += 1;
    // Defensive, like every other file-derived walk — but a stopped scan can MISS a box, and
    // an unseen box's list state must fail OPEN, not stale. The truncation flag is recorded
    // so the token below stops naming individual items and keys on the numbering index
    // itself: every numbering edit then re-lays the block, which wastes work on a hostile
    // file but never reuses a page showing an old marker.
    if (visited > MAX_HOSTED_STORY_SCAN_NODES) {
      truncated = true;
      break;
    }
    if (node.kind !== 'textValue' && node.localName === 'txbxContent') {
      found.push(node);
      for (const owner of frame.paragraphOwners) owner.contents.push(node);
      continue;
    }
    if (!('children' in node)) continue;
    let paragraphOwners = frame.paragraphOwners;
    if (node.kind === 'paragraph') {
      const paragraphScan: ParagraphScan = { paragraph: node, contents: [] };
      paragraphOwners = Object.freeze([...paragraphOwners, paragraphScan]);
      stack.push({ phase: 'exit-paragraph', scan: paragraphScan });
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ phase: 'enter', node: node.children[index]!, paragraphOwners });
    }
  }
  const scan: HostedContentsScan =
    found.length > 0 || truncated
      ? Object.freeze({ contents: Object.freeze(found), truncated })
      : NO_HOSTED_CONTENTS;
  hostedTextboxContentsByBlock.set(block, scan);
  return scan;
}

/**
 * Stable per-object identity of a numbering index, for the truncated-scan token arm.
 *
 * A truncated scan cannot name the items it missed, so its token names the INDEX instead:
 * any `numbering.xml` edit yields a new index object, a new id, and a changed key. Ids only
 * grow with distinct index objects ever tokenized this way — a handful per document life.
 */
let nextNumberingIndexTokenId = 1;
const numberingIndexTokenIds = new WeakMap<NumberingIndex, number>();

function numberingIndexTokenId(index: NumberingIndex): number {
  let id = numberingIndexTokenIds.get(index);
  if (id === undefined) {
    id = nextNumberingIndexTokenId;
    nextNumberingIndexTokenId += 1;
    numberingIndexTokenIds.set(index, id);
  }
  return id;
}

/** Inputs are held as ids, like {@link TextboxStoryListResolve}. */
interface HostedListTokenMemo {
  readonly rawIndex: number;
  readonly styleCascade: number;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: number;
  readonly token: string;
}

const hostedListTokensByBlock = new WeakMap<OoxmlNode, HostedListTokenMemo>();

/**
 * Marker identity of every list item the text-box stories UNDER one block paint.
 *
 * The list sibling of the hosted-story arm of `drawingTokenForParagraph`, for the same
 * reason: a box's markers come from `numbering.xml`, a DIFFERENT part from the one the host
 * paragraph lives in, so a numbering edit moves neither the paragraph node nor its drawing
 * token — and a flow key without this reuses pages showing the old number inside the box.
 * Empty for the overwhelmingly common block with no text box, at the cost of one memoized
 * subtree scan per immutable block node.
 */
function hostedTextboxListToken(
  block: OoxmlNode,
  numberingIndex: NumberingIndex,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): string {
  if (numberingIndex.nums.size === 0) return '';
  const scan = hostedTextboxContents(block);
  if (scan.contents.length === 0 && !scan.truncated) return '';
  const memo = hostedListTokensByBlock.get(block);
  if (
    memo &&
    memo.rawIndex === inputId(numberingIndex) &&
    memo.styleCascade === inputId(styleCascade) &&
    memo.displayMode === displayMode &&
    memo.authorFilter === inputId(authorFilter)
  ) {
    return memo.token;
  }
  const parts: string[] = [];
  for (const content of scan.contents) {
    const items = textboxStoryListItems(
      content,
      numberingIndex,
      styleCascade,
      displayMode,
      authorFilter
    );
    if (!items) continue;
    for (const [paragraphId, item] of items) {
      parts.push(framedTokenJoin([paragraphId, item.cacheToken]));
    }
  }
  // A truncated scan may have MISSED a box, so it cannot vouch for "no list state": key on
  // the index identity instead, which fails open — every numbering edit moves the key.
  if (scan.truncated) parts.push(`truncated:${numberingIndexTokenId(numberingIndex)}`);
  // Length-framed: `cacheToken` embeds `w:lvlText`, which a file can fill with any
  // separator, so a separator join would let two different hosted list states concatenate
  // to one token and hold a break key still across a numbering edit.
  const token = parts.length === 0 ? '' : `|txbxlist:${framedTokenJoin(parts)}`;
  hostedListTokensByBlock.set(block, {
    rawIndex: inputId(numberingIndex),
    styleCascade: inputId(styleCascade),
    displayMode,
    authorFilter: inputId(authorFilter),
    token,
  });
  return token;
}

/**
 * Build the structurally coupled hosted-story capability for a table flow lane.
 *
 * The layout callback and list-token provider are returned together so a new lane cannot
 * publish text-box stories while silently reusing stale host breaks after numbering changes.
 * `null` without numbering definitions preserves the zero-call fast path for box-free cells.
 */
export function hostedStoryFlowDeps(
  layoutTextboxStoryFor: HostedStoryFlowDeps['layoutTextboxStoryFor'],
  numberingIndex: NumberingIndex | undefined,
  styleCascade: StyleCascadeTable | undefined,
  displayMode?: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): HostedStoryFlowDeps {
  return Object.freeze({
    layoutTextboxStoryFor,
    hostedListTokenForParagraph:
      !numberingIndex || numberingIndex.nums.size === 0
        ? null
        : (paragraph: OoxmlNode) =>
            hostedTextboxListToken(
              paragraph,
              numberingIndex,
              styleCascade,
              displayMode,
              authorFilter
            ),
  });
}

/**
 * Dash and gap lengths in points for a pattern in outline widths. A round or square cap adds
 * half a width at each dash end, so each dash keeps its length with the caps included: its core
 * shortens by one width and the gap after it grows by one.
 */
function dashLengths(
  pattern: readonly number[],
  strokeWidthPt: number,
  cap: 'round' | 'square' | undefined
): readonly number[] {
  const width = Math.max(0.5, strokeWidthPt);
  return pattern.map((length, index) => {
    const points = length * width;
    if (!cap) return points;
    return index % 2 === 0 ? Math.max(0, points - width) : points + width;
  });
}

/**
 * Lay a drawing's textbox story out inside its extent.
 *
 * Returns null when the projection carries no textbox story. Never throws: bound hits
 * produce a truncated layout with a named {@link TextboxStoryFallbackReason}.
 */
export function layoutTextboxStory(
  projection: DrawingProjection,
  options: TextboxStoryLayoutOptions
): TextboxStoryLayout | null {
  const story = projection.textboxStory;
  if (!story) return null;

  const extentWidth = emuToPoints(projection.extentEmu.cx);
  const extentHeight = emuToPoints(projection.extentEmu.cy);
  const strokeWidthPt = emuToPoints(story.strokeWidthEmu);
  // The outline is centered on the shape edge, so its inner half also insets the text; an
  // inset pen lies wholly inside and insets it by its full width.
  const outlineInset =
    story.strokeHex !== null ? (story.strokeInset ? strokeWidthPt : strokeWidthPt / 2) : 0;
  // A legacy shape's text area sits inside its outline: an oval, a round rectangle, a preset.
  const legacy = story.legacyFrame;
  const area = legacy?.textAreaEmu;
  const insetLeft = emuToPoints(story.insetsEmu.left + (area?.left ?? 0)) + outlineInset;
  const insetRight = emuToPoints(story.insetsEmu.right + (area?.right ?? 0)) + outlineInset;
  const insetTop = emuToPoints(story.insetsEmu.top + (area?.top ?? 0)) + outlineInset;
  const insetBottom = emuToPoints(story.insetsEmu.bottom + (area?.bottom ?? 0)) + outlineInset;
  const frame = textboxContentFrame(
    extentWidth,
    extentHeight,
    { top: insetTop, right: insetRight, bottom: insetBottom, left: insetLeft },
    legacy
  );
  const extentContentWidth = frame.width;
  const contentHeight = frame.height;

  const chrome = {
    fillHex: story.fillHex,
    strokeHex: story.strokeHex,
    strokeWidthPt,
    contentWidth: extentContentWidth,
    contentHeight,
    ...(frame.rotationDegrees
      ? { contentRotation: { degrees: frame.rotationDegrees, pivot: frame.pivot } }
      : {}),
    ...(legacy?.outline ? { outline: legacy.outline } : {}),
    ...(legacy?.rotationDegrees ? { chromeRotationDegrees: legacy.rotationDegrees } : {}),
    ...(story.strokeCentered ? { strokeCentered: true as const } : {}),
    ...(story.chromeByVector ? { chromeByVector: true as const } : {}),
    ...(story.strokeCap && story.strokeHex !== null ? { strokeCap: story.strokeCap } : {}),
    ...(story.strokeDash && story.strokeHex !== null
      ? { strokeDashPt: dashLengths(story.strokeDash, strokeWidthPt, story.strokeCap) }
      : {}),
    ...(story.shadow
      ? {
          shadow: {
            hex: story.shadow.hex,
            alpha: story.shadow.alpha,
            dx: emuToPoints(story.shadow.offsetXEmu),
            dy: emuToPoints(story.shadow.offsetYEmu),
            obscured: story.shadow.obscured,
          },
        }
      : {}),
  };

  // A shape whose text area hides its text paints the shape alone.
  if (legacy?.textHidden)
    return { fragments: [], flowHeight: 0, contentOffset: { x: frame.x, y: frame.y }, ...chrome };

  const depth = options.depth ?? 0;
  if (depth >= MAX_TEXTBOX_STORY_NESTING) {
    // No clipped-resource token here: past the ceiling nothing is flowed, so no projection
    // can paint these drawings either. If nested box rendering ever ships, this return must
    // name the story's resources too, or the #467 pattern recurs one level down.
    return {
      fragments: [],
      flowHeight: 0,
      contentOffset: { x: frame.x, y: frame.y },
      ...chrome,
      fallbackReason: 'textbox-nesting-limit',
    };
  }

  // Lowered DrawingML text lays out under its own cascade: no document styles or defaults.
  const styleCascade = story.drawingText
    ? drawingTextCascade(options.styleCascade)
    : options.styleCascade;
  const blocks: readonly OoxmlElement[] = textboxStoryBlocks(
    story.content,
    options.displayMode,
    options.revisionAuthorFilter
  );
  const listItems = textboxStoryListItems(
    story.content,
    options.numberingIndex,
    styleCascade,
    options.displayMode,
    options.revisionAuthorFilter
  );
  const prefix = textboxLineIdPrefix(projection.drawingNodeId);
  let lineCounter = 0;

  // Every pass numbers its lines from zero, so line ids do not depend on the pass count.
  const flowAt = (width: number) => (
    (lineCounter = 0),
    flowBlocksInBox(blocks, 0, width, 0, 0, {
      measurer: options.measurer,
      cache: options.cache,
      producer: `${withFieldResultsProducer(options.producer)}${options.showFieldCodes ? '|field-codes' : ''}|txbx:${projection.drawingNodeId}`,
      nextLineId: () => `${prefix}-line-${lineCounter++}`,
      styleCascade,
      ...(listItems ? { listItems } : {}),
      ...(options.pageContext ? { pageContext: options.pageContext } : {}),
      ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
      ...(options.projectLink ? { projectLink: options.projectLink } : {}),
      ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
      showFieldCodes: options.showFieldCodes,
      compatibilityMode: options.compatibilityMode,
      tableNestingOffset: 1,
      textBoxStory: true,
      ...(options.defaultTabStopPt !== undefined
        ? { defaultTabStopPt: options.defaultTabStopPt }
        : {}),
      ...(options.displayMode ? { displayMode: options.displayMode } : {}),
      ...(options.revisionAuthorFilter
        ? { revisionAuthorFilter: options.revisionAuthorFilter }
        : {}),
      ...(options.inlineDrawingLayout ? { inlineDrawingLayout: options.inlineDrawingLayout } : {}),
      ...(options.drawingTokenForParagraph
        ? { drawingTokenForParagraph: options.drawingTokenForParagraph }
        : {}),
      ...(options.projectionTokenForParagraph
        ? { projectionTokenForParagraph: options.projectionTokenForParagraph }
        : {}),
      ...(options.projectionTokenForTable
        ? { projectionTokenForTable: options.projectionTokenForTable }
        : {}),
    })
  );

  // Unwrapped text lays out once at an unbounded measure to find its widest line, then again
  // at that width, so paragraph alignment places each line inside the widest line's column.
  // An inline box keeps its extent: the host line already reserved that advance, so a box
  // that grew here would paint and hit-test outside the space its line gave it.
  // A turned frame keeps its extent: its line width comes from the box's other side.
  const noWrap =
    story.noWrap === true &&
    projection.wrap !== 'inline' &&
    !frame.rotationDegrees &&
    !(legacy && legacy.rotationDegrees !== 0);
  let contentWidth = extentContentWidth;
  let flow = flowAt(noWrap ? UNWRAPPED_MEASURE_PT : contentWidth);
  const widestUnwrapped = noWrap ? widestLineWidth(flow.blocks) : 0;
  const unwrappedWidth =
    options.maxUnwrappedBoxWidthPt === undefined
      ? widestUnwrapped
      : Math.min(
          widestUnwrapped,
          Math.max(1, options.maxUnwrappedBoxWidthPt - insetLeft - insetRight)
        );
  if (unwrappedWidth > 0) {
    contentWidth = unwrappedWidth;
    flow = flowAt(contentWidth);
  } else if (noWrap) {
    flow = flowAt(contentWidth);
  }

  // A box that fits its text takes the text's height, or its width when the text runs
  // vertically; it never clips or anchors. A legacy box keeps its extent when it is inline or
  // turned; a DrawingML box fits there too, and its line reserves the fitted size
  // (`withFittedInlineTextboxes`).
  const fits =
    story.fitHeightToText === true &&
    (story.drawingFit === true || (projection.wrap !== 'inline' && !legacy?.rotationDegrees));
  const fitFor = (height: number) =>
    fitTextboxFrame(
      height,
      extentWidth,
      extentHeight,
      { top: insetTop, right: insetRight, bottom: insetBottom, left: insetLeft },
      {
        top: emuToPoints(area?.top ?? 0),
        right: emuToPoints(area?.right ?? 0),
        bottom: emuToPoints(area?.bottom ?? 0),
        left: emuToPoints(area?.left ?? 0),
      },
      legacy
    );
  let fit = fits ? fitFor(flow.bottom) : undefined;
  // A text area that follows the fitted size can change the line width: the story lays out
  // again at the new width and the box fits that layout, until the width holds. The passes are
  // bounded; the last one's width and frame stay together.
  for (
    let pass = 0;
    fit &&
    unwrappedWidth === 0 &&
    pass < MAX_FIT_PASSES &&
    Math.abs(fit.frame.width - contentWidth) > 0.01;
    pass++
  ) {
    contentWidth = fit.frame.width;
    flow = flowAt(contentWidth);
    fit = fitFor(flow.bottom);
  }
  let fragments = flow.blocks;
  let flowHeight = flow.bottom;
  let fallbackReason: TextboxStoryFallbackReason | undefined;
  const clippedResourceTokens: string[] = [];

  if (fragments.length > MAX_TEXTBOX_STORY_FRAGMENTS) {
    collectDrawingResourceTokens(
      fragments.slice(MAX_TEXTBOX_STORY_FRAGMENTS),
      clippedResourceTokens
    );
    fragments = fragments.slice(0, MAX_TEXTBOX_STORY_FRAGMENTS);
    const last = fragments[fragments.length - 1];
    flowHeight = last ? last.box.y + last.box.height : 0;
    fallbackReason = 'textbox-fragment-limit';
  }

  // Word clips overflow at the box. Keep fragments that START inside the content height so a
  // partially visible line still paints (the container clips precisely); drop fully-below ones.
  // DrawingML shape text does not clip: lines past the box keep painting around it.
  const overflows = story.drawingText === true;
  if (fit === undefined && !overflows && flowHeight > contentHeight + 0.001) {
    const kept = fragments.filter((fragment) => fragment.box.y < contentHeight - 0.001);
    if (kept.length < fragments.length) {
      collectDrawingResourceTokens(
        fragments.filter((fragment) => fragment.box.y >= contentHeight - 0.001),
        clippedResourceTokens
      );
      fragments = kept;
      fallbackReason = fallbackReason ?? 'textbox-height-clip';
    }
  }

  // Vertical anchoring positions the flowed content inside the box; overflow pins to the top
  // (offsets never go negative, matching Word's clip-from-top behaviour).
  const slack =
    fit === undefined
      ? overflows
        ? contentHeight - flowHeight
        : Math.max(0, contentHeight - flowHeight)
      : 0;
  const anchorOffset =
    story.verticalAnchor === 'center' ? slack / 2 : story.verticalAnchor === 'bottom' ? slack : 0;

  return {
    fragments,
    flowHeight,
    contentOffset: fit
      ? { x: fit.frame.x, y: fit.frame.y }
      : { x: frame.x, y: frame.y + anchorOffset },
    ...chrome,
    // An overflowing DrawingML story reports the box its lines cover, so paint keeps them.
    ...(overflows && fit === undefined
      ? { contentHeight: Math.max(contentHeight, flowHeight), overflowVisible: true as const }
      : {}),
    contentWidth,
    ...(unwrappedWidth > 0 ? { extentWidth: unwrappedWidth + insetLeft + insetRight } : {}),
    ...(fit
      ? {
          contentHeight: fit.frame.height,
          ...(fit.frame.rotationDegrees
            ? {
                contentRotation: { degrees: fit.frame.rotationDegrees, pivot: fit.frame.pivot },
              }
            : {}),
          ...(fit.extentWidth !== undefined ? { extentWidth: fit.extentWidth } : {}),
          ...(fit.extentHeight !== undefined ? { extentHeight: fit.extentHeight } : {}),
        }
      : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(clippedResourceTokens.length > 0
      ? // Length-framed — resource keys embed file-derived ids, so any separator boundary
        // is forgeable, and this token is spliced into another framed list upstream.
        { clippedResourceToken: framedTokenJoin(clippedResourceTokens) }
      : {}),
  };
}

/**
 * The width unwrapped paragraph lines need: each line's content extent plus its paragraph's
 * start and end indents, with the first-line offset (hanging wins over firstLine) on the
 * paragraph's first line only. Indents are direction-free sums, so RTL needs no mirror.
 * Zero when no line holds content, so the extent width holds. Other blocks reflow inside.
 */
function widestLineWidth(blocks: readonly BlockFragmentRecord[]): number {
  let widest = 0;
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const { left, right: end, firstLine, hanging } = block.indent;
    const firstLineOffset = hanging > 0 ? -hanging : firstLine;
    block.lines.forEach((line, index) => {
      let right = Number.NEGATIVE_INFINITY;
      for (const span of line.spans) right = Math.max(right, span.box.x + span.box.width);
      for (const drawing of line.drawings ?? []) {
        right = Math.max(right, drawing.x + drawing.width);
      }
      if (!Number.isFinite(right) || right <= line.contentX) return;
      const opensParagraph = index === 0 && block.fragmentIndex === 0;
      const start = left + (opensParagraph ? firstLineOffset : 0);
      // A list marker is furniture, not a span, but it opens the line at the hanging slot.
      const markerX = opensParagraph ? block.marker?.box.x : undefined;
      const origin = markerX === undefined ? line.contentX : Math.min(line.contentX, markerX);
      widest = Math.max(widest, start + right - origin + end);
    });
  }
  // A hair of slack so the second pass, at exactly this width, cannot break a line on rounding.
  return widest > 0 ? Math.min(UNWRAPPED_MEASURE_PT, widest + 0.01) : 0;
}

/**
 * Resource tokens of the drawings in clip-dropped fragments.
 *
 * The SAME walk the furniture token uses over kept records, so a new drawing channel can
 * never reach one side of the painted-plus-clipped invariant and not the other.
 */
function collectDrawingResourceTokens(
  blocks: readonly BlockFragmentRecord[],
  tokens: string[]
): void {
  forEachStoryDrawing({ fragments: blocks }, (drawing) => {
    tokens.push(drawingResourceLayoutToken(drawing.resource));
  });
}
