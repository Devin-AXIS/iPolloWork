import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { pointsDigest, vectorShapeLayoutToken } from './drawing-geometry-digest.ts';
import { groupPictureLayoutToken } from './drawing-group-picture-layers.ts';
import { framedTokenJoin } from './framed-token.ts';
import { groupTextboxesLayoutToken } from './group-textbox-layout.ts';
import { textboxLayoutToken } from './textbox-layout-token.ts';

/** Every projection field that moves drawing layout, length-framed into one token. */
export function drawingProjectionLayoutToken(projection: DrawingProjection): string {
  const position = projection.position;
  const anchor = projection.anchor;
  const picture = projection.picture;
  const wrap = projection.wrapGeometry;
  const vector = projection.vectorShape;
  const groupPicture = projection.groupPicture;
  // Length-framed (`framedTokenJoin`): relationship ids, part names, and preset geometry
  // are verbatim file values, so a printable field separator would let two different
  // picture references serialize to one token — and `isCompatibleWith` compares
  // projections by this token alone when the resource substrate is unchanged.
  // This also validates retained projections used by paint and drawing controls. Every
  // top-level field needs a token decision, including diagnostics used for placeholders.
  const fields = {
    drawingNodeId: projection.drawingNodeId,
    ownerPartName: projection.ownerPartName,
    kind: projection.kind,
    diagnostics: framedTokenJoin(
      projection.diagnostics.map((diagnostic) =>
        framedTokenJoin([diagnostic.code, diagnostic.nodeId, diagnostic.detail ?? ''])
      )
    ),
    relationshipId: projection.relationshipId ?? '',
    docPrId: String(projection.docPrId ?? ''),
    name: projection.name,
    title: projection.title,
    description: projection.description,
    hyperlinkHref: projection.hyperlinkHref ?? '',
    hidden: String(projection.hidden),
    extentEmu: framedTokenJoin([String(projection.extentEmu.cx), String(projection.extentEmu.cy)]),
    effectExtentEmu: framedTokenJoin([
      String(projection.effectExtentEmu.top),
      String(projection.effectExtentEmu.right),
      String(projection.effectExtentEmu.bottom),
      String(projection.effectExtentEmu.left),
    ]),
    inlineDistancesEmu: framedTokenJoin([
      String(projection.inlineDistancesEmu.top),
      String(projection.inlineDistancesEmu.right),
      String(projection.inlineDistancesEmu.bottom),
      String(projection.inlineDistancesEmu.left),
    ]),
    wrap: projection.wrap,
    textboxStory: projection.textboxStory ? textboxLayoutToken(projection.textboxStory) : '',
    groupTextboxes: groupTextboxesLayoutToken(projection.groupTextboxes),
    chartSummary: projection.chartSummary
      ? framedTokenJoin([
          projection.chartSummary.title ?? '',
          projection.chartSummary.shownAs,
          ...projection.chartSummary.plotTypes,
        ])
      : '',
    chartFallbackPicture: framedTokenJoin([
      projection.chartFallbackPicture?.embeddedRelationshipId ?? '',
      projection.chartFallbackPicture?.linkedRelationshipId ?? '',
    ]),
    compatibilityBranchNodeId: projection.compatibilityBranchNodeId ?? '',
    footprintOnly: projection.footprintOnly ? 'footprint' : '',
    anchor: anchor
      ? framedTokenJoin([
          String(anchor.simplePos),
          String(anchor.relativeHeight),
          String(anchor.layoutInCell),
          String(anchor.allowOverlap),
          String(anchor.behindDocument),
        ])
      : '',
    locks: framedTokenJoin([
      String(projection.locks.select),
      String(projection.locks.move),
      String(projection.locks.resize),
      String(projection.locks.changeAspect),
    ]),
    effects: framedTokenJoin([
      String(projection.effects.grayscale),
      String(projection.effects.brightness),
      String(projection.effects.contrast),
      String(projection.effects.bilevel ?? ''),
    ]),
    picture: picture
      ? framedTokenJoin([
          String(picture.crop.left),
          String(picture.crop.top),
          String(picture.crop.right),
          String(picture.crop.bottom),
          String(picture.transform.rotationDegrees),
          String(picture.transform.flipHorizontal),
          String(picture.transform.flipVertical),
          String(picture.transform.offsetEmu.x),
          String(picture.transform.offsetEmu.y),
          String(picture.transform.extentEmu.cx),
          String(picture.transform.extentEmu.cy),
          picture.embeddedRelationshipId ?? '',
          picture.linkedRelationshipId ?? '',
          picture.presetGeometry ?? '',
          picture.clipUnit?.map((point) => `${point.x},${point.y}`).join(' ') ?? '',
          picture.frameEffects ? JSON.stringify(picture.frameEffects) : '',
          picture.fillMode,
        ])
      : '',
    groupPicture: groupPicture ? groupPictureLayoutToken(groupPicture) : '',
    groupPictureLayers: framedTokenJoin(
      (projection.groupPictureLayers ?? []).map(groupPictureLayoutToken)
    ),
    legacyGraphic: projection.legacyGraphic ? JSON.stringify(projection.legacyGraphic) : '',
    textArt: JSON.stringify(projection.textArt) ?? '',
    horizontalRule: JSON.stringify(projection.horizontalRule) ?? '',
    vectorShape: vector ? vectorShapeLayoutToken(vector) : '',
    wrapGeometry: wrap
      ? framedTokenJoin([
          wrap.element,
          wrap.textSide,
          String(wrap.distancesEmu.top),
          String(wrap.distancesEmu.right),
          String(wrap.distancesEmu.bottom),
          String(wrap.distancesEmu.left),
          String(wrap.polygon.length),
          pointsDigest(wrap.polygon),
        ])
      : '',
    position: position
      ? framedTokenJoin([
          position.horizontal.relativeFrom,
          position.horizontal.align ?? '',
          String(position.horizontal.offsetEmu ?? ''),
          position.vertical.relativeFrom,
          position.vertical.align ?? '',
          String(position.vertical.offsetEmu ?? ''),
          String(position.simplePosition.xEmu),
          String(position.simplePosition.yEmu),
        ])
      : '',
  } satisfies Record<keyof DrawingProjection, string>;
  return framedTokenJoin(Object.values(fields));
}
