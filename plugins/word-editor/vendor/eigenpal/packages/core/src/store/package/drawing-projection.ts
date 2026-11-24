import { stylesPartOf } from './ooxml-indexes.ts';
import type { DrawingChartSummary } from './chart-summary.ts';
import { projectLegacyVml, type LegacyGraphicProjection } from './legacy-vml-projection.ts';
import { projectMcDrawingContent } from './mc-drawing-content.ts';
// Bounded semantic projection for typed `w:drawing` nodes and run-level MC wrappers (task 3).
//
// Reads the canonical tree without mutating it. `mc:AlternateContent` branch selection is
// projection-only — every authored branch stays in the tree on save.

import { sanitizeHref } from './sinks.ts';
import { readDistances } from './drawing-distances.ts';
import { readBlipEffects, type DrawingImageEffects } from './drawing-image-effects.ts';
import { freezeVectorShapeComponent } from './drawing-vector-freeze.ts';
import { hostsTextboxStory } from './group-textbox-projection.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import { HYPERLINK_RELATIONSHIP_TYPE, type RelationshipTargetResolver } from './hyperlink.ts';
import { resolveRelationship } from './relationships.ts';
import { mergedDrawingLocks, shapeLocksOf } from './drawing-shape-locks.ts';
import {
  MAX_XML_DEPTH,
  ST_COORDINATE_MAX,
  ST_COORDINATE_MIN,
  ST_POSITION_OFFSET_MAX,
  ST_POSITION_OFFSET_MIN,
  schemaAttributeValue,
  parseSchemaBoolean,
} from './ooxml-drawing-rules.ts';
import {
  createWalkState,
  emptyNamespaceScope,
  findDirectKind,
  isElement,
  isMcAlternateContent,
  isMcChoice,
  isMcFallback,
  namespaceScopeForNode,
  type DrawingDiagnostic,
  type DrawingProjectionLimits,
  type WalkState,
} from './drawing-projection-walk.ts';
import { readWrapPolygon as readPolygon } from './drawing-wrap-polygon.ts';
import {
  MC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
} from './ooxml-shared.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import { readEffectExtentFromNode, readExtent } from './drawing-anchor-extent.ts';
import type { GroupPictureProjection } from './drawing-group-picture.ts';
import { createDiagramPartResolver, type DiagramPartResolver } from './diagram-parts.ts';
import { CHARTEX_MC_NAMESPACES } from './chartex-parts.ts';
import { projectDrawingContent, withPictureClip } from './drawing-content-projection.ts';
import { parseCropPercent } from './drawing-shape-readers.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { createPackageShapeThemeResolvers } from './theme-color-resolution.ts';
import {
  findDirectChild,
  parseEmu,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type TextboxStoryProjection,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';

export type { TextboxStoryProjection, VectorShapeProjection } from './drawing-shape-projection.ts';
export type { GroupPictureProjection } from './drawing-group-picture.ts';

export type { DrawingDiagnostic, DrawingProjectionLimits };

function removeSupersededDrawingDiagnostic(
  diagnostics: DrawingDiagnostic[],
  superseded: DrawingDiagnostic
): void {
  const index = diagnostics.indexOf(superseded);
  if (index !== -1) diagnostics.splice(index, 1);
}

/**
 * Whether a drawing sits in the text flow or is positioned against a frame.
 *
 * The distinction that decides everything downstream: an inline drawing occupies a character
 * position, while an anchored one has offsets relative to a page, margin or column.
 */
export type DrawingKind = 'inline' | 'anchored';

/** Nine Word wrap menu targets (inline plus eight floating modes). @public */
export type ImageWrapTarget =
  | 'inline'
  | 'square'
  | 'squareLeft'
  | 'squareRight'
  | 'tight'
  | 'through'
  | 'topAndBottom'
  | 'behind'
  | 'inFront';

/** Every text-wrap mode a drawing may be set to, including `inline`. */
export const IMAGE_WRAP_TARGETS: readonly ImageWrapTarget[] = [
  'inline',
  'square',
  'squareLeft',
  'squareRight',
  'tight',
  'through',
  'topAndBottom',
  'behind',
  'inFront',
];

export type DrawingWrapElement = 'none' | 'square' | 'tight' | 'through' | 'topAndBottom';

export type DrawingHorizontalReferenceFrame =
  | 'character'
  | 'column'
  | 'insideMargin'
  | 'leftMargin'
  | 'margin'
  | 'outsideMargin'
  | 'page'
  | 'rightMargin';

export type DrawingVerticalReferenceFrame =
  | 'bottomMargin'
  | 'insideMargin'
  | 'line'
  | 'margin'
  | 'outsideMargin'
  | 'page'
  | 'paragraph'
  | 'topMargin';

/** `a:srcRect` — how much of each edge of the source image is cropped away, as fractions. */
export interface SourceCrop {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface DrawingTransform {
  readonly rotationDegrees: number;
  readonly flipHorizontal: boolean;
  readonly flipVertical: boolean;
  /** Source `a:off` in EMU; defaults to origin when absent. */
  readonly offsetEmu: Readonly<{ x: number; y: number }>;
  /** Source `a:ext` in EMU; zero falls back to `wp:extent` at geometry time. */
  readonly extentEmu: Readonly<{ cx: number; cy: number }>;
}

/**
 * What a drawing refuses: selection, movement, resizing, aspect change.
 *
 * Read and honoured rather than advisory — chrome that offered a handle the store will refuse
 * would promise an edit that cannot happen.
 */
export interface DrawingLocks {
  readonly select: boolean;
  readonly move: boolean;
  readonly resize: boolean;
  readonly changeAspect: boolean;
}

export interface DrawingLocksInput {
  readonly select?: boolean;
  readonly move?: boolean;
  readonly resize?: boolean;
  readonly changeAspect?: boolean;
}

/**
 * An anchored drawing's position: offsets, and the frames they are relative to.
 *
 * The relative-to bases matter as much as the offsets. Writing an offset without preserving its
 * base re-anchors the drawing against a different reference and moves it somewhere nobody asked.
 */
export interface DrawingPositionInput {
  /**
   * `'simple'` when `@simplePos="1"`: `horizontalEmu` / `verticalEmu` are authoritative
   * `wp:simplePos` x/y. `'frame'` (default) uses positionH/V relative frames.
   */
  readonly mode?: 'frame' | 'simple';
  readonly horizontalEmu?: number;
  readonly verticalEmu?: number;
  readonly relativeToH?: DrawingHorizontalReferenceFrame;
  readonly relativeToV?: DrawingVerticalReferenceFrame;
}

export interface DrawingProjection {
  readonly drawingNodeId: string;
  readonly ownerPartName: string;
  readonly kind: DrawingKind;
  readonly relationshipId: string | null;
  readonly docPrId: number | null;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly hyperlinkHref: string | null;
  readonly hidden: boolean;
  readonly extentEmu: Readonly<{ cx: number; cy: number }>;
  readonly effectExtentEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly inlineDistancesEmu: Readonly<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  }>;
  readonly wrap: ImageWrapTarget;
  readonly wrapGeometry: DrawingWrapProjection | null;
  readonly position: DrawingPositionProjection | null;
  readonly anchor: Readonly<{
    simplePos: boolean;
    relativeHeight: number;
    behindDocument: boolean;
    layoutInCell: boolean;
    allowOverlap: boolean;
  }> | null;
  readonly picture: PictureProjection | null;
  readonly vectorShape: VectorShapeProjection | null;
  /** The picture member of a `wpg:wgp` group; `picture` stays null for a group. */
  readonly groupPicture: GroupPictureProjection | null;
  /**
   * The group's other picture members, in document order. Each paints above `groupPicture`
   * and the ones before it, and below `vectorShape`. Absent when the group has one picture.
   */
  readonly groupPictureLayers?: readonly GroupPictureProjection[];
  readonly textboxStory: TextboxStoryProjection | null;
  /** Text box members of a `wpg:wgp` group, laid out read-only; absent when none has text. */
  readonly groupTextboxes?: readonly GroupTextboxProjection[];
  /** The title and plot types of a chart: rendered, shown by its fallback, or a placeholder. */
  readonly chartSummary?: DrawingChartSummary;
  /**
   * The picture saved in the `mc:Fallback` of a chart's `mc:AlternateContent`, whichever
   * branch the page shows, for an output that exports a chart as its saved picture. Absent
   * when the fallback is not a picture that paints.
   */
  readonly chartFallbackPicture?: PictureProjection;
  /** Read-only preview of the supported native VML subset; the canonical XML is untouched. */
  readonly legacyGraphic?: LegacyGraphicProjection;
  /** Floating VML text art (a text watermark), fitted to the box by layout. */
  readonly textArt?: import('./legacy-vml-text-art.ts').LegacyTextArtProjection;
  /** A horizontal rule; layout widens it to its line and gives it its `vectorShape`. */
  readonly horizontalRule?: import('./legacy-vml-rule.ts').HorizontalRuleProjection;
  readonly locks: DrawingLocks;
  readonly effects: DrawingImageEffects;
  readonly compatibilityBranchNodeId: string | null;
  readonly diagnostics: readonly DrawingDiagnostic[];
  /** Layout-only wrap area of an MC payload that cannot paint (`wrapFootprintProjection`). */
  readonly footprintOnly?: true;
}

export interface DrawingAccessibility {
  /**
   * The record takes part in layout only, for example the wrap area of a payload that cannot
   * paint. Outputs must not paint, hit-test, select, link, or export it.
   */
  readonly hidden: boolean;
  readonly decorative: boolean;
  readonly label: string | null;
}

export interface DrawingPositionProjection {
  readonly simplePosition: Readonly<{ xEmu: number; yEmu: number }>;
  readonly horizontal: Readonly<{
    relativeFrom: DrawingHorizontalReferenceFrame;
    align: string | null;
    offsetEmu: number | null;
  }>;
  readonly vertical: Readonly<{
    relativeFrom: DrawingVerticalReferenceFrame;
    align: string | null;
    offsetEmu: number | null;
  }>;
}

export interface DrawingWrapProjection {
  readonly element: DrawingWrapElement;
  readonly textSide: 'bothSides' | 'left' | 'right' | 'largest';
  readonly distancesEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly polygon: readonly Readonly<{ x: number; y: number }>[];
}

export interface PictureProjection {
  readonly embeddedRelationshipId: string | null;
  readonly linkedRelationshipId: string | null;
  readonly crop: SourceCrop;
  readonly fillMode: 'stretch' | 'tile';
  readonly transform: DrawingTransform;
  readonly presetGeometry: string | null;
  /** The clip ring of non-rectangular geometry, in the unit square of the extent. */
  readonly clipUnit?: readonly Readonly<{ x: number; y: number }>[];
  /** Effects that change how the picture itself paints: a reflection, soft edges. */
  readonly frameEffects?: import('./drawing-picture-frame.ts').PictureFrameEffects;
}

export const DEFAULT_DRAWING_PROJECTION_LIMITS: DrawingProjectionLimits = Object.freeze({
  maxCompatibilityBranches: 64,
  maxVisitedElements: 4096,
  maxDrawingDepth: 64,
});

/** Supported namespace URIs for `mc:Choice/@Requires` prefix resolution. */
export const DEFAULT_SUPPORTED_MC_REQUIRES: ReadonlySet<string> = new Set([
  W14_NAMESPACE_URI,
  'http://schemas.microsoft.com/office/word/2012/wordml',
  'http://schemas.microsoft.com/office/word/2015/wordml',
  'http://schemas.microsoft.com/office/word/2016/wordml',
  WP_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  MC_NAMESPACE_URI,
  // Word wraps `wps:wsp` shapes in `mc:Choice Requires="wps"`; the engine renders the
  // solid-geometry subset and placeholders the rest, so the Choice branch is understood.
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  // A chartex Choice is understood. It paints when a renderer supports the chart; otherwise
  // the wrapper shows its fallback or the chart placeholder (`projectRunLevelMcDrawing`).
  ...CHARTEX_MC_NAMESPACES,
]);

const PIC_GRAPHIC_DATA_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/** Whole-part drawing scan budget — the parsed tree is already store-limit bounded. */
/** Part-wide traversal budget; larger than the per-drawing projection budget by design. */
export const MAX_PART_SCAN_ELEMENTS = 1_000_000;

const EMPTY_EDGES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const EMPTY_CROP: SourceCrop = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });
const EMPTY_LOCKS: DrawingLocks = Object.freeze({
  select: false,
  move: false,
  resize: false,
  changeAspect: false,
});
const EMPTY_EFFECTS = Object.freeze({ grayscale: false, brightness: 0, contrast: 0 });

