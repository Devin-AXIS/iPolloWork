import type {
  EditorQueries,
  EditorQueryResults,
  ContainerRef,
  ContentControlFilter,
  RunFormatting,
} from '../contracts/editor.ts';
import { watermarkOf, watermarkQueryOf } from './docx-editor-watermark.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import {
  selectionRangeOf,
  paragraphSummaries,
  isInsideTocOf,
  hyperlinkAtOf,
  tableContextOf,
  splitCellConfigOf,
} from './docx-editor-derive.ts';
import { contentControlsOf, contentControlAtOf } from './content-controls.ts';
import { chartDataOf, chartFormatOf } from './chart-commands.ts';

/** Shared query answers, including typed empty results for unsupported reads. */
export function queryEditorDocument<K extends keyof EditorQueries>(
  surface: PaginatedSurface | null,
  formatting: () => RunFormatting | null,
  query: { type: K } & EditorQueries[K]
): EditorQueryResults[K] {
  // The real answers, and the typed empty value for everything else.
  switch (query.type as keyof EditorQueries) {
    case 'selectedText':
      return (surface?.selectedText() ?? '') as EditorQueryResults[K];
    case 'selectionFormatting':
      return (surface ? formatting() : null) as EditorQueryResults[K];
    case 'selection':
      return selectionRangeOf(surface) as EditorQueryResults[K];
    case 'paragraphs':
      return paragraphSummaries(
        surface,
        (query as { container?: ContainerRef }).container
      ) as unknown as EditorQueryResults[K];
    case 'isInsideToc':
      return isInsideTocOf(surface) as EditorQueryResults[K];
    case 'hyperlinkAt':
      return hyperlinkAtOf(surface) as EditorQueryResults[K];
    case 'contentControls':
      return contentControlsOf(
        surface,
        (query as { filter?: ContentControlFilter }).filter
      ) as unknown as EditorQueryResults[K];
    case 'trackedChanges':
    case 'revisions':
    case 'findText':
    case 'comments':
      return [] as unknown as EditorQueryResults[K];
    case 'styles':
      return {
        paragraph: new Map(),
        character: new Map(),
        table: new Map(),
      } as unknown as EditorQueryResults[K];
    case 'variables':
      return {} as EditorQueryResults[K];
    case 'contentControlAt':
      return contentControlAtOf(
        surface,
        (query as { filter?: ContentControlFilter }).filter
      ) as unknown as EditorQueryResults[K];
    case 'tableContext':
      return tableContextOf(surface) as EditorQueryResults[K];
    case 'splitCellConfig':
      return splitCellConfigOf(surface) as EditorQueryResults[K];
    case 'watermark':
      return watermarkQueryOf(surface) as EditorQueryResults[K];
    case 'bookmarks':
      return (surface?.bookmarkEditing.list() ?? []) as unknown as EditorQueryResults[K];
    case 'chartData':
      return chartDataOf(
        surface,
        (query as { drawingNodeId?: string }).drawingNodeId
      ) as EditorQueryResults[K];
    case 'chartFormat':
      return chartFormatOf(
        surface,
        (query as { drawingNodeId?: string }).drawingNodeId
      ) as EditorQueryResults[K];
    default:
      // pageContent is nullable and underived.
      return null as EditorQueryResults[K];
  }
}

export { watermarkOf };
