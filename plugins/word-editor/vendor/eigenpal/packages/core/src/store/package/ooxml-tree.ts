// The canonical typed + generic ordered OOXML tree: node types and the bounded read path.
//
// This module remains the single entry point for the tree. The canonical serializer and
// semantic fingerprint live in ooxml-serialize.ts, the invariant walk in ooxml-validate.ts,
// and the name/namespace machinery all three share in ooxml-shared.ts — everything is
// re-exported from here, so importers keep one module to reach for.

import { readXml, type XmlLimits, type XmlNode, type XmlRejection } from './xml-reader.ts';
import { noteKindCompatible } from './ooxml-note-kinds.ts';
import {
  BLANK_TEXT,
  canonicalLegacyChildren,
  XML_INDENTATION_TEXT,
} from './ooxml-text-children.ts';
import { isXmlNCName } from './qname.ts';
import { candidateSdtKind } from './ooxml-sdt.ts';
import {
  EMPTY_NAMESPACE_BINDINGS,
  EMPTY_NODE_CHILDREN,
  OoxmlReadMetadata,
} from './ooxml-read-metadata.ts';
import {
  TreeReadError,
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  knownKindAllowsWmlVal,
  rejectDuplicateAttribute,
  splitQNameShared,
  validKnownKind,
  validateQNameAttributeValues,
  type ExpandedName,
  type KnownKind,
} from './ooxml-shared.ts';
import {
  demoteDrawingKindsInSubtree,
  isDrawingKnownKind,
  resolveDrawingElementKind,
  validateDrawingNode,
  type DrawingParentContext,
} from './ooxml-drawing-rules.ts';
import { notePartRoot, repairedChildren, staysGenericUnder } from './ooxml-structure-repair.ts';

export {
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  PIC_GRAPHIC_DATA_URI,
} from './ooxml-shared.ts';
export {
  canonicalOoxmlFingerprint,
  canonicalOoxmlFingerprintWithBindings,
  DEFAULT_FINGERPRINT_BINDINGS,
  ooxmlTreesEqual,
  serializeOoxmlPart,
} from './ooxml-serialize.ts';
export { validateOoxmlPart, validateOoxmlPartDelta } from './ooxml-validate.ts';

/**
 * A node's stable identity within its part.
 *
 * Minted deterministically from the structural path at parse, then RETAINED through structural
 * sharing — the same bytes always produce the same ids, and an edit elsewhere in the document
 * does not renumber untouched nodes. Every tree op addresses nodes by these.
 */
export type OoxmlNodeId = string;

/**
 * One `xmlns:` declaration carried on a node.
 *
 * Preserved rather than normalized away: a document that binds `w14` at the root and a document
 * that binds it on a paragraph are different bytes, and re-emitting the wrong one is a fidelity
 * loss even though the semantics match.
 */
export interface OoxmlNamespaceBinding {
  readonly prefix: string;
  readonly namespaceUri: string;
}

interface OoxmlAttributeBase {
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
  readonly value: string;
}

/** `xml:space`, which decides whether a run's leading and trailing whitespace survives. */
export interface OoxmlXmlSpaceAttribute extends OoxmlAttributeBase {
  readonly kind: 'xmlSpace';
  readonly namespaceUri: typeof XML_NAMESPACE_URI;
  readonly localName: 'space';
  readonly prefix: 'xml';
  readonly value: 'default' | 'preserve';
}

/** `w:val` — the attribute nearly every WordprocessingML property carries its value in. */
export interface OoxmlWmlValAttribute extends OoxmlAttributeBase {
  readonly kind: 'wmlVal';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'val';
}

/**
 * Any attribute outside the typed vocabulary, carried verbatim.
 *
 * Where losslessness actually happens: an attribute this engine has no model for is preserved
 * exactly rather than dropped, so a save re-emits what the file said.
 */
export interface OoxmlGenericExtensionAttribute extends OoxmlAttributeBase {
  readonly kind: 'genericExtension';
}

/** Any attribute on any node: the two typed ones, plus the verbatim catch-all. */
export type OoxmlAttribute =
  OoxmlXmlSpaceAttribute | OoxmlWmlValAttribute | OoxmlGenericExtensionAttribute;

/**
 * Attributes a TYPED node may carry.
 *
 * Excludes `w:val` on purpose: a node the engine models keeps its value in typed fields, and
 * allowing a stray `w:val` alongside them would create two sources of truth for one property.
 */
export type OoxmlKnownNodeAttribute = OoxmlXmlSpaceAttribute | OoxmlGenericExtensionAttribute;

interface OoxmlElementBase<
  Children extends readonly OoxmlNode[] = readonly OoxmlNode[],
  Attributes extends readonly OoxmlAttribute[] = readonly OoxmlAttribute[],
> {
  readonly id: OoxmlNodeId;
  readonly namespaceUri: string;
  readonly localName: string;
  /** Authored prefix retained as non-authoritative fidelity evidence. */
  readonly prefix?: string;
  /** Namespace declarations authored directly on this element, in source order. */
  readonly namespaceBindings: readonly OoxmlNamespaceBinding[];
  readonly attributes: Attributes;
  readonly children: Children;
}

/** `w:document` — the root of a main document part. */
export interface OoxmlDocumentNode extends OoxmlElementBase<
  readonly (OoxmlBodyNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'document';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'document';
}

/** `w:body` — the main story's block content. */
export interface OoxmlBodyNode extends OoxmlElementBase<
  readonly (
    OoxmlParagraphNode | OoxmlTableNode | OoxmlContentControlNode | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'body';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'body';
}

export interface OoxmlTableNode extends OoxmlElementBase<
  readonly (
    | OoxmlTablePropertiesNode
    | OoxmlTableGridNode
    | OoxmlTableRowNode
    | OoxmlContentControlNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'table';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tbl';
}

export interface OoxmlTableRowNode extends OoxmlElementBase<
  readonly (OoxmlTableCellNode | OoxmlContentControlNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableRow';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tr';
}

export interface OoxmlTableCellNode extends OoxmlElementBase<
  readonly (
    OoxmlParagraphNode | OoxmlTableNode | OoxmlContentControlNode | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableCell';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tc';
}

/** Grid children (`w:gridCol`) stay generic: they are property leaves, not structure. */
export interface OoxmlTableGridNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableGrid';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tblGrid';
}

/** Property children stay generic, mirroring `runProperties`. */
export interface OoxmlTablePropertiesNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tblPr';
}

/**
 * `w:p` — a paragraph, and the unit every offset in this engine is relative to.
 *
 * Positions are addressed as this node's id plus a UTF-16 offset, which is what makes a paragraph
 * inside a table cell no different from one at the top level.
 */
export interface OoxmlParagraphNode extends OoxmlElementBase<
  readonly (
    | OoxmlParagraphPropertiesNode
    | OoxmlRunNode
    | OoxmlHyperlinkNode
    | OoxmlContentControlNode
    | OoxmlBookmarkStartNode
    | OoxmlBookmarkEndNode
    | OoxmlRevisionContentNode
    | OoxmlRangeMarkerNode
    | OoxmlFldSimpleNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'paragraph';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'p';
}