interface ProjectionContext {
  readonly stylesPart?: OoxmlPart;
  readonly ownerPartName: string;
  readonly supportedMcRequires: ReadonlySet<string>;
  readonly limits: DrawingProjectionLimits;
  readonly resolveRelationship?: RelationshipTargetResolver;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
  readonly resolveDiagramParts?: DiagramPartResolver;
}

/** Resolve `(ownerPartName, r:id)` against a package's relationship records. */
export function createDrawingRelationshipResolver(
  pkg: OoxmlPackage,
  ownerPartName: string
): RelationshipTargetResolver {
  return (relationshipId: string) => {
    for (const external of pkg.externalTargets) {
      if (external.ownerPart !== ownerPartName || external.id !== relationshipId) continue;
      if (external.type !== HYPERLINK_RELATIONSHIP_TYPE) return null;
      return {
        target: external.rawTarget,
        external: true,
        sinkSafe: external.sinkSafe,
      };
    }
    for (const record of pkg.relationships.get(ownerPartName) ?? []) {
      if (record.id !== relationshipId) continue;
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'External') {
        if (record.type !== HYPERLINK_RELATIONSHIP_TYPE) return null;
        return {
          target: record.rawTarget,
          external: true,
          sinkSafe: resolved.sinkSafe.ok,
        };
      }
      return { target: record.rawTarget, external: false };
    }
    return null;
  };
}

function resolveDrawingHyperlinkHref(
  relationshipId: string,
  resolve: RelationshipTargetResolver | undefined
): string | null {
  if (resolve === undefined) return null;
  const record = resolve(relationshipId);
  if (record === null || !record.external) return null;
  const projection = sanitizeHref(record.target);
  if (!projection.ok || record.sinkSafe !== true) return null;
  return projection.href;
}

function findDirectDocPrHlinkClick(docPr: OoxmlElement): OoxmlElement | null {
  for (const child of docPr.children) {
    if (!isElement(child)) continue;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      child.localName === 'hlinkClick'
    ) {
      return child;
    }
  }
  return null;
}

export interface RunLevelMcAtom {
  readonly segmentNode: OoxmlGenericElementNode;
  readonly drawing: OoxmlDrawingNode | null;
  readonly removeNodeIds: readonly string[];
}

