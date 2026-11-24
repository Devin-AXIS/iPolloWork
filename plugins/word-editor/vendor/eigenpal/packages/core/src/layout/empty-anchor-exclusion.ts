import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { synthesizeParagraphWrapExclusionZones, type ExclusionZone } from './drawing-exclusion.ts';
import type { RevisionDisplayMode, RevisionAuthorFilter } from './revision-projection.ts';

/** Resolve leading paragraph anchors on the prospective sheet before their text moves there. */
export function withOwnParagraphAnchorZones(
  zones: readonly ExclusionZone[],
  paragraph: OoxmlElement,
  drawings: InlineDrawingLayoutContext | undefined,
  frameBase: () => BodyAnchorFrameBase,
  top: number,
  left: number,
  right: number,
  columnIndex: number,
  startOffset: number,
  paragraphSpaceBefore: number,
  compatibilityMode: number | undefined,
  displayMode: RevisionDisplayMode,
  revisionAuthorFilter?: RevisionAuthorFilter,
  layoutTextboxStory?: TextboxStoryLayouter
): readonly ExclusionZone[] {
  if (
    startOffset !== 0 ||
    !drawings ||
    paragraph.kind !== 'paragraph' ||
    !hasCompatibilityRule(compatibilityMode, 'anchorOnlyParagraphWrapExclusion')
  )
    return zones;
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, drawings);
  if (!atoms.length) return zones;
  const offsets = drawingModelOffsetsInParagraph(paragraph);
  const anchorOnly = paragraphOffsetIndex(paragraph).length === atoms.length;
  // A leading paragraph-relative object has a known origin before the first line wraps.
  // Reusing its previous page band can leave the moved text underneath its new position.
  const leading = atoms.some((atom) => {
    const vertical = atom.projection.position?.vertical;
    return (
      offsets.get(atom.atomId) === 0 &&
      vertical?.relativeFrom === 'paragraph' &&
      vertical.align === null &&
      (vertical.offsetEmu ?? 0) >= 0
    );
  });
  if (!anchorOnly && !leading) return zones;
  const ownStarts = anchorOnly ? [...offsets.values()] : [0];
  const paragraphStarts = new Set(
    atoms
      .filter((atom) => atom.projection.position?.vertical.relativeFrom === 'paragraph')
      .map((atom) => offsets.get(atom.atomId))
  );
  const own = synthesizeParagraphWrapExclusionZones({
    paragraph,
    paragraphId: paragraph.id,
    drawingLayout: drawings,
    frameBase: frameBase(),
    contentLeft: left,
    contentRight: right,
    paragraphStartY: top,
    // Paragraph anchors measure from above the applied spacing; line anchors do not.
    anchorLineTopByModelStart: new Map(
      ownStarts.map((offset) => [offset, paragraphStarts.has(offset) ? -paragraphSpaceBefore : 0])
    ),
    displayMode,
    revisionAuthorFilter,
    ...(layoutTextboxStory ? { layoutTextboxStory } : {}),
  });
  const replaced = new Set(own.map((zone) => zone.drawingNodeId));
  return [
    ...zones.filter(
      (zone) =>
        zone.anchorParagraphId !== paragraph.id ||
        zone.input.mode === 'topAndBottom' ||
        (!anchorOnly && !replaced.has(zone.drawingNodeId))
    ),
    ...own.map((zone) => ({ ...zone, columnIndex })),
  ];
}
