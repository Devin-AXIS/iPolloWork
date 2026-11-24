/**
 * `@docx-editor.dev/core/store` — the canonical OOXML tree and the only write path into it.
 *
 * Bytes become a typed-where-layout-needs-it, generic-everywhere-else tree. Every mutation is a
 * `TreeDocOp` addressed by node id plus UTF-16 offset, applied in one transaction, so a batch
 * refused halfway leaves the document exactly as it was.
 *
 * This is also the trust boundary: zip and XML limits, entity-free parsing, OPC name validation,
 * and inert executable content all live here, because everything downstream assumes a sanitized
 * projection.
 *
 * @packageDocumentation
 * @public
 */
// Lane: store. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// Semantic core: bounded OPC/OOXML trust boundary, the canonical ordered OOXML tree,
// TreeDocumentStore, and TreeDocOp contracts. PM-free, DOM-free, Yjs-free,
// transport-neutral, PDF-free.

// Capability/runtime registry and frozen cross-cutting ids (task 0.1).
export * from './registry/index.ts';

// Runtime ports, budgets, cancellation, per-operation snapshots (task 0.3).
export * from './runtime/index.ts';

// Canonical artifact comparator formats (task 0.4).
export * from './comparators/index.ts';

// Shared conformance fixture format + replay harness (task 1.5).
export * from './conformance/index.ts';

// Bounded package trust boundary: OPC names, content types, relationships, the ordered
// OOXML tree, and the tree-lane package read/write (2.2, 2.6, tree lane).
export * from './package/index.ts';

// Semantic document store: TreeDocumentStore + TreeDocOps over the canonical tree.
export * from './store/index.ts';

// Narrow read capability shared by browser layout and server exporters.
export * from './headless-document-view.ts';

export { TABLE_BORDER_STYLES, type TableBorderStyle } from './table-border-style.ts';

// Branded length units and the one twips/points conversion pair.
export {
  TWIPS_PER_POINT,
  points,
  pointsToTwips,
  readTwipsMeasure,
  twips,
  twipsToPoints,
  type Points,
  type Twips,
} from './units.ts';

export { inspectDrawingSupport } from './package/drawing-support.ts';
export type {
  DrawingSupportEntry,
  DrawingSupportReport,
  DrawingSupportIssue,
  DrawingGraphicKind,
  DrawingSupport,
} from './package/drawing-support.ts';
export {
  createDrawingPreviewPackage,
  type DrawingPreviewPackageLimits,
  type DrawingPreviewPackageResult,
  type DrawingPreviewTarget,
} from './package/drawing-preview-package.ts';