function relationshipAttribute(
  attributes: readonly {
    readonly localName: string;
    readonly namespaceUri: string;
    readonly value: string;
  }[],
  localName: 'embed' | 'link' | 'id'
): string | undefined {
  for (const attribute of attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== RELATIONSHIPS_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

function mcAttribute(
  attributes: readonly {
    readonly localName: string;
    readonly namespaceUri: string;
    readonly value: string;
  }[],
  localName: string
): string | undefined {
  for (const attribute of attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== MC_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

/** Signed ST_PositionOffset (`xsd:int`) — reject out-of-range values, never clamp. */
function parsePosOffset(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < ST_POSITION_OFFSET_MIN || parsed > ST_POSITION_OFFSET_MAX) return null;
  return parsed;
}

/** Signed ST_Coordinate for wp:simplePos x/y — full schema range, never truncated to 32-bit. */
function parseSimplePosCoordinate(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < ST_COORDINATE_MIN || parsed > ST_COORDINATE_MAX) return null;
  return parsed;
}

function parseDocPrId(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,10}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Direct-child text only — never descends into nested elements. */
function directTextValueOf(node: OoxmlElement): string | null {
  for (const child of node.children) {
    if (child.kind === 'textValue') return child.value;
  }
  return null;
}

function choiceRequiresSupported(
  choice: OoxmlGenericElementNode,
  namespaceScope: ReadonlyMap<string, string>,
  supportedNamespaceUris: ReadonlySet<string>
): boolean {
  const requires =
    mcAttribute(choice.attributes, 'Requires') ??
    schemaAttributeValue(choice.attributes, 'Requires');
  if (requires === undefined || requires.trim().length === 0) return false;
  const prefixes = requires
    .trim()
    .split(/\s+/)
    .filter((prefix) => prefix.length > 0);
  if (prefixes.length === 0) return false;
  return prefixes.every((prefix) => {
    const namespaceUri = namespaceScope.get(prefix);
    if (namespaceUri === undefined || namespaceUri.length === 0) return false;
    return supportedNamespaceUris.has(namespaceUri);
  });
}

function firstElementChild(node: OoxmlGenericElementNode): OoxmlNode | null {
  for (const child of node.children) {
    if (isElement(child)) return child;
  }
  return null;
}

function validateMcBranchContent(
  branch: OoxmlNode | null
): OoxmlDrawingNode | 'non-picture' | null {
  if (branch === null || !isElement(branch)) return null;
  if (branch.kind === 'drawing') return branch;
  if (
    branch.kind === 'generic' &&
    branch.namespaceUri === WML_NAMESPACE_URI &&
    branch.localName === 'drawing'
  ) {
    return branch as unknown as OoxmlDrawingNode;
  }
  return 'non-picture';
}

function isCompatibilityDrawing(node: OoxmlElement): boolean {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'drawing'
  );
}

function isCompatibilityAnchor(node: OoxmlElement): boolean {
  return (
    node.kind === 'inlineDrawing' ||
    node.kind === 'anchoredDrawing' ||
    (node.kind === 'generic' &&
      node.namespaceUri === WP_NAMESPACE_URI &&
      (node.localName === 'inline' || node.localName === 'anchor'))
  );
}

function selectCompatibilityBranch(
  node: OoxmlGenericElementNode,
  state: WalkState,
  limits: DrawingProjectionLimits,
  namespaceScope: ReadonlyMap<string, string>,
  supportedNamespaceUris: ReadonlySet<string>
): { readonly branch: OoxmlNode | null; readonly branchNodeId: string | null } {
  const scope = namespaceScopeForNode(namespaceScope, node);
  state.compatibilityBranches += 1;
  if (state.compatibilityBranches > limits.maxCompatibilityBranches) {
    state.refused = true;
    return { branch: null, branchNodeId: null };
  }
  let fallback: OoxmlNode | null = null;
  let fallbackId: string | null = null;
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (isMcChoice(child)) {
      state.compatibilityBranches += 1;
      if (state.compatibilityBranches > limits.maxCompatibilityBranches) {
        state.refused = true;
        return { branch: null, branchNodeId: null };
      }
      const choice = child as OoxmlGenericElementNode;
      const choiceScope = namespaceScopeForNode(scope, choice);
      if (choiceRequiresSupported(choice, choiceScope, supportedNamespaceUris)) {
        const selected = firstElementChild(choice);
        state.compatibilityBranchNodeId = choice.id;
        return { branch: selected, branchNodeId: choice.id };
      }
      continue;
    }
    if (isMcFallback(child)) {
      const fallbackNode = child as OoxmlGenericElementNode;
      fallback = firstElementChild(fallbackNode);
      fallbackId = fallbackNode.id;
    }
  }
  if (fallback !== null) state.compatibilityBranchNodeId = fallbackId;
  return { branch: fallback, branchNodeId: fallbackId };
}

function flattenAnchorRoot(
  drawing: OoxmlDrawingNode,
  state: WalkState,
  limits: DrawingProjectionLimits,
  namespaceScope: ReadonlyMap<string, string>,
  supportedNamespaceUris: ReadonlySet<string>
): { readonly anchor: OoxmlElement | null } {
  for (const child of drawing.children) {
    if (!visitNode(state, limits)) return { anchor: null };
    if (isCompatibilityAnchor(child)) {
      return { anchor: child };
    }
    if (isMcAlternateContent(child)) {
      const childScope = namespaceScopeForNode(namespaceScope, child);
      const selected = selectCompatibilityBranch(
        child,
        state,
        limits,
        childScope,
        supportedNamespaceUris
      );
      if (selected.branch === null || !isElement(selected.branch)) continue;
      if (isCompatibilityAnchor(selected.branch)) {
        return { anchor: selected.branch };
      }
    }
  }
  return { anchor: null };
}

function visitNode(state: WalkState, limits: DrawingProjectionLimits): boolean {
  state.visited += 1;
  if (state.visited > limits.maxVisitedElements) {
    state.refused = true;
    return false;
  }
  return true;
}

function isMcValidatedPic(node: OoxmlElement): boolean {
  return (
    node.kind === 'picture' ||
    (node.kind === 'generic' && node.namespaceUri === PIC_NAMESPACE_URI && node.localName === 'pic')
  );
}

function findPictureInGraphicData(
  data: OoxmlElement,
  state: WalkState,
  limits: DrawingProjectionLimits,
  namespaceScope: ReadonlyMap<string, string>,
  supportedNamespaceUris: ReadonlySet<string>,
  compatibilityMode: boolean
): OoxmlElement | null {
  for (const child of data.children) {
    if (!visitNode(state, limits)) return null;
    if (isMcAlternateContent(child)) {
      const childScope = namespaceScopeForNode(namespaceScope, child);
      const selected = selectCompatibilityBranch(
        child,
        state,
        limits,
        childScope,
        supportedNamespaceUris
      );
      if (selected.branch && isElement(selected.branch) && isMcValidatedPic(selected.branch)) {
        return selected.branch;
      }
      continue;
    }
    if (!isElement(child)) continue;
    if (child.kind === 'picture') return child;
    if (compatibilityMode && isMcValidatedPic(child)) return child;
  }
  return null;
}

function readDirectPictureBlip(picture: OoxmlElement): OoxmlElement | null {
  const typedFill = findDirectKind(picture.children, 'pictureBlipFill');
  if (typedFill) {
    const typedBlip = findDirectKind(typedFill.children, 'pictureBlip');
    if (typedBlip) return typedBlip;
  }
  for (const child of picture.children) {
    if (!isElement(child)) continue;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === PIC_NAMESPACE_URI &&
      child.localName === 'blipFill'
    ) {
      for (const grand of child.children) {
        if (!isElement(grand)) continue;
        if (grand.kind === 'pictureBlip') return grand;
        if (
          grand.kind === 'generic' &&
          grand.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
          grand.localName === 'blip'
        ) {
          return grand;
        }
      }
    }
  }
  return null;
}

function readDirectPictureSrcRect(picture: OoxmlElement): OoxmlElement | null {
  const typedFill = findDirectKind(picture.children, 'pictureBlipFill');
  if (typedFill) {
    const typedRect = findDirectKind(typedFill.children, 'pictureSrcRect');
    if (typedRect) return typedRect;
    for (const child of typedFill.children) {
      if (!isElement(child)) continue;
      if (
        child.kind === 'generic' &&
        child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
        child.localName === 'srcRect'
      ) {
        return child;
      }
    }
  }
  for (const child of picture.children) {
    if (!isElement(child)) continue;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === PIC_NAMESPACE_URI &&
      child.localName === 'blipFill'
    ) {
      for (const grand of child.children) {
        if (!isElement(grand)) continue;
        if (
          grand.kind === 'generic' &&
          grand.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
          grand.localName === 'srcRect'
        ) {
          return grand;
        }
      }
    }
  }
  return null;
}