/**
 * `CT_Hyperlink` (ECMA-376 §17.16.22) — a RUN CONTAINER, not a leaf.
 *
 * Its runs are part of the paragraph's inline sequence: they measure, paint, select and
 * take offsets exactly like a run written directly under the `w:p`. Typing the element is
 * what lets them in; while it was generic, its runs never reached the token stream and the
 * words inside every link simply did not paint.
 *
 * Targets live in the ATTRIBUTES, and §17.16.22 declares exactly six. They divide into two
 * groups, and the difference is load-bearing:
 *
 *   MODELED    `r:id` (a relationship, resolved against the owning part's rels), `w:anchor`
 *              (a bookmark name in this document) and `w:tooltip`. These are the three the
 *              ops read and write — `setHyperlinkTarget` sets one target attribute and
 *              CLEARS the other, so a link never carries both and resolves by the wrong one.
 *
 *   PRESERVED  `w:tgtFrame`, `w:docLocation` and `w:history`. Nothing in this engine
 *              interprets them and no op names them; they survive because attributes are
 *              carried verbatim, and `setHyperlinkTarget` must leave them exactly as
 *              authored. That is a REQUIREMENT, not an incidental property of the current
 *              applier: `w:docLocation` names a location inside the target document, so
 *              silently dropping it on a retarget would change where a link goes.
 *              `hyperlink-lossless-editing.test.ts` pins both against a retarget.
 *
 * Nothing here is a runtime URL — the sanitized projection is computed separately (see
 * `hyperlinkTargetOf`), and only that reaches a DOM or navigation sink.
 *
 * Bookmark markers are admitted as children because Word writes them inside links; anything
 * else it can carry (a drawing, a field, a nested SDT) stays `generic` at its position, so a
 * link around a picture keeps both the picture and the link.
 *
 * A link may contain ANOTHER link: §17.16.22's content model is `EG_PContent`, which lists
 * `w:hyperlink` among its own members. That is why this child union is self-referential
 * rather than bottoming out at runs. Demoting the inner one to `generic` would have been the
 * easier type, and it would have reintroduced exactly the bug typing this element fixed —
 * a generic link's runs never reach the token stream, so the words inside it stop painting.
 * Every walk that descends a link therefore recurses (`segmentsOf`, `runsUnder`,
 * `runPropertyEdits`) instead of descending one level.
 */
export interface OoxmlHyperlinkNode extends OoxmlElementBase<
  readonly (
    | OoxmlRunNode
    | OoxmlHyperlinkNode
    | OoxmlContentControlNode
    | OoxmlBookmarkStartNode
    | OoxmlBookmarkEndNode
    | OoxmlRevisionContentNode
    | OoxmlRangeMarkerNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'hyperlink';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'hyperlink';
}

/**
 * A content-position revision wrapper — `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`.
 *
 * These wrap runs, so a walk that visits only direct `run` children never reaches
 * the content inside them. Typing them is what lets layout descend deliberately
 * rather than treating tracked content as unknown markup.
 *
 * ECMA-376 §17.13.5.18/.14/.25/.29. All four extend `CT_TrackChange`: `@w:id` and
 * `@w:author` are required, `@w:date` is optional and is never fabricated.
 *
 * The SAME element names appear in property positions — `w:pPr/w:rPr/w:ins` marks a
 * paragraph mark, `w:trPr/w:del` marks a row — where they carry no content and mean
 * something structurally different. Those stay generic; see `contentRevisionKind`.
 */
export interface OoxmlRevisionContentNode extends OoxmlElementBase<
  readonly (
    | OoxmlRunNode
    | OoxmlRevisionContentNode
    | OoxmlHyperlinkNode
    | OoxmlRangeMarkerNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'revisionInsert' | 'revisionDelete' | 'revisionMoveFrom' | 'revisionMoveTo';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'ins' | 'del' | 'moveFrom' | 'moveTo';
}

/**
 * `w:bookmarkStart` — a ZERO-LENGTH point anchor (`@w:id`, `@w:name`).
 *
 * It takes no text offset and paints nothing; it only marks a position, which is what an
 * internal hyperlink's `w:anchor` names. Split and join place it by that position, the
 * behaviour `tree-op-split-anchors.test.ts` pins.
 */
export interface OoxmlBookmarkStartNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'bookmarkStart';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'bookmarkStart';
}

/** `w:bookmarkEnd` — the closing point anchor (`@w:id`), zero-length like its start. */
export interface OoxmlBookmarkEndNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'bookmarkEnd';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'bookmarkEnd';
}

/**
 * A range marker: the move-range and comment-range boundaries.
 *
 * Three of the base types in this family disagree, and the disagreement is load-bearing:
 *
 * - `w:moveFromRangeStart` / `w:moveToRangeStart` are `CT_MoveBookmark` (§17.13.5.22/.26):
 *   `@w:name`, `@w:author`, and `@w:date` are all REQUIRED.
 * - `w:moveFromRangeEnd` / `w:moveToRangeEnd` / `w:commentRangeStart` / `w:commentRangeEnd`
 *   are `CT_MarkupRange` (§17.13.5.21): `@w:id` only, with NO author and NO date. Requiring
 *   provenance here refuses valid files; writing it emits invalid XML.
 *
 * Two different join keys ride on these: `@w:name` pairs a `moveFrom` range with its
 * `moveTo` range, while `@w:id` pairs a range start with its own range end. In a real
 * document the two halves of a named pair carry different ids, so neither key substitutes
 * for the other.
 */
export interface OoxmlRangeMarkerNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind:
    | 'moveFromRangeStart'
    | 'moveFromRangeEnd'
    | 'moveToRangeStart'
    | 'moveToRangeEnd'
    | 'commentRangeStart'
    | 'commentRangeEnd';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName:
    | 'moveFromRangeStart'
    | 'moveFromRangeEnd'
    | 'moveToRangeStart'
    | 'moveToRangeEnd'
    | 'commentRangeStart'
    | 'commentRangeEnd';
}

/** `w:commentReference` — the in-run mark that carries the comment's anchor point. */
export interface OoxmlCommentReferenceNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'commentReference';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'commentReference';
}

/** The `word/comments.xml` root (`CT_Comments`, §17.13.4.2). */
export interface OoxmlCommentsNode extends OoxmlElementBase<
  readonly (OoxmlCommentNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'comments';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'comments';
}

/**
 * One comment (`CT_Comment`, §17.13.4.4) — `CT_TrackChange` plus `@w:initials`, holding
 * block content. The block content is why a comment body is a story rather than a string.
 */
export interface OoxmlCommentNode extends OoxmlElementBase<
  readonly (OoxmlParagraphNode | OoxmlTableNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'comment';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'comment';
}

/** `w:r` — a run: text and atoms sharing one set of character properties. */
export interface OoxmlRunNode extends OoxmlElementBase<
  readonly (
    | OoxmlRunPropertiesNode
    | OoxmlTextElementNode
    | OoxmlDeletedTextNode
    | OoxmlTabNode
    | OoxmlHardBreakNode
    | OoxmlCommentReferenceNode
    | OoxmlFldCharNode
    | OoxmlInstrTextNode
    | OoxmlNoteReferenceNode
    | OoxmlNoteRefNode
    | OoxmlSeparatorNode
    | OoxmlContinuationSeparatorNode
    | OoxmlDrawingNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'run';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'r';
}

/** `w:drawing` — run content only; exactly one typed inline or anchored child. */
export interface OoxmlDrawingNode extends OoxmlElementBase<
  readonly (OoxmlInlineDrawingNode | OoxmlAnchoredDrawingNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawing';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'drawing';
}

/** `wp:inline` / `wp:anchor` shared payload children. */
type OoxmlDrawingAnchorChild =
  | OoxmlDrawingExtentNode
  | OoxmlDrawingEffectExtentNode
  | OoxmlDrawingDocPrNode
  | OoxmlDrawingGraphicFramePrNode
  | OoxmlDrawingGraphicNode
  | OoxmlDrawingSimplePosNode
  | OoxmlDrawingPositionHNode
  | OoxmlDrawingPositionVNode
  | OoxmlDrawingWrapNoneNode
  | OoxmlDrawingWrapSquareNode
  | OoxmlDrawingWrapTightNode
  | OoxmlDrawingWrapThroughNode
  | OoxmlDrawingWrapTopBottomNode
  | OoxmlGenericElementNode;

