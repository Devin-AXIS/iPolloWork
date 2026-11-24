/**
 * `@docx-editor.dev/core/export` — DOM-free semantic export sessions and shared resources.
 *
 * Exporters consume the same published `SemanticLayout` records as the browser painter.
 * They do not parse OOXML or independently derive document semantics.
 *
 * @packageDocumentation
 * @public
 */

export {
  ExportResourceError,
  openDocumentForExport,
  type ExportDocumentSource,
  type ExportSemanticLayout,
  type ExportSession,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from './export-session.ts';
export {
  createNodeImageDecodePort,
  type PreservedImageConverter,
} from './node-image-decode-port.ts';
export {
  replayMetafile,
  type MetafileCommand,
  type MetafileDrawing,
  type MetafileFont,
  type MetafileMatrix,
  type MetafilePaint,
  type MetafilePathCommand,
  type MetafileRaster,
  type MetafileReplay,
  type MetafileReplayOptions,
} from './metafile-replay.ts';
export {
  MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS,
  acquireSharedExportShaping,
  type SharedExportShaping,
  type SharedExportShapingCapabilities,
} from './shared-export-shaping.ts';
export {
  hasFontBackedExportCapabilities,
  openFontBackedDocumentForExport,
  type FontBackedExportCapabilities,
  type FontBackedExportSession,
  type OpenFontBackedDocumentForExportOptions,
  type OpenFontBackedDocumentForExportResult,
} from './document-export-shaping.ts';
export {
  hasExportAdmittedFont,
  type ExportAdmittedFontApi,
  type ExportAdmittedFontFace,
  type ExportAdmittedFontIdentity,
  type ExportFontFaceResolution,
  type ExportFontFamilyResolution,
  type ExportFontResolutionReport,
  type ExportDroppedEmbeddedFont,
} from './document-export-font-resolution.ts';
export {
  hasExportLaidOutText,
  type ExportLaidOutText,
  type ExportLaidOutTextApi,
} from './export-laid-out-text.ts';
export {
  exportDestinationNamed,
  type ExportDestinationAnchor,
  type ExportDestinationGeometry,
  type ExportDocumentMetadata,
} from './export-document-resources.ts';
export {
  createPackagedFileFetch,
  type PackagedFileFetchOptions,
  type PackagedFileRead,
} from './packaged-file-fetch.ts';
export type { FontOrigin, FontOriginFailure } from '../editor/font-resolver.ts';
export type { FontRequest, FontSubstitution } from '../layout/font-resource.ts';

export type { ExportContentWarning } from './export-content-warnings.ts';