function pictureUsesTileFillDirect(picture: OoxmlElement): boolean {
  const typedFill = findDirectKind(picture.children, 'pictureBlipFill');
  if (typedFill && findDirectKind(typedFill.children, 'pictureTile') !== null) return true;
  for (const child of picture.children) {
    if (!isElement(child)) continue;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === PIC_NAMESPACE_URI &&
      child.localName === 'blipFill'
    ) {
      for (const grand of child.children) {
        if (!isElement(grand)) continue;
        if (grand.kind === 'pictureTile') return true;
        if (
          grand.kind === 'generic' &&
          grand.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
          grand.localName === 'tile'
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function findWrapElement(anchor: OoxmlElement, compatibilityMode: boolean): OoxmlElement | null {
  for (const child of anchor.children) {
    if (!isElement(child)) continue;
    if (
      child.kind === 'drawingWrapNone' ||
      child.kind === 'drawingWrapSquare' ||
      child.kind === 'drawingWrapTight' ||
      child.kind === 'drawingWrapThrough' ||
      child.kind === 'drawingWrapTopBottom'
    ) {
      return child;
    }
    if (!compatibilityMode) continue;
    if (
      child.kind === 'generic' &&
      child.namespaceUri === WP_NAMESPACE_URI &&
      (child.localName === 'wrapNone' ||
        child.localName === 'wrapSquare' ||
        child.localName === 'wrapTight' ||
        child.localName === 'wrapThrough' ||
        child.localName === 'wrapTopAndBottom')
    ) {
      return child;
    }
  }
  return null;
}

function readEffectExtent(
  anchor: OoxmlElement,
  wrapElement: OoxmlElement | null,
  compatibilityMode: boolean
): Readonly<{ top: number; right: number; bottom: number; left: number }> {
  const wrapKind = wrapElementKind(wrapElement);
  if (wrapKind === 'square' || wrapKind === 'topAndBottom') {
    const fromWrap = readEffectExtentFromNode(wrapElement, compatibilityMode);
    if (fromWrap) return fromWrap;
  }
  const fromAnchor = readEffectExtentFromNode(anchor, compatibilityMode);
  if (fromAnchor) return fromAnchor;
  return EMPTY_EDGES;
}

function readPositionAxis<H extends string>(
  node: OoxmlElement | null,
  fallback: H
): Readonly<{ relativeFrom: H; align: string | null; offsetEmu: number | null }> {
  if (!node) {
    return Object.freeze({ relativeFrom: fallback, align: null, offsetEmu: null });
  }
  const relativeFromRaw = schemaAttributeValue(node.attributes, 'relativeFrom') ?? fallback;
  const relativeFrom = relativeFromRaw as H;
  const alignNode =
    findDirectKind(node.children, 'drawingPositionAlign') ??
    findDirectChild(node.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'align' });
  if (alignNode) {
    const align = directTextValueOf(alignNode)?.trim() ?? null;
    return Object.freeze({ relativeFrom, align, offsetEmu: null });
  }
  const offsetNode =
    findDirectKind(node.children, 'drawingPositionOffset') ??
    findDirectChild(node.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'posOffset' });
  if (offsetNode) {
    const offset = directTextValueOf(offsetNode);
    const offsetEmu = offset !== null ? parsePosOffset(offset) : null;
    return Object.freeze({ relativeFrom, align: null, offsetEmu });
  }
  return Object.freeze({ relativeFrom, align: null, offsetEmu: null });
}

function readPosition(
  anchor: OoxmlElement,
  simplePosEnabled: boolean
): DrawingPositionProjection | null {
  // Generic fallbacks: compatibility (MC-wrapped) anchors carry plain `wp:*` children.
  const simplePosNode =
    findDirectKind(anchor.children, 'drawingSimplePos') ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'simplePos' });
  const simplePosition = Object.freeze({
    xEmu: simplePosNode
      ? (parseSimplePosCoordinate(schemaAttributeValue(simplePosNode.attributes, 'x')) ?? 0)
      : 0,
    yEmu: simplePosNode
      ? (parseSimplePosCoordinate(schemaAttributeValue(simplePosNode.attributes, 'y')) ?? 0)
      : 0,
  });
  const horizontalNode =
    findDirectKind(anchor.children, 'drawingPositionH') ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'positionH' });
  const verticalNode =
    findDirectKind(anchor.children, 'drawingPositionV') ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'positionV' });
  const horizontal = readPositionAxis(horizontalNode, 'column');
  const vertical = readPositionAxis(verticalNode, 'paragraph');
  if (!simplePosEnabled && !horizontalNode && !verticalNode && !simplePosNode) return null;
  return Object.freeze({
    simplePosition,
    horizontal,
    vertical,
  });
}

function wrapElementKind(wrap: OoxmlElement | null): DrawingWrapElement {
  switch (wrap?.kind) {
    case 'drawingWrapSquare':
      return 'square';
    case 'drawingWrapTight':
      return 'tight';
    case 'drawingWrapThrough':
      return 'through';
    case 'drawingWrapTopBottom':
      return 'topAndBottom';
    default:
      break;
  }
  // Compatibility branches (MC-wrapped drawings) parse generic, so the wrap element
  // arrives as a plain `wp:*` node rather than a typed kind.
  if (wrap && wrap.kind === 'generic' && wrap.namespaceUri === WP_NAMESPACE_URI) {
    switch (wrap.localName) {
      case 'wrapSquare':
        return 'square';
      case 'wrapTight':
        return 'tight';
      case 'wrapThrough':
        return 'through';
      case 'wrapTopAndBottom':
        return 'topAndBottom';
      default:
        break;
    }
  }
  return 'none';
}

function wrapTargetFromAnchor(
  kind: DrawingKind,
  wrap: OoxmlElement | null,
  behindDocument: boolean
): ImageWrapTarget {
  if (kind === 'inline') return 'inline';
  const element = wrapElementKind(wrap);
  if (element === 'none') return behindDocument ? 'behind' : 'inFront';
  if (element === 'square') {
    const side = schemaAttributeValue(wrap!.attributes, 'wrapText') ?? 'bothSides';
    if (side === 'left') return 'squareLeft';
    if (side === 'right') return 'squareRight';
    return 'square';
  }
  if (element === 'tight') return 'tight';
  if (element === 'through') return 'through';
  return 'topAndBottom';
}

function readWrapGeometry(
  wrap: OoxmlElement | null,
  state: WalkState,
  nodeId: string,
  anchor: OoxmlElement
): DrawingWrapProjection | null {
  if (!wrap) return null;
  const element = wrapElementKind(wrap);
  const textSideRaw = schemaAttributeValue(wrap.attributes, 'wrapText') ?? 'bothSides';
  const textSide =
    textSideRaw === 'left' || textSideRaw === 'right' || textSideRaw === 'largest'
      ? textSideRaw
      : 'bothSides';
  return Object.freeze({
    element,
    textSide,
    distancesEmu: readDistances(wrap, anchor),
    polygon:
      element === 'tight' || element === 'through'
        ? readPolygon(wrap, state, nodeId)
        : Object.freeze([]),
  });
}

function readFrameLocks(node: OoxmlElement | null): DrawingLocksInput {
  if (!node) return {};
  const frameLocks = node.children.find(
    (child) =>
      isElement(child) &&
      child.kind === 'generic' &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      child.localName === 'graphicFrameLocks'
  );
  if (!frameLocks || !isElement(frameLocks)) return {};
  const attrs = frameLocks.attributes;
  const locked = (name: string): boolean | undefined => {
    const value = schemaAttributeValue(attrs, name);
    return value === undefined ? undefined : (parseSchemaBoolean(value) ?? false);
  };
  return {
    select: locked('noSelect'),
    move: locked('noMove'),
    resize: locked('noResize'),
    changeAspect: locked('noChangeAspect'),
  };
}