/** `wp:inline` (`CT_Inline`) — typed only under `w:drawing`. */
export interface OoxmlInlineDrawingNode extends OoxmlElementBase<
  readonly OoxmlDrawingAnchorChild[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'inlineDrawing';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'inline';
}

/** `wp:anchor` (`CT_Anchor`) — typed only under `w:drawing`. */
export interface OoxmlAnchoredDrawingNode extends OoxmlElementBase<
  readonly OoxmlDrawingAnchorChild[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'anchoredDrawing';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'anchor';
}

export interface OoxmlDrawingExtentNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingExtent';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'extent';
}

export interface OoxmlDrawingEffectExtentNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingEffectExtent';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'effectExtent';
}

export interface OoxmlDrawingDocPrNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingDocPr';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'docPr';
}

export interface OoxmlDrawingGraphicFramePrNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingGraphicFramePr';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'cNvGraphicFramePr';
}

export interface OoxmlDrawingGraphicNode extends OoxmlElementBase<
  readonly (OoxmlDrawingGraphicDataNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingGraphic';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'graphic';
}

export interface OoxmlDrawingGraphicDataNode extends OoxmlElementBase<
  readonly (OoxmlPictureNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingGraphicData';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'graphicData';
}

export interface OoxmlDrawingSimplePosNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingSimplePos';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'simplePos';
}

export interface OoxmlDrawingPositionHNode extends OoxmlElementBase<
  readonly (
    OoxmlDrawingPositionAlignNode | OoxmlDrawingPositionOffsetNode | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingPositionH';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'positionH';
}

export interface OoxmlDrawingPositionVNode extends OoxmlElementBase<
  readonly (
    OoxmlDrawingPositionAlignNode | OoxmlDrawingPositionOffsetNode | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingPositionV';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'positionV';
}

export interface OoxmlDrawingPositionAlignNode extends OoxmlElementBase<
  readonly (OoxmlTextNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingPositionAlign';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'align';
}

export interface OoxmlDrawingPositionOffsetNode extends OoxmlElementBase<
  readonly (OoxmlTextNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingPositionOffset';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'posOffset';
}

export interface OoxmlDrawingWrapNoneNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapNone';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'wrapNone';
}

export interface OoxmlDrawingWrapSquareNode extends OoxmlElementBase<
  readonly (OoxmlDrawingEffectExtentNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapSquare';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'wrapSquare';
}

export interface OoxmlDrawingWrapTightNode extends OoxmlElementBase<
  readonly (OoxmlDrawingWrapPolygonNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapTight';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'wrapTight';
}

export interface OoxmlDrawingWrapThroughNode extends OoxmlElementBase<
  readonly (OoxmlDrawingWrapPolygonNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapThrough';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'wrapThrough';
}

export interface OoxmlDrawingWrapTopBottomNode extends OoxmlElementBase<
  readonly (OoxmlDrawingEffectExtentNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapTopBottom';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'wrapTopAndBottom';
}

export interface OoxmlDrawingWrapPolygonNode extends OoxmlElementBase<
  readonly (
    OoxmlDrawingWrapPolygonStartNode | OoxmlDrawingWrapPolygonLineToNode | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapPolygon';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'wrapPolygon';
}

export interface OoxmlDrawingWrapPolygonStartNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapPolygonStart';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'start';
}

export interface OoxmlDrawingWrapPolygonLineToNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'drawingWrapPolygonLineTo';
  readonly namespaceUri: typeof WP_NAMESPACE_URI;
  readonly localName: 'lineTo';
}

/** `pic:pic` (`CT_Picture`) — typed only under picture `a:graphicData`. */
export interface OoxmlPictureNode extends OoxmlElementBase<
  readonly (
    | OoxmlPictureNvPicPrNode
    | OoxmlPictureBlipFillNode
    | OoxmlPictureShapePropertiesNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'picture';
  readonly namespaceUri: typeof PIC_NAMESPACE_URI;
  readonly localName: 'pic';
}

export interface OoxmlPictureNvPicPrNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureNvPicPr';
  readonly namespaceUri: typeof PIC_NAMESPACE_URI;
  readonly localName: 'nvPicPr';
}

export interface OoxmlPictureBlipFillNode extends OoxmlElementBase<
  readonly (
    | OoxmlPictureBlipNode
    | OoxmlPictureSrcRectNode
    | OoxmlPictureStretchNode
    | OoxmlPictureTileNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureBlipFill';
  readonly namespaceUri: typeof PIC_NAMESPACE_URI;
  readonly localName: 'blipFill';
}

export interface OoxmlPictureBlipNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureBlip';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'blip';
}

export interface OoxmlPictureSrcRectNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureSrcRect';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'srcRect';
}

export interface OoxmlPictureStretchNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureStretch';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'stretch';
}

export interface OoxmlPictureTileNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureTile';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'tile';
}

export interface OoxmlPictureShapePropertiesNode extends OoxmlElementBase<
  readonly (OoxmlPictureTransformNode | OoxmlPicturePresetGeometryNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureShapeProperties';
  readonly namespaceUri: typeof PIC_NAMESPACE_URI;
  readonly localName: 'spPr';
}

export interface OoxmlPictureTransformNode extends OoxmlElementBase<
  readonly (
    OoxmlPictureTransformOffsetNode | OoxmlPictureTransformExtentNode | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureTransform';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'xfrm';
}

export interface OoxmlPictureTransformOffsetNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureTransformOffset';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'off';
}

export interface OoxmlPictureTransformExtentNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'pictureTransformExtent';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'ext';
}

export interface OoxmlPicturePresetGeometryNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'picturePresetGeometry';
  readonly namespaceUri: typeof DRAWINGML_MAIN_NAMESPACE_URI;
  readonly localName: 'prstGeom';
}

/**
 * `w:delText` (§17.3.3.7) — the text container a run uses once its content is deleted.
 *
 * Structurally identical to `w:t`, and deliberately a DIFFERENT kind: it must never flow
 * as ordinary text, and rejecting the deletion that contains it turns it back into `w:t`.
 */
export interface OoxmlDeletedTextNode extends OoxmlElementBase<
  readonly OoxmlTextNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'deletedText';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'delText';
}

/**
 * `w:rPr` — a run's character properties, whose children stay GENERIC.
 *
 * Deliberately unmodelled below this point: the property vocabulary is large and mostly
 * uninteresting to layout, so carrying it verbatim preserves everything without the engine having
 * to know what each element means.
 */
export interface OoxmlRunPropertiesNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'runProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'rPr';
}

/** `w:t` — the element holding a run's literal characters. */
export interface OoxmlTextElementNode extends OoxmlElementBase<
  readonly OoxmlTextNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'text';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 't';
}

/** `w:pPr` — a paragraph's properties. Children stay generic, like `w:rPr`'s. */
export interface OoxmlParagraphPropertiesNode extends OoxmlElementBase<
  readonly (OoxmlRunPropertiesNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'paragraphProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'pPr';
}

/** `w:tab` inside a run — one tab character as its own element. */
export interface OoxmlTabNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tab';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tab';
}

/** `w:br` — a line, column or page break; `w:cr` — a manual line break. */
export interface OoxmlHardBreakNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'hardBreak';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'br' | 'cr';
}

/**
 * Complex-field character (`w:fldChar`).
 *
 * Children stay generic so `w:ffData` (legacy form fields / macros) round-trips as inert
 * payload and is never promoted to an executable surface. `@w:fldCharType`, `@w:dirty`,
 * and `@w:fldLock` are preserved on `attributes`.
 */
export interface OoxmlFldCharNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'fldChar';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'fldChar';
}

