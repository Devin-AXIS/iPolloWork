/**
 * `@docx-editor.dev/core/binding` — the canonical tree ↔ ProseMirror binding.
 *
 * Forward: project one revision of the tree into a ProseMirror doc. Reverse: explain an edited
 * doc as the smallest set of tree ops, or REFUSE. The reverse direction never reconstructs the
 * tree from the projection, so anything the projection does not model stays carried by the tree.
 *
 * @packageDocumentation
 * @public
 */
// Lane: binding. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// The only ProseMirror-aware lane: projects a tree revision into a PM doc, and maps an
// edited doc back into tree ops or refuses.

export { treeSchema, runPropsOf, type ParagraphAttrs } from './tree-schema.ts';
export {
  bodyParagraphs,
  docToTreeOps,
  partHasNode,
  reconcileDoc,
  treeToDoc,
  type MapResult,
  type TreeBindingRejection,
} from './tree-binding.ts';
export {
  openTreeSession,
  PROJECTION_ORIGIN,
  type DocumentStyleEntry,
  type PackageWriteOptions,
  type OpenTreeSessionResult,
  type TreeApplyOptions,
  type TreeApplyResult,
  type TreeDocxSession,
  type TreeDocxSessionView,
  type TreeSessionRejection,
} from './tree-session.ts';
export type {
  DrawingTreeDocOp,
  StoryScope,
  StoryTargetRejection,
} from '@docx-editor.dev/core/store';
export type {
  ChartCopySource,
  ChartLanes,
  DuplicateChartInput,
} from '../store/store/tree-package-charts.ts';
export {
  mountTreeSurface,
  type TreeSurface,
  type TreeSurfaceOptions,
  type TreeSurfaceState,
} from './tree-surface.ts';