function readDocPrMetadata(
  anchor: OoxmlElement,
  compatibilityMode: boolean,
  resolveRelationship?: RelationshipTargetResolver
): {
  readonly docPrId: number | null;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly hidden: boolean;
  readonly hyperlinkHref: string | null;
} {
  const docPr =
    findDirectKind(anchor.children, 'drawingDocPr') ??
    (compatibilityMode
      ? findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'docPr' })
      : null);
  if (!docPr) {
    return Object.freeze({
      docPrId: null,
      name: '',
      title: '',
      description: '',
      hidden: parseSchemaBoolean(schemaAttributeValue(anchor.attributes, 'hidden')) ?? false,
      hyperlinkHref: null,
    });
  }
  let hyperlinkHref: string | null = null;
  const hlinkClick = findDirectDocPrHlinkClick(docPr);
  if (hlinkClick !== null) {
    const relId = relationshipAttribute(hlinkClick.attributes, 'id');
    if (relId) {
      hyperlinkHref = resolveDrawingHyperlinkHref(relId, resolveRelationship);
    }
  }
  return Object.freeze({
    docPrId: parseDocPrId(schemaAttributeValue(docPr.attributes, 'id')),
    name: schemaAttributeValue(docPr.attributes, 'name') ?? '',
    title: schemaAttributeValue(docPr.attributes, 'title') ?? '',
    description: schemaAttributeValue(docPr.attributes, 'descr') ?? '',
    hidden:
      (parseSchemaBoolean(schemaAttributeValue(docPr.attributes, 'hidden')) ?? false) ||
      (parseSchemaBoolean(schemaAttributeValue(anchor.attributes, 'hidden')) ?? false),
    hyperlinkHref,
  });
}

/**
 * Whether an anchor's own metadata keeps its drawing off the page.
 *
 * Layout skips a hidden drawing outright, and hit testing rejects a zero-sized one, so a
 * derivation that lists drawings for SELECTION must apply the same two rules. Without them it
 * reports a drawing that no page paints and no overlay can resolve. A missing `wp:extent`
 * demotes the drawing to generic at read time, so it never reaches here.
 */
export function anchorHidesDrawing(anchor: OoxmlElement, compatibilityMode: boolean): boolean {
  if (readDocPrMetadata(anchor, compatibilityMode).hidden) return true;
  const extent = readExtent(anchor, compatibilityMode);
  return extent !== null && (extent.cx <= 0 || extent.cy <= 0);
}

function projectPicture(
  anchor: OoxmlElement,
  state: WalkState,
  ctx: ProjectionContext,
  namespaceScope: ReadonlyMap<string, string>,
  compatibilityMode: boolean
): {
  readonly picture: PictureProjection | null;
  readonly relationshipId: string | null;
  readonly effects: DrawingImageEffects;
  readonly diagnostic: DrawingDiagnostic | null;
  readonly element?: OoxmlElement;
} {
  if (!visitNode(state, ctx.limits)) {
    return { picture: null, relationshipId: null, effects: EMPTY_EFFECTS, diagnostic: null };
  }
  const graphic =
    findDirectKind(anchor.children, 'drawingGraphic') ??
    (compatibilityMode
      ? findDirectChild(anchor.children, {
          namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
          localName: 'graphic',
        })
      : null);
  if (!graphic) {
    return {
      picture: null,
      relationshipId: null,
      effects: EMPTY_EFFECTS,
      diagnostic: {
        code: 'unsupported-graphic',
        nodeId: anchor.id,
        detail: 'missing-graphic',
      },
    };
  }
  const data =
    findDirectKind(graphic.children, 'drawingGraphicData') ??
    (compatibilityMode
      ? findDirectChild(graphic.children, {
          namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
          localName: 'graphicData',
        })
      : null);
  if (!data) {
    // Non-picture payloads (charts, diagrams) stay generic; their URI names the placeholder.
    const generic = findDirectChild(graphic.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphicData',
    });
    const genericUri = generic ? schemaAttributeValue(generic.attributes, 'uri') : undefined;
    return {
      picture: null,
      relationshipId: null,
      effects: EMPTY_EFFECTS,
      diagnostic: {
        code: 'unsupported-graphic',
        nodeId: graphic.id,
        detail:
          genericUri && genericUri !== PIC_GRAPHIC_DATA_URI ? genericUri : 'missing-graphic-data',
      },
    };
  }
  const uri = schemaAttributeValue(data.attributes, 'uri');
  const anchorScope = namespaceScopeForNode(namespaceScope, anchor);
  const graphicScope = namespaceScopeForNode(anchorScope, graphic);
  const dataScope = namespaceScopeForNode(graphicScope, data);
  const picture = findPictureInGraphicData(
    data,
    state,
    ctx.limits,
    dataScope,
    ctx.supportedMcRequires,
    compatibilityMode
  );
  if (uri !== PIC_GRAPHIC_DATA_URI || !picture) {
    return {
      picture: null,
      relationshipId: null,
      effects: EMPTY_EFFECTS,
      diagnostic: {
        code: 'unsupported-graphic',
        nodeId: data.id,
        detail: uri ?? 'non-picture',
      },
    };
  }
  const blip = readDirectPictureBlip(picture);
  const embeddedRelationshipId = blip
    ? (relationshipAttribute(blip.attributes, 'embed') ?? null)
    : null;
  const linkedRelationshipId = blip
    ? (relationshipAttribute(blip.attributes, 'link') ?? null)
    : null;
  const relationshipId = embeddedRelationshipId ?? linkedRelationshipId;
  const srcRect = readDirectPictureSrcRect(picture);
  const crop: SourceCrop = srcRect
    ? Object.freeze({
        left: parseCropPercent(schemaAttributeValue(srcRect.attributes, 'l')),
        top: parseCropPercent(schemaAttributeValue(srcRect.attributes, 't')),
        right: parseCropPercent(schemaAttributeValue(srcRect.attributes, 'r')),
        bottom: parseCropPercent(schemaAttributeValue(srcRect.attributes, 'b')),
      })
    : EMPTY_CROP;
  const fillMode = pictureUsesTileFillDirect(picture) ? 'tile' : 'stretch';
  const shapeProps = findDirectKind(picture.children, 'pictureShapeProperties');
  const xfrm = shapeProps ? findDirectKind(shapeProps.children, 'pictureTransform') : null;
  const offNode = xfrm ? findDirectKind(xfrm.children, 'pictureTransformOffset') : null;
  const extNode = xfrm ? findDirectKind(xfrm.children, 'pictureTransformExtent') : null;
  const rotRaw = xfrm ? schemaAttributeValue(xfrm.attributes, 'rot') : undefined;
  const rotEmu = rotRaw !== undefined ? parseEmu(rotRaw, false) : null;
  const transform: DrawingTransform = Object.freeze({
    rotationDegrees: rotEmu === null ? 0 : rotEmu / 60_000,
    // `xsd:boolean`, so `true` is as legal as `1`; reading only `1` painted a mirrored
    // picture the right way round. A picture flip IS paintable, so a schema-invalid value
    // reads as unset here rather than refusing the whole picture.
    flipHorizontal:
      (xfrm ? parseSchemaBoolean(schemaAttributeValue(xfrm.attributes, 'flipH')) : null) ?? false,
    flipVertical:
      (xfrm ? parseSchemaBoolean(schemaAttributeValue(xfrm.attributes, 'flipV')) : null) ?? false,
    offsetEmu: Object.freeze({
      x: offNode ? (parseEmu(schemaAttributeValue(offNode.attributes, 'x'), false) ?? 0) : 0,
      y: offNode ? (parseEmu(schemaAttributeValue(offNode.attributes, 'y'), false) ?? 0) : 0,
    }),
    extentEmu: Object.freeze({
      cx: extNode ? (parseEmu(schemaAttributeValue(extNode.attributes, 'cx')) ?? 0) : 0,
      cy: extNode ? (parseEmu(schemaAttributeValue(extNode.attributes, 'cy')) ?? 0) : 0,
    }),
  });
  const preset = shapeProps ? findDirectKind(shapeProps.children, 'picturePresetGeometry') : null;
  const presetGeometry = preset ? (schemaAttributeValue(preset.attributes, 'prst') ?? null) : null;
  const effects = blip ? readBlipEffects(blip) : EMPTY_EFFECTS;
  return {
    picture: Object.freeze({
      embeddedRelationshipId,
      linkedRelationshipId,
      crop,
      fillMode,
      transform,
      presetGeometry,
    }),
    relationshipId,
    effects,
    diagnostic: null,
    element: picture,
  };
}