/**
 * Field instruction text (`w:instrText`), same text-carrier shape as `w:t`.
 *
 * Instruction strings are never executed; layout may recognize allowlisted page-number
 * keywords only.
 */
export interface OoxmlInstrTextNode extends OoxmlElementBase<
  readonly OoxmlTextNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'instrText';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'instrText';
}

/**
 * Simple field (`w:fldSimple`) at paragraph content level.
 *
 * `@w:instr`, `@w:dirty`, and `@w:fldLock` round-trip on `attributes`. Cached result
 * children stay structurally preserved; the field is one atomic addressable unit.
 */
export interface OoxmlFldSimpleNode extends OoxmlElementBase<
  readonly (OoxmlRunNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'fldSimple';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'fldSimple';
}

/**
 * Footnotes part root (`w:footnotes`). Children are typed notes or preserved generics.
 * Never a story root itself — each note body is its own story for layout.
 */
export interface OoxmlFootnotesNode extends OoxmlElementBase<
  readonly (OoxmlNoteNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'footnotes';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'footnotes';
}

/**
 * Endnotes part root (`w:endnotes`). Same content model as {@link OoxmlFootnotesNode}.
 */
export interface OoxmlEndnotesNode extends OoxmlElementBase<
  readonly (OoxmlNoteNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'endnotes';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'endnotes';
}

/**
 * One footnote or endnote (`w:footnote` / `w:endnote`).
 *
 * Discriminated by `localName`. `@w:id` and optional `@w:type` (`ST_FtnEdn`, including
 * authored `normal`) live on `attributes`. Children are ordinary block content.
 */
export interface OoxmlNoteNode extends OoxmlElementBase<
  readonly (OoxmlParagraphNode | OoxmlTableNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'note';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'footnote' | 'endnote';
}

/**
 * Body citation (`w:footnoteReference` / `w:endnoteReference`) as a typed run child.
 * Display mark is derived — never stored as text. One UTF-16 atom in addressing.
 */
export interface OoxmlNoteReferenceNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'noteReference';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'footnoteReference' | 'endnoteReference';
}

/**
 * Auto mark inside a note body (`w:footnoteRef` / `w:endnoteRef`).
 * One UTF-16 atom; display digit is derived at paint time.
 */
export interface OoxmlNoteRefNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'noteRef';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'footnoteRef' | 'endnoteRef';
}

/** Run-inner separator rule (`w:separator`). One UTF-16 atom. */
export interface OoxmlSeparatorNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'separator';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'separator';
}

/** Run-inner continuation separator (`w:continuationSeparator`). One UTF-16 atom. */
export interface OoxmlContinuationSeparatorNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'continuationSeparator';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'continuationSeparator';
}

/**
 * `w:sdt` — structured document tag (content control) at block, inline, row, or cell level.
 *
 * Placement is not a separate kind: the same element name appears in every `EG_*Content`
 * group. Child shape is the union of those placements; parents admit the control wherever
 * `generic` was previously accepted (see `isPreservedChild`). Identity is the node id —
 * `w:id` inside `w:sdtPr` is optional, preserved when present, never fabricated here.
 */
export interface OoxmlContentControlNode extends OoxmlElementBase<
  readonly (
    | OoxmlContentControlPropertiesNode
    | OoxmlContentControlEndPropertiesNode
    | OoxmlContentControlContentNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControl';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'sdt';
}

/**
 * `w:sdtPr` (`CT_SdtPr`) — schema-ordered properties. Unmodelled children (alias/tag/id/lock
 * leaves with `w:val`, `w15:*`, empty type markers) stay `generic` in position. Typed
 * payloads: dropdown/combo/listItem, date (+ leaves), text, dataBinding, `w14:checkbox`.
 */
export interface OoxmlContentControlPropertiesNode extends OoxmlElementBase<
  readonly (
    | OoxmlRunPropertiesNode
    | OoxmlContentControlDataBindingNode
    | OoxmlContentControlDropDownListNode
    | OoxmlContentControlComboBoxNode
    | OoxmlContentControlDateNode
    | OoxmlContentControlTextNode
    | OoxmlContentControlCheckboxNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'sdtPr';
}

/** `w:sdtEndPr` — end-character properties; children are `w:rPr` or generic. */
export interface OoxmlContentControlEndPropertiesNode extends OoxmlElementBase<
  readonly (OoxmlRunPropertiesNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlEndProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'sdtEndPr';
}

/**
 * `w:sdtContent` — control contents for every placement. Block content is paragraphs/tables;
 * inline content is runs/hyperlinks; row/cell content is rows/cells. Nested controls stay typed.
 */
export interface OoxmlContentControlContentNode extends OoxmlElementBase<
  readonly OoxmlNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlContent';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'sdtContent';
}

/** `w:dropDownList` — `@w:lastValue` plus typed `w:listItem` children. */
export interface OoxmlContentControlDropDownListNode extends OoxmlElementBase<
  readonly (OoxmlContentControlListItemNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlDropDownList';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'dropDownList';
}

/** `w:comboBox` — same payload shape as dropdown; free entry is an editing concern. */
export interface OoxmlContentControlComboBoxNode extends OoxmlElementBase<
  readonly (OoxmlContentControlListItemNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlComboBox';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'comboBox';
}

/** `w:listItem` — `@w:displayText` / `@w:value` as preserved attributes (not `w:val`). */
export interface OoxmlContentControlListItemNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlListItem';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'listItem';
}

/**
 * `w:date` — `@w:fullDate` plus typed dateFormat/lid/storeMappedDataAs/calendar leaves.
 * Those leaves allow `w:val` (the only known kinds that do) so they are not demoted.
 */
export interface OoxmlContentControlDateNode extends OoxmlElementBase<
  readonly (
    | OoxmlContentControlDateFormatNode
    | OoxmlContentControlLidNode
    | OoxmlContentControlStoreMappedDataAsNode
    | OoxmlContentControlCalendarNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlDate';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'date';
}

/** `w:dateFormat` — the picture string a date picker formats its value with. */
export interface OoxmlContentControlDateFormatNode extends OoxmlElementBase<
  readonly [],
  readonly (OoxmlKnownNodeAttribute | OoxmlWmlValAttribute)[]
> {
  readonly kind: 'contentControlDateFormat';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'dateFormat';
}

/** `w:lid` — the language id a date picker parses and formats under. */
export interface OoxmlContentControlLidNode extends OoxmlElementBase<
  readonly [],
  readonly (OoxmlKnownNodeAttribute | OoxmlWmlValAttribute)[]
> {
  readonly kind: 'contentControlLid';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'lid';
}

/** `w:storeMappedDataAs` — which representation a bound date is written to its XML part as. */
export interface OoxmlContentControlStoreMappedDataAsNode extends OoxmlElementBase<
  readonly [],
  readonly (OoxmlKnownNodeAttribute | OoxmlWmlValAttribute)[]
> {
  readonly kind: 'contentControlStoreMappedDataAs';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'storeMappedDataAs';
}

/** `w:calendar` — which calendar system a date picker uses (Gregorian, Hijri, …). */
export interface OoxmlContentControlCalendarNode extends OoxmlElementBase<
  readonly [],
  readonly (OoxmlKnownNodeAttribute | OoxmlWmlValAttribute)[]
> {
  readonly kind: 'contentControlCalendar';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'calendar';
}

/** `w:text` (`CT_SdtText`) — distinct from `w:t` (`kind: 'text'`). `@w:multiLine` preserved. */
export interface OoxmlContentControlTextNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlText';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'text';
}

/**
 * `w:dataBinding` — xpath / storeItemID / prefixMappings preserved as attributes.
 * This tree never resolves or fetches the binding target.
 */
export interface OoxmlContentControlDataBindingNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlDataBinding';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'dataBinding';
}

