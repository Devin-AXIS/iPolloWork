// Bounded package trust boundary: OPC names, content types, relationships
// (document-engine tasks 2.2, 2.6).
export {
  type NameRejection,
  type NameResult,
  normalizePartName,
  partNameKey,
  asciiFold,
  detectDuplicateNames,
  resolveInternalTarget,
  validateExternalTarget,
} from './opc-names.ts';
export {
  type DefaultRecord,
  type OverrideRecord,
  type ContentTypeRecords,
  type ContentTypeError,
  type ContentTypeIndex,
  type IndexResult,
  type ResolveResult,
  isValidMime,
  extensionKey,
  buildContentTypeIndex,
  resolveContentType,
} from './content-types.ts';
export {
  type TargetMode,
  type RelationshipRecord,
  type RelationshipError,
  type RelationshipSetResult,
  type ResolvedRelationship,
  type ImageRelationshipResolution,
  IMAGE_RELATIONSHIP_TYPE,
  buildRelationshipSet,
  resolveRelationship,
  resolveImageRelationship,
} from './relationships.ts';
export {
  DANGEROUS_KEYS,
  DangerousKeyError,
  isDangerousKey,
  nullRecord,
  toSafeRecord,
} from './safe-record.ts';
export {
  type XmlNode,
  type XmlRejection,
  type XmlResult,
  type XmlLimits,
  readXml,
  findElement,
  childElements,
  textContent,
} from './xml-reader.ts';
export {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  type OoxmlNodeId,
  type OoxmlNamespaceBinding,
  type OoxmlAttribute,
  type OoxmlXmlSpaceAttribute,
  type OoxmlWmlValAttribute,
  type OoxmlGenericExtensionAttribute,
  type OoxmlKnownNodeAttribute,
  type OoxmlDocumentNode,
  type OoxmlBodyNode,
  type OoxmlParagraphNode,
  type OoxmlRunNode,
  type OoxmlRunPropertiesNode,
  type OoxmlTextElementNode,
  type OoxmlParagraphPropertiesNode,
  type OoxmlTabNode,
  type OoxmlHardBreakNode,
  type OoxmlHyperlinkNode,
  type OoxmlBookmarkStartNode,
  type OoxmlBookmarkEndNode,
  type OoxmlFldCharNode,
  type OoxmlInstrTextNode,
  type OoxmlFldSimpleNode,
  type OoxmlFootnotesNode,
  type OoxmlEndnotesNode,
  type OoxmlNoteNode,
  type OoxmlNoteReferenceNode,
  type OoxmlNoteRefNode,
  type OoxmlSeparatorNode,
  type OoxmlContinuationSeparatorNode,
  type OoxmlContentControlNode,
  type OoxmlContentControlPropertiesNode,
  type OoxmlContentControlEndPropertiesNode,
  type OoxmlContentControlContentNode,
  type OoxmlContentControlDropDownListNode,
  type OoxmlContentControlComboBoxNode,
  type OoxmlContentControlListItemNode,
  type OoxmlContentControlDateNode,
  type OoxmlContentControlDateFormatNode,
  type OoxmlContentControlLidNode,
  type OoxmlContentControlStoreMappedDataAsNode,
  type OoxmlContentControlCalendarNode,
  type OoxmlContentControlTextNode,
  type OoxmlContentControlDataBindingNode,
  type OoxmlContentControlCheckboxNode,
  type OoxmlContentControlCheckedNode,
  type OoxmlContentControlCheckedStateNode,
  type OoxmlContentControlUncheckedStateNode,
  type OoxmlGenericElementNode,
  type OoxmlTextNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlPartMetadata,
  type OoxmlReadRejection,
  type OoxmlReadResult,
  type OoxmlNodeIdentityRules,
  type OoxmlInvariantIssueCode,
  type OoxmlInvariantIssue,
  type OoxmlInvariantResult,
  OOXML_NODE_IDENTITY_RULES,
  readOoxmlPart,
  validateOoxmlPart,
  serializeOoxmlPart,
  canonicalOoxmlFingerprint,
  ooxmlTreesEqual,
} from './ooxml-tree.ts';
export { readOnOffChild, isContentRevisionKind, isRangeMarkerKind } from './ooxml-shared.ts';
export { sha256FontBytes as sha256Bytes } from './sha256.ts';
export {
  relationshipsOf,
  relsPartNameFor,
  resolveContentTypeOf,
  contentTypesPartBytes,
  validatePackageInvariants,
  withContentTypeOverride,
  withNewPart,
  withRelationship,
  type PackageInvariantCode,
  type PackageInvariantIssue,
  type PackageInvariantResult,
} from './package-edit.ts';
export {
  allocateDrawingPropertyId,
  withBinaryPart,
  withEmbeddedImage,
  withoutUnreferencedImagePart,
  type DrawingPropertyIdResult,
} from './drawing-package-edit.ts';
export {
  type ZipRejection,
  type ZipLimits,
  type ZipReadResult,
  DEFAULT_ZIP_LIMITS,
  readZip,
  writeZip,
} from './zip.ts';
export { isValidNCName, isValidQName, assertValidQName, PrefixAllocator } from './qname.ts';
export {
  type HrefProjection,
  type InertExecutableKind,
  type ContentItem,
  type ScrubResult,
  sanitizeHref,
  escapeXml,
  escapeCssString,
  containsCssFetch,
  INERT_EXECUTABLE_KINDS,
  isInertExecutable,
  isEvaluableField,
  scrubExport,
} from './sinks.ts';
export {
  displayMathAlignment,
  equationsOfAtom,
  isOmmlDisplay,
  isOmmlEquationAtom,
  projectOmmlAtom,
  projectOmmlDisplay,
} from './omml-display.ts';
export {
  DEFAULT_OMML_LIMITS,
  OFFICE_MATH_NAMESPACE_URI,
  equationExpressionToLinearMath,
  linearMathToOmml,
  parseLinearMath,
  projectOmmlEquation,
  type EquationBoxEdges,
  type EquationBoxStrikes,
  type EquationControlSource,
  type EquationExpression,
  type LinearMathOmmlResult,
  type LinearMathParseResult,
  type LinearMathRejection,
  type OmmlEquationProjection,
  type OmmlLimits,
} from './omml-equation.ts';
export {
  readOoxmlPackage,
  writeOoxmlPackage,
  writeOoxmlPackageKeepingRevisionIds,
  withPart,
  DEFAULT_OOXML_PACKAGE_LIMITS,
  type OoxmlPackage,
  type OoxmlPackageLimits,
  type OoxmlPackageRejection,
  type OoxmlPackageResult,
  type OoxmlExternalTarget,
} from './ooxml-package.ts';
export {
  type SupportedImageMime,
  type RenderableImageMime,
  type PreservedImageMime,
  type ImageResourceState,
  type ImageDecodePort,
  type ImageResourceLookup,
  type CreateImageResourceCacheOptions,
  createImageResourceCache,
  imageResourceLookupFor,
  liveDrawingReferenceCount,
  sniffImageMime,
  hasBoundedSvgRoot,
  MAX_SVG_SNIFF_BYTES,
  validatePngHeader,
  validateGifHeader,
  validateJpegHeader,
  validateRasterHeader,
  type ValidatedRasterHeader,
} from './image-resources.ts';
export type { ValidatedImageBytesHandle } from './validated-image-bytes.ts';
export {
  resolveHeaderFooterParts,
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
  collectSectionPropertyNodes,
  type HeaderFooterKind,
  type HeaderFooterParts,
  type HeaderFooterSectionResolution,
  type HeaderFooterSlotMeta,
  type HeaderFooterVariant,
} from './hf-references.ts';
export {
  deobfuscateFont,
  readEmbeddedFonts,
  type EmbeddedFont,
  type FontStyleKey,
  type ReadEmbeddedFontsOptions,
} from './embedded-fonts.ts';
export {
  applyEdits,
  collectNodeIds,
  createNodeIdAllocator,
  findNode,
  hasNode,
  insertChildren,
  parentNodeOf,
  removeNode,
  replaceChildren,
  replaceNode,
  type ContentLockPolicy,
  type EditOptions,
  type OoxmlEditResult,
  type TransactionRevisionIds,
} from './ooxml-edit.ts';
export {
  PAGE_BREAK_CHAR,
  hardBreakAttributes,
  hardBreakKind,
  hardBreakText,
  isPageBreakNode,
  type HardBreakKind,
} from './hard-break.ts';
export {
  FIELD_ATOM_CHAR,
  atomicFieldSpansOf,
  fieldAtomText,
  fieldOnOffAttribute,
  fldCharType,
  fldSimpleInstr,
  hasLegacyFormFieldData,
  instrTextValue,
  isFieldChrome,
  isFldChar,
  isFldCharNode,
  isFldSimple,
  isFldSimpleNode,
  isInstrText,
  isInstrTextNode,
  isLegalFldCharType,
  type AtomicFieldSpan,
  type FldCharType,
} from './field-nodes.ts';
export type { FieldResultsMode } from './field-result-mode.ts';
export {
  TOC_MAX_BOOKMARKS_PER_REFRESH,
  TOC_MAX_ENTRIES,
  TOC_MAX_FIELD_NESTING,
  TOC_MAX_INSTRUCTION_CHARS,
  TOC_MAX_PAGE_PASSES,
  parseTocInstruction,
  type TocInstruction,
} from './toc-instruction.ts';
export { detectBodyTocs, findDetectedToc, type DetectedToc } from './toc-detect.ts';
export {
  bookmarkPairNodes,
  buildTocContentControl,
  buildTocEntryParagraph,
  planTocEntries,
  TOC_LEVEL_INDENT_TWIPS,
  tocEntryText,
  tocLeftIndentTwips,
  type TocEntryPlan,
  type TocOutlineHeading,
} from './toc-build.ts';
export { resolveTocRowHeadings } from './toc-rows.ts';
export {
  deriveOoxmlIndexes,
  indexStyles,
  numberingRootOf,
  stylesPartOf,
  type OoxmlIndexes,
  type ParagraphIndexEntry,
  type StoryIndexEntry,
  type StyleIndexEntry,
} from './ooxml-indexes.ts';
export {
  digestPart,
  diffSemanticDigests,
  semanticDigest,
  type DigestDifference,
  type ParagraphDigest,
  type SemanticDigest,
  type StoryDigest,
} from './ooxml-digest.ts';
export {
  isValidParaId,
  fnv1a32,
  mintParaId,
  mintedParagraphIdentityAttributes,
  normalizeParagraphIdentity,
  paraIdOf,
  usedParaIds,
  w14RootPrefix,
} from './para-id.ts';
export {
  ensureListDefinition,
  ensureNumberingLevel,
  type ListDefinitionGeometry,
  type ListKind,
  type ListLevelGeometry,
} from './numbering-part.ts';
export { buildBookmarkIndex, type BookmarkAnchor, type BookmarkIndex } from './bookmarks.ts';
export { listBookmarks, type BookmarkPosition, type BookmarkRecord } from './bookmark-list.ts';
export {
  bookmarkNameKey,
  bookmarkNameProblem,
  isHiddenBookmarkName,
  MAX_AUTHORED_BOOKMARK_NAME_LENGTH,
  type BookmarkNameProblem,
} from './bookmark-names.ts';
export {
  collectFlowBlocks,
  contentControlContentOf,
  isContentControl,
  isContentControlContent,
  walkAllStoryParagraphs,
  walkParagraphInline,
  walkStoryBlocks,
} from './content-control-walk.ts';
export {
  buildingBlockGalleryOf,
  buildingBlocksForControl,
  buildingBlocksOf,
  glossaryPartOf,
  type BuildingBlock,
  type BuildingBlockGalleryFilter,
} from './building-blocks.ts';
export {
  authorableHyperlinkTarget,
  ensureHyperlinkRelationship,
  relationshipTargetIn,
  type EnsuredHyperlinkRelationship,
} from './hyperlink-part.ts';
export {
  HYPERLINK_RELATIONSHIP_TYPE,
  OFFICE_RELATIONSHIP_NAMESPACE_URI,
  hyperlinkAnchorOf,
  hyperlinkRelationshipIdOf,
  hyperlinkTargetOf,
  isHyperlinkNode,
  type HyperlinkKind,
  type HyperlinkTarget,
  type RelationshipTargetResolver,
} from './hyperlink.ts';
export {
  applyHeaderFooterLifecycleOp,
  isHeaderFooterLifecycleOp,
  type HeaderFooterLifecycleImpact,
  type HeaderFooterLifecycleOp,
  type HeaderFooterLifecycleRejection,
  type HeaderFooterLifecycleResult,
} from './hf-lifecycle.ts';
export {
  NOTE_ATOM_CHAR,
  NOTE_CONTINUATION_SEPARATOR_ID,
  NOTE_ID_MAX,
  NOTE_ID_MIN,
  NOTE_SEPARATOR_ID,
  MAX_NOTES_PER_PART,
  allocateNoteId,
  atomicNoteSpansOf,
  customMarkFollows,
  findNoteById,
  formatNoteScopeId,
  isContinuationSeparatorNode,
  isEndnotesNode,
  isFootnotesNode,
  isNormalNote,
  isNoteAtomNode,
  isNoteNode,
  isNoteRefNode,
  isNoteReferenceNode,
  isSeparatorNode,
  noteAtomText,
  noteIdOf,
  noteKindOf,
  noteRefKindOf,
  noteReferenceKindOf,
  noteTypeOf,
  notesOf,
  parseNoteId,
  parseNoteScopeId,
  type AtomicNoteSpan,
  type NoteKind,
  type NoteType,
} from './note-nodes.ts';
export {
  DEFAULT_ENDNOTE_PROPERTIES,
  DEFAULT_FOOTNOTE_PROPERTIES,
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  isLegalEndnotePosition,
  isLegalFootnotePosition,
  isLegalNumRestart,
  parseAuthoredNoteProperties,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
  type AuthoredNoteProperties,
  type EndnotePosition,
  type FootnotePosition,
  type NoteNumRestart,
  type ResolvedEndnoteProperties,
  type ResolvedFootnoteProperties,
} from './note-properties.ts';
export {
  MAX_NOTE_REFERENCE_SCAN,
  MAX_NOTE_REFERENCE_PARTS,
  collectNoteReferences,
  collectPackageNoteReferences,
  createNoteReferenceScanBudget,
  diagnoseNoteReferences,
  normalNoteIds,
  notesPartHasId,
  resolveNotesPart,
  type NoteDiagnostic,
  type NoteDiagnosticCode,
  type NoteReferenceHit,
  type NoteReferenceScanBudget,
} from './note-references.ts';
export {
  applyNoteLifecycleOp,
  cascadeDeletedNoteReferences,
  isNoteLifecycleOp,
  type CascadeDeletedNoteReferencesOptions,
  type NoteLifecycleImpact,
  type NoteLifecycleOp,
  type NoteLifecycleOptions,
  type NoteLifecycleRejection,
  type NoteLifecycleResult,
} from './note-lifecycle.ts';
export {
  cascadeEmptiedComments,
  deleteCommentThread,
  hasAnyComment,
  type CommentDeletionOwner,
} from './comment-lifecycle.ts';
export { commentsPartNameForStory } from './comment-lifecycle-scan.ts';
export {
  NO_TRACKING_SETTINGS,
  readTrackingSettings,
  type DocumentTrackingSettings,
} from './tracking-settings.ts';
export {
  NO_DOCUMENT_PROTECTION,
  readDocumentProtection,
  type DocumentProtectionEdit,
  type DocumentProtectionState,
} from './document-protection.ts';
export {
  DEFAULT_VIEW_SETTINGS,
  readViewSettings,
  type DocumentViewSettings,
} from './view-settings.ts';
// Only the result type is public — it names `SemanticLayoutOptions.documentProperties` and the
// session accessor. The reader and its caps stay engine-internal; `binding` and tests import them
// directly from `./document-properties.ts`.
export { type DocumentProperties } from './document-properties.ts';
export {
  CONTENT_CONTROL_ID_MAX,
  CONTENT_CONTROL_PROPERTY_ORDER,
  MAX_CONTENT_CONTROLS_PER_PART,
  MAX_CONTENT_CONTROL_NESTING,
  allocateContentControlId,
  contentControlContentChildren,
  contentControlContentNodeOf,
  contentControlEndPropertiesNodeOf,
  contentControlLevelOf,
  contentControlPropertiesNodeOf,
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  findContentControl,
  flattenContentControls,
  isContentControlContentNode,
  isContentControlNode,
  isContentControlWrapper,
  lockForbidsEdit,
  lockForbidsRemoval,
  orderedContentControlProperties,
  parseContentControlId,
  resolveContentControlLock,
  type ContentControlCheckbox,
  type ContentControlCheckboxState,
  type ContentControlDataBinding,
  type ContentControlDateFormat,
  type ContentControlEntry,
  type ContentControlKind,
  type ContentControlLevel,
  type ContentControlListItem,
  type ContentControlLock,
  type ContentControlProperties,
} from './content-control-nodes.ts';
export {
  MAX_STORY_SDT_NESTING,
  bodyStoryRoot,
  collectStoryParagraphs,
  storyParagraphs,
  isStoryPart,
  storyRootsOf,
  type OoxmlStoryKind,
  type OoxmlStoryRoot,
} from './story-blocks.ts';
export { textboxStoriesInPart, type TextboxStoryRoot } from './textbox-stories.ts';
export {
  CUSTOM_XML_PROPS_REL,
  CUSTOM_XML_PROPS_TYPE,
  CUSTOM_XML_REL,
  DATASTORE_NAMESPACE_URI,
  customXmlDataParts,
  datastoreItemIdFor,
  findCustomXmlDataPart,
  withCustomXmlDataPart,
  withoutCustomXmlDataPart,
  type CustomXmlDataPart,
  type CustomXmlDataPartResult,
} from './custom-xml-part.ts';
export {
  customXmlLabelXPath,
  customXmlNodes,
  customXmlPrefixMappings,
  readCustomXmlNode,
  withCustomXmlNode,
  withoutCustomXmlNode,
  withoutOrphanCustomXmlNodes,
  type CustomXmlNode,
} from './custom-xml-nodes.ts';
export {
  CUSTOM_NODE_XPATH_PREFIX,
  boundCustomXmlNodeIdOf,
  boundCustomXmlNodeIds,
  boundCustomXmlNodeIdsInPackage,
  customNodeBinding,
  type CustomNodeBinding,
} from './custom-node-payloads.ts';
export {
  withExportedCustomNodes,
  type CustomNodeExportPolicy,
  type CustomNodeExportRequest,
  type CustomNodeExportResult,
} from './custom-node-export.ts';
export type { DrawingImageEffects } from './drawing-image-effects.ts';
// Drawing renderers a capability package installs, and the drawing readers they build on.
export {
  installDrawingRenderers,
  metafileRasterOptions,
  type ChartRenderContext,
  type DiagramLayoutOptions,
  type DiagramLayoutParts,
  type DrawingEffectsRenderer,
  type DrawingGraphicProjection,
  type DrawingRenderers,
  type LegacyTextArtContext,
  type MetafileRasterImage,
  type MetafileRenderer,
  type PictureEffectsProjection,
  type ShapeEffectsInput,
} from './drawing-renderers.ts';
export type {
  MetafileCommand,
  MetafileDrawing,
  MetafileFont,
  MetafileMatrix,
  MetafilePaint,
  MetafilePathCommand,
  MetafileRaster,
  MetafileReplay,
  MetafileRenderOptions,
} from './metafile-drawing.ts';
export type { PictureFrameEffects } from './drawing-picture-frame.ts';
export type { LegacyTextArtProjection } from './legacy-vml-text-art.ts';
export type {
  TextArtLayout,
  TextArtLayoutInput,
  TextArtLayoutRenderer,
  TextArtOutline,
} from './text-art-layout-hook.ts';
export { vmlFormulaValues } from './legacy-vml-formulas.ts';
export type { VmlFormulaContext } from './legacy-vml-formulas.ts';
// VML value readers: generic primitives for capability packages that read legacy drawings.
export {
  attribute as vmlAttribute,
  children as vmlChildren,
  color as vmlColor,
  legacyRotationDegrees,
  named as vmlNamed,
  numeric as vmlNumber,
  off as vmlOff,
  OFFICE as VML_OFFICE_NAMESPACE_URI,
  points as vmlPoints,
  styleOf as vmlStyle,
  VML as VML_NAMESPACE_URI,
  WORD_VML as VML_WORD_NAMESPACE_URI,
} from './legacy-vml-values.ts';
export type { MetafileImageMime } from './image-resources.ts';
export { CHART_GRAPHIC_DATA_URI, CHART_NAMESPACE_URI } from './chart-parts.ts';
export {
  CHART_STYLE_NAMESPACE_URI,
  CHARTEX_GRAPHIC_DATA_URI,
  CHARTEX_NAMESPACE_URI,
} from './chartex-parts.ts';
export { DIAGRAM_NAMESPACE_URI } from './diagram-parts.ts';
export { DRAWINGML_MAIN_NAMESPACE_URI } from './ooxml-tree.ts';
export type {
  ShapeSchemeColorResolver,
  TextboxStoryProjection,
  VectorShapeComponent,
  VectorShapeProjection,
} from './drawing-shape-projection.ts';
export type { ShapeColor } from './drawing-shape-color.ts';
export type { ShapeEffectList, ShapeReflection, ShapeShadow } from './drawing-shape-effects.ts';
export type { VectorGradient } from './drawing-gradient.ts';
export type { VectorPattern } from './drawing-pattern-fill.ts';
export type { EvaluatedGeometry, GeometryDefinition } from './drawing-geometry-engine.ts';
export type {
  DrawingTextDefaults,
  LoweredDrawingText,
  TextBodyLowering,
} from './drawingml-text-lowering.ts';
export type { GroupTextboxProjection } from './group-textbox-projection.ts';
export { directFill, resolveColorNode } from './drawing-shape-color.ts';
export { escapeXmlAttribute, isValidXmlText } from './sinks.ts';
export { evaluateGeometry, presetGeometryDefinition } from './drawing-geometry-engine.ts';
export { findDirectChild, parseEmu } from './drawing-shape-readers.ts';
export { findGraphicData } from './drawing-group-frame.ts';
export { isElement } from './drawing-projection-walk.ts';
export { lowerDrawingTextBody } from './drawingml-text-lowering.ts';
export { schemaAttributeValue } from './ooxml-drawing-rules.ts';
export { shapeThemeCacheToken } from './theme-color-resolution.ts';