function freezeDrawingProjection(projection: DrawingProjection): DrawingProjection {
  return Object.freeze({
    ...projection,
    extentEmu: Object.freeze({ ...projection.extentEmu }),
    effectExtentEmu: Object.freeze({ ...projection.effectExtentEmu }),
    inlineDistancesEmu: Object.freeze({ ...projection.inlineDistancesEmu }),
    wrapGeometry: projection.wrapGeometry
      ? Object.freeze({
          ...projection.wrapGeometry,
          distancesEmu: Object.freeze({ ...projection.wrapGeometry.distancesEmu }),
          polygon: Object.freeze(
            projection.wrapGeometry.polygon.map((point) => Object.freeze({ ...point }))
          ),
        })
      : null,
    position: projection.position
      ? Object.freeze({
          ...projection.position,
          simplePosition: Object.freeze({ ...projection.position.simplePosition }),
          horizontal: Object.freeze({ ...projection.position.horizontal }),
          vertical: Object.freeze({ ...projection.position.vertical }),
        })
      : null,
    anchor: projection.anchor ? Object.freeze({ ...projection.anchor }) : null,
    picture: projection.picture
      ? Object.freeze({
          ...projection.picture,
          crop: Object.freeze({ ...projection.picture.crop }),
          transform: Object.freeze({ ...projection.picture.transform }),
        })
      : null,
    vectorShape: projection.vectorShape
      ? Object.freeze({
          ...projection.vectorShape,
          extentEmu: Object.freeze({ ...projection.vectorShape.extentEmu }),
          subpathsEmu: Object.freeze(
            projection.vectorShape.subpathsEmu.map((points) =>
              Object.freeze(points.map((point) => Object.freeze({ ...point })))
            )
          ),
          // `components` is required and non-empty: paint iterates it, so a conditional
          // spread that ever took the empty branch would strip the field and throw.
          components: Object.freeze(
            projection.vectorShape.components.map(freezeVectorShapeComponent)
          ),
        })
      : null,
    // `content` is a canonical-tree node shared with the store; it is not deep-frozen here.
    textboxStory: projection.textboxStory
      ? Object.freeze({
          ...projection.textboxStory,
          insetsEmu: Object.freeze({ ...projection.textboxStory.insetsEmu }),
        })
      : null,
    locks: Object.freeze({ ...projection.locks }),
    effects: Object.freeze({ ...projection.effects }),
    diagnostics: Object.freeze(
      projection.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))
    ),
  });
}

function buildUnrenderableProjection(
  drawing: OoxmlDrawingNode,
  ctx: ProjectionContext,
  state: WalkState,
  kind: DrawingKind,
  extent: Readonly<{ cx: number; cy: number }>
): DrawingProjection {
  if (!state.diagnostics.some((diagnostic) => diagnostic.code === 'resource-refused')) {
    state.diagnostics.push({
      code: 'resource-refused',
      nodeId: drawing.id,
      detail: 'projection-limit',
    });
  }
  return freezeDrawingProjection(
    Object.freeze({
      drawingNodeId: drawing.id,
      ownerPartName: ctx.ownerPartName,
      kind,
      relationshipId: null,
      docPrId: null,
      name: '',
      title: '',
      description: '',
      hyperlinkHref: null,
      hidden: false,
      extentEmu: extent,
      effectExtentEmu: EMPTY_EDGES,
      inlineDistancesEmu: EMPTY_EDGES,
      wrap: kind === 'inline' ? 'inline' : 'inFront',
      wrapGeometry: null,
      position: null,
      anchor: null,
      picture: null,
      vectorShape: null,
      groupPicture: null,
      textboxStory: null,
      locks: EMPTY_LOCKS,
      effects: EMPTY_EFFECTS,
      compatibilityBranchNodeId: state.compatibilityBranchNodeId,
      diagnostics: state.diagnostics,
    })
  );
}

/** Whether a run-level `mc:AlternateContent` wraps typed drawing content. */
export function isRunLevelMcAlternateContent(node: OoxmlNode): node is OoxmlGenericElementNode {
  return isMcAlternateContent(node);
}

/** Selected MC branch container, retaining its namespace declarations for source walks. @internal */
export function selectedRunLevelMcBranch(
  wrapper: OoxmlGenericElementNode,
  namespaceScope: ReadonlyMap<string, string>
): Readonly<{ branch: OoxmlNode | null; refused: boolean }> {
  const state = createWalkState();
  const selected = selectCompatibilityBranch(
    wrapper,
    state,
    DEFAULT_DRAWING_PROJECTION_LIMITS,
    namespaceScope,
    DEFAULT_SUPPORTED_MC_REQUIRES
  );
  return {
    branch:
      selected.branchNodeId === null
        ? null
        : (wrapper.children.find((child) => child.id === selected.branchNodeId) ?? null),
    refused: state.refused,
  };
}

/** Resolve a run-level MC wrapper into an atomic drawing segment descriptor. */
export function resolveRunLevelMcAtom(
  wrapper: OoxmlGenericElementNode,
  namespaceScope: ReadonlyMap<string, string>,
  supportedNamespaceUris: ReadonlySet<string> = DEFAULT_SUPPORTED_MC_REQUIRES,
  limits: DrawingProjectionLimits = DEFAULT_DRAWING_PROJECTION_LIMITS
): RunLevelMcAtom {
  const state = createWalkState();
  const selected = selectCompatibilityBranch(
    wrapper,
    state,
    limits,
    namespaceScope,
    supportedNamespaceUris
  );
  const branch = validateMcBranchContent(selected.branch);
  if (branch === null || branch === 'non-picture') {
    return Object.freeze({
      segmentNode: wrapper,
      drawing: null,
      removeNodeIds: Object.freeze([wrapper.id]),
    });
  }
  return Object.freeze({
    segmentNode: wrapper,
    drawing: branch,
    removeNodeIds: Object.freeze([wrapper.id]),
  });
}

export { drawingAccessibility } from './drawing-accessibility.ts';

type DrawingProjectionContext = Readonly<{
  ownerPartName: string;
  supportedMcRequires: ReadonlySet<string>;
  limits: DrawingProjectionLimits;
  namespaceScope?: ReadonlyMap<string, string>;
  resolveRelationship?: RelationshipTargetResolver;
  resolveSchemeColor?: ShapeSchemeColorResolver;
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
  resolveDiagramParts?: DiagramPartResolver;
}>;

/**
 * Project one `w:drawing` into the resolved shape layout and chrome read.
 *
 * Bounded throughout: extents, crops and nesting all come from a file. Returns a projection that
 * reports `hidden` and its locks rather than throwing, so an unusable drawing degrades to
 * something the surface can skip.
 */
export function projectDrawing(
  drawing: OoxmlDrawingNode,
  context: Readonly<{
    ownerPartName: string;
    supportedMcRequires: ReadonlySet<string>;
    limits: DrawingProjectionLimits;
    namespaceScope?: ReadonlyMap<string, string>;
    resolveRelationship?: RelationshipTargetResolver;
    resolveSchemeColor?: ShapeSchemeColorResolver;
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
    resolveDiagramParts?: DiagramPartResolver;
  }>
): DrawingProjection | null {
  return projectDrawingWithState(drawing, context, createWalkState());
}