/**
 * `w14:checkbox` — Microsoft extension, not an ECMA-376 type choice. Distinguishable from
 * untyped rich-text controls that merely wrap a `w:sym`.
 */
export interface OoxmlContentControlCheckboxNode extends OoxmlElementBase<
  readonly (
    | OoxmlContentControlCheckedNode
    | OoxmlContentControlCheckedStateNode
    | OoxmlContentControlUncheckedStateNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlCheckbox';
  readonly namespaceUri: typeof W14_NAMESPACE_URI;
  readonly localName: 'checkbox';
}

/** `w14:checked` — a checkbox's recorded state, independent of the glyph drawn for it. */
export interface OoxmlContentControlCheckedNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlChecked';
  readonly namespaceUri: typeof W14_NAMESPACE_URI;
  readonly localName: 'checked';
}

/** `w14:checkedState` — the font and code point drawn when a checkbox is checked. */
export interface OoxmlContentControlCheckedStateNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlCheckedState';
  readonly namespaceUri: typeof W14_NAMESPACE_URI;
  readonly localName: 'checkedState';
}

/** `w14:uncheckedState` — the font and code point drawn when a checkbox is not checked. */
export interface OoxmlContentControlUncheckedStateNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'contentControlUncheckedState';
  readonly namespaceUri: typeof W14_NAMESPACE_URI;
  readonly localName: 'uncheckedState';
}

/**
 * Any element the typed vocabulary does not cover — the other half of the preservation model.
 *
 * Also where a KNOWN element lands when it appears somewhere invalid: an element is demoted to
 * generic rather than rejected, so malformed or unfamiliar content is carried losslessly and
 * never locks editing.
 */
export interface OoxmlGenericElementNode extends OoxmlElementBase<readonly OoxmlNode[]> {
  readonly kind: 'generic';
}

/** A literal text value. The only node kind with no children and no attributes. */
export interface OoxmlTextNode {
  readonly id: OoxmlNodeId;
  readonly kind: 'textValue';
  readonly value: string;
}

/** Every element node kind: the typed vocabulary plus the generic catch-all. */
export type OoxmlElement =
  | OoxmlDocumentNode
  | OoxmlBodyNode
  | OoxmlParagraphNode
  | OoxmlRunNode
  | OoxmlHyperlinkNode
  | OoxmlBookmarkStartNode
  | OoxmlBookmarkEndNode
  | OoxmlRunPropertiesNode
  | OoxmlTextElementNode
  | OoxmlDeletedTextNode
  | OoxmlParagraphPropertiesNode
  | OoxmlTabNode
  | OoxmlHardBreakNode
  | OoxmlFldCharNode
  | OoxmlInstrTextNode
  | OoxmlFldSimpleNode
  | OoxmlFootnotesNode
  | OoxmlEndnotesNode
  | OoxmlNoteNode
  | OoxmlNoteReferenceNode
  | OoxmlNoteRefNode
  | OoxmlSeparatorNode
  | OoxmlContinuationSeparatorNode
  | OoxmlTableNode
  | OoxmlTableRowNode
  | OoxmlTableCellNode
  | OoxmlTableGridNode
  | OoxmlTablePropertiesNode
  | OoxmlRevisionContentNode
  | OoxmlRangeMarkerNode
  | OoxmlCommentReferenceNode
  | OoxmlCommentsNode
  | OoxmlCommentNode
  | OoxmlContentControlNode
  | OoxmlContentControlPropertiesNode
  | OoxmlContentControlEndPropertiesNode
  | OoxmlContentControlContentNode
  | OoxmlContentControlDropDownListNode
  | OoxmlContentControlComboBoxNode
  | OoxmlContentControlListItemNode
  | OoxmlContentControlDateNode
  | OoxmlContentControlDateFormatNode
  | OoxmlContentControlLidNode
  | OoxmlContentControlStoreMappedDataAsNode
  | OoxmlContentControlCalendarNode
  | OoxmlContentControlTextNode
  | OoxmlContentControlDataBindingNode
  | OoxmlContentControlCheckboxNode
  | OoxmlContentControlCheckedNode
  | OoxmlContentControlCheckedStateNode
  | OoxmlContentControlUncheckedStateNode
  | OoxmlDrawingNode
  | OoxmlInlineDrawingNode
  | OoxmlAnchoredDrawingNode
  | OoxmlDrawingExtentNode
  | OoxmlDrawingEffectExtentNode
  | OoxmlDrawingDocPrNode
  | OoxmlDrawingGraphicFramePrNode
  | OoxmlDrawingGraphicNode
  | OoxmlDrawingGraphicDataNode
  | OoxmlDrawingSimplePosNode
  | OoxmlDrawingPositionHNode
  | OoxmlDrawingPositionVNode
  | OoxmlDrawingPositionAlignNode
  | OoxmlDrawingPositionOffsetNode
  | OoxmlDrawingWrapNoneNode
  | OoxmlDrawingWrapSquareNode
  | OoxmlDrawingWrapTightNode
  | OoxmlDrawingWrapThroughNode
  | OoxmlDrawingWrapTopBottomNode
  | OoxmlDrawingWrapPolygonNode
  | OoxmlDrawingWrapPolygonStartNode
  | OoxmlDrawingWrapPolygonLineToNode
  | OoxmlPictureNode
  | OoxmlPictureNvPicPrNode
  | OoxmlPictureBlipFillNode
  | OoxmlPictureBlipNode
  | OoxmlPictureSrcRectNode
  | OoxmlPictureStretchNode
  | OoxmlPictureTileNode
  | OoxmlPictureShapePropertiesNode
  | OoxmlPictureTransformNode
  | OoxmlPictureTransformOffsetNode
  | OoxmlPictureTransformExtentNode
  | OoxmlPicturePresetGeometryNode
  | OoxmlGenericElementNode;

/**
 * Any node in the canonical tree.
 *
 * Typed where layout needs structure, generic everywhere else — one tree carries a whole document
 * whether or not the engine understands every part of it.
 */
export type OoxmlNode = OoxmlElement | OoxmlTextNode;

/** One XML part of the package, parsed into a canonical tree. */
export interface OoxmlPart {
  readonly id: string;
  /** Canonical part name, e.g. `/word/document.xml`. */
  readonly name: string;
  readonly contentType: string;
  readonly root: OoxmlElement;
}

/** A part's identity without its tree — enough to enumerate a package cheaply. */
export interface OoxmlPartMetadata {
  readonly name: string;
  readonly contentType: string;
}

/**
 * Why a part could not be read into a tree.
 *
 * Widens the XML-level rejections with the tree-level ones. All of them describe the FILE, which
 * is why reading returns a result rather than throwing.
 */
export type OoxmlReadRejection =
  | XmlRejection
  | 'missing-root'
  | 'multiple-roots'
  | 'invalid-name'
  | 'invalid-namespace'
  | 'undeclared-prefix'
  | 'duplicate-expanded-attribute';

/** A parsed part, or a typed refusal. Never throws — the input is untrusted by definition. */
export type OoxmlReadResult =
  | { readonly ok: true; readonly part: OoxmlPart }
  | { readonly ok: false; readonly reason: OoxmlReadRejection };

/**
 * The node-identity contract, written down as a type so it is checkable rather than merely
 * documented.
 *
 * Ids are deterministic from a normalized parse, retained through structural sharing, explicit on
 * replacement, and unique within a part. Everything that addresses nodes — ops, the caret, the
 * paraId bimap — depends on all four holding.
 */
export interface OoxmlNodeIdentityRules {
  readonly initial: 'deterministic-structural-path-after-normalized-parse';
  readonly unchanged: 'retain-id-through-structural-sharing';
  readonly replacement: 'explicitly-retain-or-allocate';
  readonly uniqueness: 'unique-within-part';
}

