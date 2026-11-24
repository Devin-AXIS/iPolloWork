// Exporter-neutral document metadata and internal destination geometry.

import { caretAt } from '../layout/semantic-interaction.ts';
import { pastLeadingBreaks } from '../layout/paragraph-start-page.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import { pageContentOrigin, storyContentOffset } from '../layout/selection-rects.ts';
import {
  buildBookmarkIndex,
  resolveNotesPart,
  type BookmarkIndex,
  type DocumentProperties,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';

/** Bounded package metadata for exporter output dictionaries. @public */
export type ExportDocumentMetadata = Readonly<DocumentProperties>;

/** Model address shared by bookmarks and internal hyperlinks. @public */
export interface ExportDestinationAnchor {
  readonly name: string;
  readonly paragraphId: string;
  readonly offset: number;
}

/** Laid-out jump target in the coordinate spaces export traversal uses. @public */
export interface ExportDestinationGeometry {
  readonly anchor: ExportDestinationAnchor;
  readonly pageIndex: number;
  /** Caret geometry in page-content coordinates (same space as line boxes). */
  readonly pageContent: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly height: number;
  }>;
  /** Top-left of the caret in stacked page coordinates. */
  readonly pageStack: Readonly<{ readonly x: number; readonly y: number }>;
}

/** @internal */
export const EMPTY_EXPORT_DOCUMENT_METADATA: ExportDocumentMetadata = Object.freeze({});

/** @internal */
export const EMPTY_EXPORT_DESTINATIONS: readonly ExportDestinationGeometry[] = Object.freeze([]);

function freezeDocumentMetadata(properties: DocumentProperties): ExportDocumentMetadata {
  const keys = Object.keys(properties) as (keyof DocumentProperties)[];
  if (keys.length === 0) return EMPTY_EXPORT_DOCUMENT_METADATA;
  const copy: {
    title?: string;
    creator?: string;
    subject?: string;
    keywords?: string;
    lastModifiedBy?: string;
    description?: string;
    company?: string;
    manager?: string;
  } = {};
  for (const key of keys) {
    const value = properties[key];
    if (value !== undefined) copy[key] = value;
  }
  return Object.freeze(copy);
}

/** @internal */
export function buildExportBookmarkIndex(view: HeadlessDocumentView): BookmarkIndex {
  const merged = new Map(buildBookmarkIndex(view.part()));
  const seen = new Set([view.part()]);
  for (const section of view.headerFooterPartsBySection()) {
    for (const slots of [section.headers, section.footers] as const) {
      for (const part of slots.values()) {
        if (seen.has(part)) continue;
        seen.add(part);
        for (const [name, anchor] of buildBookmarkIndex(part)) {
          if (!merged.has(name)) merged.set(name, anchor);
        }
      }
    }
  }
  const pkg = view.currentPackage();
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = resolveNotesPart(pkg, kind);
    if (!part || seen.has(part)) continue;
    seen.add(part);
    for (const [name, anchor] of buildBookmarkIndex(part)) {
      if (!merged.has(name)) merged.set(name, anchor);
    }
  }
  return merged;
}

function resolveExportDestinationGeometry(
  layout: SemanticLayout,
  anchor: ExportDestinationAnchor
): ExportDestinationGeometry | null {
  // A heading bookmark written before a leading page break points at the heading text.
  const caret = caretAt(layout, pastLeadingBreaks(layout.pages, anchor));
  if (!caret) return null;
  const page = layout.pages[caret.pageIndex];
  if (!page) return null;
  const origin = pageContentOrigin(page);
  // caretAt answers in the line's story box. Body lines already sit in page-content space.
  // Header, footer and note lines do not; presenceRangeRects adds this same origin.
  const story = storyContentOffset(layout, anchor.paragraphId, caret.pageIndex);
  const pageContent = Object.freeze({
    x: caret.x + story.x,
    y: caret.y + story.y,
    height: caret.height,
  });
  return Object.freeze({
    anchor: Object.freeze({ ...anchor }),
    pageIndex: caret.pageIndex,
    pageContent,
    pageStack: Object.freeze({ x: origin.x + pageContent.x, y: origin.y + pageContent.y }),
  });
}

function collectExportDestinationGeometries(
  layout: SemanticLayout,
  bookmarks: BookmarkIndex
): readonly ExportDestinationGeometry[] {
  const resolved: ExportDestinationGeometry[] = [];
  for (const anchor of bookmarks.values()) {
    const geometry = resolveExportDestinationGeometry(layout, anchor);
    if (geometry) resolved.push(geometry);
  }
  return resolved.length === 0 ? EMPTY_EXPORT_DESTINATIONS : Object.freeze(resolved);
}

/** @internal */
export function attachExportDocumentResources(
  view: HeadlessDocumentView,
  layout: SemanticLayout
): {
  readonly documentMetadata: ExportDocumentMetadata;
  readonly destinations: readonly ExportDestinationGeometry[];
} {
  return {
    documentMetadata: freezeDocumentMetadata(view.documentProperties()),
    destinations: collectExportDestinationGeometries(layout, buildExportBookmarkIndex(view)),
  };
}

/**
 * Resolve one internal destination name from a Core-produced export layout.
 * @public
 */
export function exportDestinationNamed(
  layout: { readonly destinations?: readonly ExportDestinationGeometry[] },
  name: string
): ExportDestinationGeometry | undefined {
  const destinations = layout.destinations;
  if (!destinations) return undefined;
  for (const destination of destinations) {
    if (destination.anchor.name === name) return destination;
  }
  return undefined;
}