/** @internal Projection seam for diagnostic-association tests. */
export function projectDrawingWithState(
  drawing: OoxmlDrawingNode,
  context: DrawingProjectionContext,
  state: WalkState
): DrawingProjection | null {
  const ctx: ProjectionContext = {
    ownerPartName: context.ownerPartName,
    supportedMcRequires: context.supportedMcRequires,
    limits: context.limits,
    resolveRelationship: context.resolveRelationship,
    resolveSchemeColor: context.resolveSchemeColor,
    resolveStyleMatrixReference: context.resolveStyleMatrixReference,
    resolveDiagramParts: context.resolveDiagramParts,
  };
  const namespaceScope = context.namespaceScope ?? emptyNamespaceScope();
  const compatibilityMode = isCompatibilityDrawing(drawing);
  if (state.depth >= ctx.limits.maxDrawingDepth) {
    state.refused = true;
  }
  state.depth += 1;
  const { anchor } = flattenAnchorRoot(
    drawing,
    state,
    ctx.limits,
    namespaceScope,
    ctx.supportedMcRequires
  );
  state.depth -= 1;

  const extentFromAnchor = anchor ? readExtent(anchor, compatibilityMode) : null;
  if (state.refused && extentFromAnchor) {
    const kind: DrawingKind =
      anchor!.kind === 'anchoredDrawing' ||
      (anchor!.kind === 'generic' && anchor!.localName === 'anchor')
        ? 'anchored'
        : 'inline';
    return buildUnrenderableProjection(drawing, ctx, state, kind, extentFromAnchor);
  }

  if (!anchor) {
    state.diagnostics.push({
      code: 'malformed-drawing',
      nodeId: drawing.id,
      detail: 'missing-anchor',
    });
    return null;
  }

  const kind: DrawingKind =
    anchor.kind === 'anchoredDrawing' ||
    (anchor.kind === 'generic' && anchor.localName === 'anchor')
      ? 'anchored'
      : 'inline';
  const extent = readExtent(anchor, compatibilityMode);
  if (!extent) {
    if (state.refused) return null;
    state.diagnostics.push({
      code: 'invalid-geometry',
      nodeId: anchor.id,
      detail: 'extent',
    });
    return null;
  }

  if (state.refused) {
    return buildUnrenderableProjection(drawing, ctx, state, kind, extent);
  }

  const metadata = readDocPrMetadata(anchor, compatibilityMode, ctx.resolveRelationship);
  const wrapElement = kind === 'anchored' ? findWrapElement(anchor, compatibilityMode) : null;
  // CT_Anchor flags are `xsd:boolean`, so `true` is as legal as `1`. The `?? default`
  // states what an absent or schema-invalid value means: off for these, on for
  // layoutInCell and allowOverlap below, because dropping a picture's overlap is the
  // louder mistake.
  const anchorFlag = (name: string): boolean | null =>
    parseSchemaBoolean(schemaAttributeValue(anchor.attributes, name));
  const behindDocument = anchorFlag('behindDoc') ?? false;
  const simplePosEnabled = anchorFlag('simplePos') ?? false;
  const framePr =
    findDirectKind(anchor.children, 'drawingGraphicFramePr') ??
    (compatibilityMode
      ? findDirectChild(anchor.children, {
          namespaceUri: WP_NAMESPACE_URI,
          localName: 'cNvGraphicFramePr',
        })
      : null);
  const locks = mergedDrawingLocks(readFrameLocks(framePr), shapeLocksOf(anchor));
  const pictureResult = projectPicture(anchor, state, ctx, namespaceScope, compatibilityMode);
  if (pictureResult.diagnostic) state.diagnostics.push(pictureResult.diagnostic);
  if (state.refused) {
    return buildUnrenderableProjection(drawing, ctx, state, kind, extent);
  }
  const wrapGeometry =
    kind === 'anchored' ? readWrapGeometry(wrapElement, state, drawing.id, anchor) : null;
  const position = kind === 'anchored' ? readPosition(anchor, simplePosEnabled) : null;
  const anchorMeta =
    kind === 'anchored'
      ? Object.freeze({
          simplePos: simplePosEnabled,
          relativeHeight: parseEmu(schemaAttributeValue(anchor.attributes, 'relativeHeight')) ?? 0,
          behindDocument,
          layoutInCell: anchorFlag('layoutInCell') ?? true,
          allowOverlap: anchorFlag('allowOverlap') ?? true,
        })
      : null;
  const content = projectDrawingContent(
    anchor,
    extent,
    compatibilityMode,
    pictureResult.picture ? (pictureResult.element ?? null) : null,
    ctx
  );
  if (content.paints && pictureResult.diagnostic) {
    removeSupersededDrawingDiagnostic(state.diagnostics, pictureResult.diagnostic);
  }
  return freezeDrawingProjection(
    Object.freeze({
      drawingNodeId: drawing.id,
      ownerPartName: ctx.ownerPartName,
      kind,
      relationshipId: pictureResult.relationshipId,
      docPrId: metadata.docPrId,
      name: metadata.name,
      title: metadata.title,
      description: metadata.description,
      hyperlinkHref: metadata.hyperlinkHref,
      hidden: metadata.hidden,
      extentEmu: extent,
      effectExtentEmu: readEffectExtent(anchor, wrapElement, compatibilityMode),
      inlineDistancesEmu: kind === 'inline' ? readDistances(anchor) : EMPTY_EDGES,
      wrap: wrapTargetFromAnchor(kind, wrapElement, behindDocument),
      wrapGeometry,
      position,
      anchor: anchorMeta,
      picture: withPictureClip(pictureResult.picture, content),
      vectorShape: content.vectorShape,
      groupPicture: content.groupPicture,
      ...(content.groupPictureLayers ? { groupPictureLayers: content.groupPictureLayers } : {}),
      textboxStory: content.textboxStory,
      ...(content.groupTextboxes ? { groupTextboxes: content.groupTextboxes } : {}),
      ...(content.chartSummary ? { chartSummary: content.chartSummary } : {}),
      locks,
      effects: pictureResult.effects,
      compatibilityBranchNodeId: state.compatibilityBranchNodeId,
      diagnostics: state.diagnostics,
    })
  );
}

/** Project a drawing nested under a run-level MC wrapper. */
export function projectRunLevelMcDrawing(
  wrapper: OoxmlGenericElementNode,
  context: Readonly<{
    ownerPartName: string;
    supportedMcRequires: ReadonlySet<string>;
    limits: DrawingProjectionLimits;
    namespaceScope: ReadonlyMap<string, string>;
    resolveRelationship?: RelationshipTargetResolver;
    resolveSchemeColor?: ShapeSchemeColorResolver;
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
    resolveDiagramParts?: DiagramPartResolver;
    /** @deprecated Unsupported drawings retain visible placeholders; this option has no effect. */
    retainWrapFootprint?: boolean;
  }>
): DrawingProjection | null {
  const atom = resolveRunLevelMcAtom(
    wrapper,
    context.namespaceScope,
    context.supportedMcRequires,
    context.limits
  );
  return projectMcDrawingContent(
    wrapper,
    context,
    atom.drawing,
    () => {
      const state = createWalkState();
      const selected = selectCompatibilityBranch(
        wrapper,
        state,
        context.limits,
        context.namespaceScope,
        context.supportedMcRequires
      );
      return { branch: selected.branch, refused: state.refused };
    },
    projectDrawing,
    (anchor) => readDocPrMetadata(anchor, true)
  );
}

/**
 * How many text boxes deep the part scan will follow a story.
 *
 * A text box inside a text box is legal OOXML, and a hostile file can chain them: each
 * level is a fresh story root the scan would otherwise descend into unconditionally. The
 * element budget already bounds total work; this bounds the shape of it, so a deep chain
 * costs a few levels rather than the whole budget. Word itself stops rendering nested
 * boxes well before this.
 */
const MAX_TEXTBOX_STORY_NESTING = 4;

interface PartCollectFrame {
  readonly node: OoxmlNode;
  readonly namespaceScope: ReadonlyMap<string, string>;
  readonly depth: number;
  /** Text-box stories entered on the path to this node. */
  readonly storyDepth: number;
}