/**
 * Identity policy for future immutable tree edits. This defines the boundary
 * without implementing task 2.4 edit primitives.
 */
export const OOXML_NODE_IDENTITY_RULES: OoxmlNodeIdentityRules = Object.freeze({
  initial: 'deterministic-structural-path-after-normalized-parse',
  unchanged: 'retain-id-through-structural-sharing',
  replacement: 'explicitly-retain-or-allocate',
  uniqueness: 'unique-within-part',
});

/** What a tree invariant walk found wrong. Each names a rule the canonical tree must satisfy. */
export type OoxmlInvariantIssueCode =
  | 'invalid-id'
  | 'duplicate-id'
  | 'invalid-name'
  | 'invalid-namespace'
  | 'invalid-qname'
  | 'duplicate-expanded-attribute'
  | 'invalid-xml-value'
  | 'known-node-invariant';

/** One invariant violation, located by structural path and node id. */
export interface OoxmlInvariantIssue {
  readonly code: OoxmlInvariantIssueCode;
  readonly path: string;
  readonly nodeId?: string;
}

/** Whether a tree satisfies its invariants, listing every violation when it does not. */
export type OoxmlInvariantResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly OoxmlInvariantIssue[] };

type LegacyElement = Extract<XmlNode, { type: 'element' }>;

const KNOWN_WML_ELEMENTS: Readonly<Record<string, KnownKind>> = {
  document: 'document',
  body: 'body',
  p: 'paragraph',
  r: 'run',
  rPr: 'runProperties',
  t: 'text',
  delText: 'deletedText',
  pPr: 'paragraphProperties',
  tab: 'tab',
  br: 'hardBreak',
  cr: 'hardBreak',
  fldChar: 'fldChar',
  instrText: 'instrText',
  fldSimple: 'fldSimple',
  footnotes: 'footnotes',
  endnotes: 'endnotes',
  footnote: 'note',
  endnote: 'note',
  footnoteReference: 'noteReference',
  endnoteReference: 'noteReference',
  footnoteRef: 'noteRef',
  endnoteRef: 'noteRef',
  separator: 'separator',
  continuationSeparator: 'continuationSeparator',
  tbl: 'table',
  tr: 'tableRow',
  tc: 'tableCell',
  tblGrid: 'tableGrid',
  tblPr: 'tableProperties',
  hyperlink: 'hyperlink',
  bookmarkStart: 'bookmarkStart',
  bookmarkEnd: 'bookmarkEnd',
  moveFromRangeStart: 'moveFromRangeStart',
  moveFromRangeEnd: 'moveFromRangeEnd',
  moveToRangeStart: 'moveToRangeStart',
  moveToRangeEnd: 'moveToRangeEnd',
  commentRangeStart: 'commentRangeStart',
  commentRangeEnd: 'commentRangeEnd',
  commentReference: 'commentReference',
  comments: 'comments',
  comment: 'comment',
  sdt: 'contentControl',
};

/**
 * The three `w:sdt` members that are only themselves INSIDE a `w:sdt`.
 *
 * Typed by parent for the same reason the revision wrappers are: a stray `w:sdtContent`
 * elsewhere in a document is not a control's content, and typing it there would demote
 * whatever container held it — a body with one misplaced element would stop reporting
 * its own paragraphs.
 */
const CONTENT_CONTROL_INVALID_PARENTS: ReadonlySet<string> = new Set([
  'r',
  'rPr',
  'pPr',
  'trPr',
  'tcPr',
  'tblPr',
  'tblPrEx',
  'numPr',
  'sectPr',
  'sdtPr',
  'sdtEndPr',
]);

const SDT_MEMBER_KINDS: Readonly<Record<string, KnownKind>> = {
  sdtPr: 'contentControlProperties',
  sdtEndPr: 'contentControlEndProperties',
  sdtContent: 'contentControlContent',
};

function resolveElementKind(
  namespaceUri: string,
  localName: string,
  parent?: DrawingParentContext
): KnownKind | 'generic' {
  const drawingKind = resolveDrawingElementKind(namespaceUri, localName, parent);
  if (drawingKind !== null) return drawingKind as KnownKind | 'generic';
  if (namespaceUri === WML_NAMESPACE_URI) return wmlKindFor(localName, parent?.wmlLocalName);
  return 'generic';
}

/**
 * `w:ins` / `w:del` / `w:moveFrom` / `w:moveTo` in a CONTENT position, by parent.
 *
 * These four names are overloaded in WML. In a content position they wrap runs and are
 * a revision to the text. In a property position they are a revision to something else
 * entirely and hold no content:
 *
 * | Position | Meaning |
 * | --- | --- |
 * | `w:pPr/w:rPr/w:ins` | the PARAGRAPH MARK was inserted (`EG_ParaRPrTrackChanges`) |
 * | `w:trPr/w:del` | the table ROW was deleted |
 * | `w:tcPr/w:cellIns` | the CELL was inserted |
 * | `w:numPr/w:ins` | the numbering reference was inserted |
 *
 * Typing the property-position ones as content revisions would put empty wrappers into
 * the flow and invite a walker to "accept" them by deletion, which for a row leaves the
 * row present while reporting the deletion applied. They stay generic and are read by
 * name where their own semantics are implemented.
 *
 * Classification is by parent rather than by children because an EMPTY `w:ins` is legal
 * in both positions, so the children cannot tell them apart.
 */
const REVISION_CONTENT_KINDS: Readonly<Record<string, KnownKind>> = {
  ins: 'revisionInsert',
  del: 'revisionDelete',
  moveFrom: 'revisionMoveFrom',
  moveTo: 'revisionMoveTo',
};

/** Parents whose `w:ins`/`w:del` children are property revisions, not content revisions. */
const PROPERTY_REVISION_PARENTS: ReadonlySet<string> = new Set([
  'rPr',
  'pPr',
  'trPr',
  'tcPr',
  'tblPr',
  'tblPrEx',
  'numPr',
  'sectPr',
  'rPrChange',
  'pPrChange',
  'trPrChange',
  'tcPrChange',
  'tblPrChange',
  'tblPrExChange',
  'sectPrChange',
]);

/**
 * The kind for a WML element given the local name of its parent element.
 *
 * `parentLocalName` is undefined at a part root, where no revision element is in a
 * property position anyway.
 */
function wmlKindFor(localName: string, parentLocalName: string | undefined): KnownKind | 'generic' {
  const revision = REVISION_CONTENT_KINDS[localName];
  if (revision !== undefined) {
    return parentLocalName !== undefined && PROPERTY_REVISION_PARENTS.has(parentLocalName)
      ? 'generic'
      : revision;
  }
  const sdtMember = SDT_MEMBER_KINDS[localName];
  if (sdtMember !== undefined) return parentLocalName === 'sdt' ? sdtMember : 'generic';
  // A `w:sdt` reaches every CONTENT position WML has, but never a run's or a property
  // container's inside. Typed there it would demote the run that holds it, and a demoted
  // run takes its own text out of the addressable flow — the control stays generic.
  if (localName === 'sdt') {
    return parentLocalName !== undefined && CONTENT_CONTROL_INVALID_PARENTS.has(parentLocalName)
      ? 'generic'
      : 'contentControl';
  }
  // `w:br`/`w:cr` are run content (`EG_RunInnerContent`). A stray one written straight under a
  // paragraph or link, typed, demoted that container — and layout drops a generic paragraph
  // whole. It stays generic at its position instead, so the runs around it keep painting.
  if ((localName === 'br' || localName === 'cr') && parentLocalName !== undefined) {
    return parentLocalName === 'r' ? 'hardBreak' : 'generic';
  }
  if (parentLocalName !== undefined && staysGenericUnder(localName, parentLocalName))
    return 'generic';
  return KNOWN_WML_ELEMENTS[localName] ?? 'generic';
}