function collectDrawingsInPartBounded(
  root: OoxmlElement,
  ownerPartName: string,
  ctx: ProjectionContext,
  out: DrawingProjection[],
  atomIndex?: Map<string, DrawingProjection>
): void {
  const stack: PartCollectFrame[] = [
    { node: root, namespaceScope: emptyNamespaceScope(), depth: 0, storyDepth: 0 },
  ];
  let visited = 0;
  // A drawing that hosts a text box is not a leaf: its story is ordinary WML that can hold
  // pictures of its own, and those need projections (and atom ids) like any other run-level
  // drawing, or the story lays out with nothing to draw. Descend through the drawing's own
  // subtree rather than jumping to the story root, so the picture inside is read under the
  // xmlns bindings its ancestors declare — `a:graphicData` and `wps:wsp` routinely carry them.
  //
  // `from` is the node whose subtree actually holds the story. For a plain `w:drawing` that
  // is the drawing itself; for an `mc:AlternateContent` it is the CHOSEN branch, never the
  // wrapper — Word emits every anchored text box with a VML fallback carrying a duplicate
  // `w:txbxContent`, and descending the wrapper would project that dead copy too.
  const descendIntoTextboxStory = (
    from: OoxmlNode,
    frame: PartCollectFrame,
    scope: ReadonlyMap<string, string>
  ): void => {
    if (frame.storyDepth >= MAX_TEXTBOX_STORY_NESTING) return;
    if (frame.depth >= MAX_XML_DEPTH) return;
    if (!isElement(from)) return;
    for (let index = from.children.length - 1; index >= 0; index -= 1) {
      const child = from.children[index];
      if (!isElement(child)) continue;
      stack.push({
        node: child,
        namespaceScope: scope,
        depth: frame.depth + 1,
        storyDepth: frame.storyDepth + 1,
      });
    }
  };
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (!isElement(frame.node)) continue;
    visited += 1;
    // The tree is already size-bounded by the package read limits; this scan cap only
    // guards CPU on adversarial parts. `limits.maxVisitedElements` budgets one DRAWING's
    // subtree walk and is far below an ordinary document's total element count — using it
    // here silently dropped every drawing past the first few thousand elements.
    if (visited > MAX_PART_SCAN_ELEMENTS) break;
    if (frame.depth > MAX_XML_DEPTH) continue;

    const scope = namespaceScopeForNode(frame.namespaceScope, frame.node);

    const legacy = projectLegacyVml(frame.node, ownerPartName);
    if (legacy) {
      out.push(legacy);
      atomIndex?.set(frame.node.id, legacy);
      // Walk through the shape, as for a modern drawing, so namespace scope and depth stay exact.
      if (legacy.textboxStory) descendIntoTextboxStory(frame.node, frame, scope);
      continue;
    }

    if (frame.node.kind === 'drawing') {
      const projected = projectDrawing(frame.node, { ...ctx, namespaceScope: scope });
      if (projected) {
        out.push(projected);
        atomIndex?.set(frame.node.id, projected);
      }
      if (hostsTextboxStory(projected)) descendIntoTextboxStory(frame.node, frame, scope);
      continue;
    }

    if (isMcAlternateContent(frame.node)) {
      const projected = projectRunLevelMcDrawing(frame.node, {
        ownerPartName,
        supportedMcRequires: ctx.supportedMcRequires,
        limits: ctx.limits,
        namespaceScope: scope,
        resolveRelationship: ctx.resolveRelationship,
        resolveSchemeColor: ctx.resolveSchemeColor,
        resolveStyleMatrixReference: ctx.resolveStyleMatrixReference,
        resolveDiagramParts: ctx.resolveDiagramParts,
      });
      if (projected) {
        if (!projected.footprintOnly) out.push(projected);
        atomIndex?.set(frame.node.id, projected);
      }
      if (hostsTextboxStory(projected)) {
        const chosen = resolveRunLevelMcAtom(
          frame.node,
          scope,
          ctx.supportedMcRequires,
          ctx.limits
        ).drawing;
        if (chosen) descendIntoTextboxStory(chosen, frame, scope);
      }
      continue;
    }

    if (frame.depth >= MAX_XML_DEPTH) continue;
    for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
      const child = frame.node.children[index];
      if (isElement(child)) {
        stack.push({
          node: child,
          namespaceScope: scope,
          depth: frame.depth + 1,
          storyDepth: frame.storyDepth,
        });
      }
    }
  }
}

export function projectDrawingsInPart(
  part: OoxmlPart,
  context?: Partial<Omit<ProjectionContext, 'ownerPartName'>>
): readonly DrawingProjection[] {
  const ctx: ProjectionContext = {
    ownerPartName: part.name,
    supportedMcRequires: context?.supportedMcRequires ?? DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: context?.limits ?? DEFAULT_DRAWING_PROJECTION_LIMITS,
    stylesPart: context?.stylesPart,
    resolveRelationship: context?.resolveRelationship,
    resolveSchemeColor: context?.resolveSchemeColor,
    resolveStyleMatrixReference: context?.resolveStyleMatrixReference,
    resolveDiagramParts: context?.resolveDiagramParts,
  };
  const out: DrawingProjection[] = [];
  collectDrawingsInPartBounded(part.root, part.name, ctx, out);
  return Object.freeze(out.map(freezeDrawingProjection));
}

/** Run-level drawing / MC wrapper atom id → inline projection (namespace scope from part root). */
export function indexInlineDrawingProjectionsInPart(
  part: OoxmlPart,
  context?: Partial<Omit<ProjectionContext, 'ownerPartName'>>
): ReadonlyMap<string, DrawingProjection> {
  const ctx: ProjectionContext = {
    ownerPartName: part.name,
    supportedMcRequires: context?.supportedMcRequires ?? DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: context?.limits ?? DEFAULT_DRAWING_PROJECTION_LIMITS,
    stylesPart: context?.stylesPart,
    resolveRelationship: context?.resolveRelationship,
    resolveSchemeColor: context?.resolveSchemeColor,
    resolveStyleMatrixReference: context?.resolveStyleMatrixReference,
    resolveDiagramParts: context?.resolveDiagramParts,
  };
  const out: DrawingProjection[] = [];
  const atomIndex = new Map<string, DrawingProjection>();
  collectDrawingsInPartBounded(part.root, part.name, ctx, out, atomIndex);
  return Object.freeze(atomIndex);
}

const STORY_PART_RE =
  /^\/word\/(document|footnotes|endnotes)\.xml$|^\/word\/(header|footer)[^/]+\.xml$/;

export function projectDrawingsInPackage(
  pkg: OoxmlPackage,
  context?: Partial<{
    supportedMcRequires: ReadonlySet<string>;
    limits: DrawingProjectionLimits;
  }>
): readonly DrawingProjection[] {
  const projections: DrawingProjection[] = [];
  const theme = createPackageShapeThemeResolvers(pkg);
  for (const [partName, part] of pkg.parts) {
    if (!STORY_PART_RE.test(partName)) continue;
    // Appended in a loop rather than spread: the count is file-controlled, and a spread of
    // several hundred thousand arguments overflows the stack instead of being merely slow.
    const inPart = projectDrawingsInPart(part, {
      ...context,
      stylesPart: stylesPartOf(pkg),
      resolveRelationship: createDrawingRelationshipResolver(pkg, partName),
      resolveSchemeColor: theme.resolveSchemeColor,
      resolveStyleMatrixReference: theme.resolveStyleMatrixReference,
      resolveDiagramParts: createDiagramPartResolver(pkg, partName),
    });
    for (const projection of inPart) projections.push(projection);
  }
  return Object.freeze(projections.map(freezeDrawingProjection));
}

export { rangePartiallyOverlapsDrawingAtom } from './drawing-atom-range.ts';

export { isMcAlternateContent, namespaceScopeForNode, emptyNamespaceScope };