/**
 * @internal Freeze `node` and everything under it. A frozen node is skipped whole: reads
 * freeze bottom-up, so its subtree is frozen already.
 */
export function deepFreezeNode(node: OoxmlNode): OoxmlNode {
  if (Object.isFrozen(node)) return node;
  if (node.kind === 'textValue') return Object.freeze(node);
  // Equal attribute lists are shared across elements, so most are frozen already.
  if (!Object.isFrozen(node.attributes)) {
    for (const attribute of node.attributes) Object.freeze(attribute);
    Object.freeze(node.attributes);
  }
  if (!Object.isFrozen(node.namespaceBindings)) {
    for (const binding of node.namespaceBindings) Object.freeze(binding);
    Object.freeze(node.namespaceBindings);
  }
  for (const child of node.children) deepFreezeNode(child);
  Object.freeze(node.children);
  return Object.freeze(node);
}

function namespaceDeclarations(
  element: LegacyElement,
  inherited: ReadonlyMap<string, string>
): {
  readonly bindings: ReadonlyMap<string, string>;
  readonly authored: readonly OoxmlNamespaceBinding[];
} {
  // Copy-on-write: most elements declare nothing, and copying the inherited map per element
  // dominated parse allocation on long documents.
  let bindings: Map<string, string> | null = null;
  const authored: OoxmlNamespaceBinding[] = [];
  for (const name in element.attributes) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    const namespaceUri = element.attributes[name]!;
    bindings ??= new Map(inherited);
    const prefix = name === 'xmlns' ? '' : name.slice('xmlns:'.length);
    if (
      (prefix !== '' && !isXmlNCName(prefix)) ||
      prefix === 'xmlns' ||
      (prefix === 'xml' && namespaceUri !== XML_NAMESPACE_URI) ||
      (prefix !== 'xml' && namespaceUri === XML_NAMESPACE_URI) ||
      namespaceUri === XMLNS_NAMESPACE_URI ||
      (prefix !== '' && namespaceUri === '')
    )
      throw new TreeReadError('invalid-namespace');
    bindings.set(prefix, namespaceUri);
    authored.push({ prefix, namespaceUri });
  }
  return { bindings: bindings ?? inherited, authored };
}

function resolveElementName(
  authoredName: string,
  bindings: ReadonlyMap<string, string>
): ExpandedName & { readonly namespaceUri: string } {
  const name = splitQNameShared(authoredName);
  if (name.prefix === 'xmlns') throw new TreeReadError('invalid-namespace');
  if (name.prefix !== undefined) {
    const namespaceUri = bindings.get(name.prefix);
    if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
    return { ...name, namespaceUri };
  }
  return { ...name, namespaceUri: bindings.get('') ?? '' };
}

function resolveAttributes(
  element: LegacyElement,
  bindings: ReadonlyMap<string, string>
): {
  readonly attributes: readonly OoxmlAttribute[];
  readonly compatibleWithKnownNode: boolean;
  readonly hasWmlVal: boolean;
} {
  const attributes: OoxmlAttribute[] = [];
  const duplicates = { seen: undefined as Set<string> | undefined };
  let compatibleWithKnownNode = true;
  let hasWmlVal = false;
  // `for...in`: the attribute record has no prototype, and this runs for every element.
  for (const authoredName in element.attributes) {
    if (authoredName === 'xmlns' || authoredName.startsWith('xmlns:')) continue;
    const value = element.attributes[authoredName]!;
    const name = splitQNameShared(authoredName);
    let namespaceUri = '';
    if (name.prefix !== undefined) {
      namespaceUri = bindings.get(name.prefix) ?? '';
      if (!bindings.has(name.prefix)) throw new TreeReadError('undeclared-prefix');
      if (name.prefix === 'xmlns') throw new TreeReadError('invalid-namespace');
    }
    rejectDuplicateAttribute(attributes, namespaceUri, name.localName, duplicates);
    if (namespaceUri === XML_NAMESPACE_URI && name.localName === 'space') {
      if (name.prefix === 'xml' && (value === 'default' || value === 'preserve')) {
        attributes.push({
          kind: 'xmlSpace',
          namespaceUri: XML_NAMESPACE_URI,
          localName: 'space',
          prefix: 'xml',
          value,
        });
      } else {
        compatibleWithKnownNode = false;
        attributes.push({
          kind: 'genericExtension',
          namespaceUri,
          localName: name.localName,
          ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
          value,
        });
      }
    } else if (namespaceUri === WML_NAMESPACE_URI && name.localName === 'val') {
      hasWmlVal = true;
      attributes.push({
        kind: 'wmlVal',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'val',
        ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
        value,
      });
    } else {
      attributes.push({
        kind: 'genericExtension',
        namespaceUri,
        localName: name.localName,
        ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
        value,
      });
    }
  }
  return { attributes, compatibleWithKnownNode, hasWmlVal };
}

function resolvedXmlSpace(
  attributes: readonly OoxmlAttribute[],
  inheritedPreserve: boolean
): boolean {
  const value = attributes.find(
    (attribute) => attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space'
  )?.value;
  return value === 'preserve' ? true : value === 'default' ? false : inheritedPreserve;
}

/** Typed WML kinds whose text children are character content. */
const WML_TEXT_KINDS: ReadonlySet<string> = new Set(['text', 'deletedText', 'instrText']);

/** Typed drawing kinds whose value is their text (`wp:align`, `wp:posOffset`). */
const DRAWING_TEXT_KINDS: ReadonlySet<string> = new Set([
  'drawingPositionAlign',
  'drawingPositionOffset',
]);

/**
 * Whether `xml:space="preserve"` can make whitespace between this element's children content.
 *
 * `xml:space` is inherited by every descendant, but it only governs character content. Every
 * other typed kind has an element-only content model, so whitespace between its children is
 * indentation whatever the inherited value. Kept as a text child, it failed the kind's own
 * validation: a run written with its `w:t` on an indented line demoted to generic, and its
 * text left the flow. Unmodeled elements keep the whitespace, because their content model is
 * not known here.
 */
function preserveGovernsChildren(kind: KnownKind | 'generic'): boolean {
  return kind === 'generic' || WML_TEXT_KINDS.has(kind) || DRAWING_TEXT_KINDS.has(kind);
}

/**
 * One element's read state between opening it and closing it over its children.
 *
 * @internal The stepped part read converts the body's children in tasks of their own between
 * {@link openElement} and {@link closeElement}; the one-shot read does all three at once.
 */
export interface OpenedElement {
  readonly metadata: OoxmlReadMetadata;
  readonly partName: string;
  readonly path: string;
  readonly name: ReturnType<typeof resolveElementName>;
  readonly declarations: ReturnType<typeof namespaceDeclarations>;
  readonly resolvedAttributes: ReturnType<typeof resolveAttributes>;
  readonly attributes: readonly OoxmlAttribute[];
  readonly preserve: boolean;
  readonly candidateKind: KnownKind | 'generic';
  readonly childParent: DrawingParentContext;
  readonly parent: DrawingParentContext | undefined;
  readonly retainedChildren: readonly XmlNode[];
}

/** @internal Names, attributes, scope and candidate kind of `element`, before its children. */
export function openElement(
  element: LegacyElement,
  metadata: OoxmlReadMetadata,
  inherited: ReadonlyMap<string, string>,
  partName: string,
  path: string,
  inheritedPreserve: boolean,
  parentWmlLocalName?: string,
  parentCandidate: KnownKind | 'generic' | undefined = undefined,
  parent?: DrawingParentContext
): OpenedElement {
  const declarations = namespaceDeclarations(element, inherited);
  const name = resolveElementName(element.name, declarations.bindings);
  const { resolvedAttributes, attributes } = metadata.recordRead(
    element.attributes,
    declarations.bindings,
    () => {
      const resolved = resolveAttributes(element, declarations.bindings);
      return {
        resolvedAttributes: resolved,
        attributes: metadata.shareAttributes(resolved.attributes),
      };
    }
  );
  validateQNameAttributeValues(
    attributes,
    declarations.bindings,
    name.namespaceUri,
    name.localName
  );
  const preserve = resolvedXmlSpace(attributes, inheritedPreserve);
  if (parent === undefined) notePartRoot(metadata, attributes);
  const isWml = name.namespaceUri === WML_NAMESPACE_URI;
  // SDT vocabulary first (parent-contextual `w:lid` / checkbox states / run-misplaced
  // `w:sdt`), then WML known kinds including parent-gated content revisions.
  const contextualSdtMember =
    name.namespaceUri === WML_NAMESPACE_URI &&
    (name.localName === 'sdtPr' ||
      name.localName === 'sdtEndPr' ||
      name.localName === 'sdtContent');
  const sdtKind =
    contextualSdtMember && parentCandidate !== 'contentControl'
      ? undefined
      : candidateSdtKind(name.namespaceUri, name.localName, parentCandidate);
  const wmlKind: KnownKind | 'generic' =
    sdtKind !== undefined
      ? (sdtKind as KnownKind)
      : isWml
        ? wmlKindFor(name.localName, parentWmlLocalName)
        : 'generic';
  const drawingKind = resolveElementKind(name.namespaceUri, name.localName, parent);
  const candidateKind =
    drawingKind !== 'generic' && isDrawingKnownKind(drawingKind) ? drawingKind : wmlKind;
  const preserveGoverns = preserveGovernsChildren(candidateKind);
  const retainedChildren = canonicalLegacyChildren(
    element.children,
    preserve && preserveGoverns,
    WML_TEXT_KINDS.has(candidateKind),
    preserve && !preserveGoverns ? XML_INDENTATION_TEXT : BLANK_TEXT
  );
  const childParent: DrawingParentContext = {
    wmlLocalName: isWml ? name.localName : undefined,
    kind: candidateKind,
    namespaceUri: name.namespaceUri,
    localName: name.localName,
    attributes,
  };
  return {
    metadata,
    partName,
    path,
    name,
    declarations,
    resolvedAttributes,
    attributes,
    preserve,
    candidateKind,
    childParent,
    parent,
    retainedChildren,
  };
}

/** @internal {@link openElement} for `child`, the `index`th retained child of `opened`. */
export function openChildOf(
  opened: OpenedElement,
  child: LegacyElement,
  index: number
): OpenedElement {
  const { childParent } = opened;
  return openElement(
    child,
    opened.metadata,
    opened.declarations.bindings,
    opened.partName,
    childPath(opened.path, index),
    opened.preserve,
    childParent.wmlLocalName,
    childParent.kind === 'generic' ? undefined : (childParent.kind as KnownKind),
    childParent
  );
}

// Ids and paths are built with `join`, which gives a flat string. A template literal gives a
// rope that points at the parent's path, and a large document kept millions of those.
const childPath = (path: string, index: number): string => [path, index].join('.');
const nodeId = (partName: string, path: string): string => [partName, path].join('#');

/** @internal The read of `child`, the `index`th retained child of `opened`. */
export function convertChildOf(opened: OpenedElement, child: XmlNode, index: number): OoxmlNode {
  if (child.type === 'text')
    return {
      id: nodeId(opened.partName, childPath(opened.path, index)),
      kind: 'textValue',
      value: child.value,
    };
  const own = openChildOf(opened, child, index);
  return closeElement(
    own,
    own.retainedChildren.map((grandchild, at) => convertChildOf(own, grandchild, at))
  );
}

/** @internal The kind checks and the node of `opened`, over its converted children. */
export function closeElement(opened: OpenedElement, converted: readonly OoxmlNode[]): OoxmlElement {
  const id = nodeId(opened.partName, opened.path);
  const children = repairedChildren(opened, converted, id);
  const { name, declarations, resolvedAttributes, attributes, candidateKind, parent } = opened;
  const attributesOk =
    resolvedAttributes.compatibleWithKnownNode &&
    (!resolvedAttributes.hasWmlVal ||
      (candidateKind !== 'generic' && knownKindAllowsWmlVal(candidateKind)));
  const kindChecksPass =
    candidateKind !== 'generic' && isDrawingKnownKind(candidateKind)
      ? validateDrawingNode(candidateKind, name.localName, attributes, children, parent)
      : candidateKind !== 'generic' &&
        validKnownKind(candidateKind, children) &&
        noteKindCompatible(candidateKind, name.localName, attributes) &&
        (candidateKind !== 'fldChar' ||
          attributes.some((attribute) => {
            if (attribute.localName !== 'fldCharType') return false;
            if (attribute.namespaceUri !== WML_NAMESPACE_URI && attribute.namespaceUri !== '') {
              return false;
            }
            return (
              attribute.value === 'begin' ||
              attribute.value === 'separate' ||
              attribute.value === 'end'
            );
          }));

  const kind =
    candidateKind !== 'generic' && attributesOk && kindChecksPass ? candidateKind : 'generic';
  const finalChildren =
    kind === 'generic' && isDrawingKnownKind(candidateKind)
      ? demoteDrawingKindsInSubtree(children, name)
      : children;
  return {
    id,
    kind,
    namespaceUri: name.namespaceUri,
    localName: name.localName,
    ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
    namespaceBindings: declarations.authored.length
      ? declarations.authored
      : EMPTY_NAMESPACE_BINDINGS,
    attributes,
    children: finalChildren.length ? finalChildren : EMPTY_NODE_CHILDREN,
  } as OoxmlElement;
}

function convertElement(
  element: LegacyElement,
  metadata: OoxmlReadMetadata,
  inherited: ReadonlyMap<string, string>,
  partName: string,
  path: string,
  inheritedPreserve: boolean
): OoxmlElement {
  const opened = openElement(element, metadata, inherited, partName, path, inheritedPreserve);
  return closeElement(
    opened,
    opened.retainedChildren.map((child, index) => convertChildOf(opened, child, index))
  );
}

/** @internal The prefixes every part's root inherits. */
export function rootBindings(): Map<string, string> {
  return new Map([
    ['xml', XML_NAMESPACE_URI],
    ['xmlns', XMLNS_NAMESPACE_URI],
  ]);
}

/**
 * Read one XML part into the additive typed/generic foundation. Existing package
 * parsing and DocumentStore models intentionally remain unchanged until their
 * later migration tasks; this tree is not yet the repository's sole runtime authority.
 * Structural-path IDs are deterministic across normalized reopen. Preserving an
 * identity through moves and edits is deferred to PackageModel/DocumentStore integration.
 */
export function readOoxmlPart(
  xml: string,
  metadata: OoxmlPartMetadata,
  limits?: XmlLimits
): OoxmlReadResult {
  const result = readXml(xml, limits);
  if (!result.ok) return result;
  const roots = result.nodes.filter((node): node is LegacyElement => node.type === 'element');
  if (roots.length === 0) return { ok: false, reason: 'missing-root' };
  if (roots.length !== 1) return { ok: false, reason: 'multiple-roots' };
  try {
    const root = deepFreezeNode(
      convertElement(roots[0], new OoxmlReadMetadata(), rootBindings(), metadata.name, '0', false)
    ) as OoxmlElement;
    return {
      ok: true,
      part: Object.freeze({
        id: `part:${metadata.name}`,
        name: metadata.name,
        contentType: metadata.contentType,
        root,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof TreeReadError ? error.reason : 'parse-error',
    };
  }
}
