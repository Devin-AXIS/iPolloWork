// Cached drawing payloads are inert content. Field instructions never resolve image URLs.
import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { runDrawingAtomPlan } from './field-drawing-atom.ts';
import {
  appendModelRange,
  type MutableModelRange,
  type PendingFieldProjection,
  type PieceEmitExtras,
} from './field-pieces.ts';
import {
  projectPieceAttribution,
  revisionsVisible,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { AtomicFieldSynthesis } from './field-synthesis.ts';
import type { SpanLinkRecord } from './semantic-records.ts';
import type { BidiDirective } from './field-pieces.ts';

export interface CachedFieldDrawing {
  readonly textOffset: number;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  readonly extras: PieceEmitExtras;
}

export type FieldResultEmitter = (
  text: string,
  props: readonly OoxmlProperty[],
  style: ResolvedRunStyle,
  projected: boolean,
  start: number,
  end: number,
  extras?: PieceEmitExtras
) => void;

/** Capture a result picture while preserving the field's existing model range. */
export function captureFieldResultDrawing(
  pending: PendingFieldProjection,
  options: {
    readonly node: OoxmlNode;
    readonly layout?: InlineDrawingLayoutContext;
    readonly props: readonly OoxmlProperty[];
    readonly style: ResolvedRunStyle;
    readonly offset: number;
    readonly revisions: readonly RevisionAttribution[];
    readonly displayMode: RevisionDisplayMode;
    readonly authorFilter?: RevisionAuthorFilter;
    /** The link and direction wrappers around the drawing's run. */
    readonly tags: {
      readonly link?: SpanLinkRecord;
      readonly bidiDirectives?: readonly BidiDirective[];
    };
    readonly formatSite?: RevisionAttribution | null;
    readonly deletedRanges?: MutableModelRange[];
    readonly removed: (
      start: number,
      end: number,
      revisions: readonly RevisionAttribution[]
    ) => void;
  }
): number {
  const { props, style, revisions, displayMode, authorFilter } = options;
  const start = pending.atomic ? pending.atomStart : options.offset;
  const end = start + 1;
  const next = pending.atomic ? options.offset : end;
  if (!pending.atomic) pending.bufferOffset = next;
  if (pending.atomic && revisionsVisible(revisions, displayMode, authorFilter)) {
    pending.sawResultContent = true;
  }
  if (!options.layout) return next;
  const plan = runDrawingAtomPlan({
    node: options.node,
    layout: options.layout,
    hiddenRun: style.hidden,
    revisions,
    displayMode,
    authorFilter,
  });
  if (plan.recordDeleted && options.deletedRanges) {
    appendModelRange(options.deletedRanges, start, end);
  }
  if (!plan.emit) options.removed(start, end, revisions);
  const attribution = projectPieceAttribution(revisions, props, displayMode, authorFilter);
  if (!plan.emit || !plan.extras || !attribution || style.hidden) return next;
  const extras: PieceEmitExtras = {
    ...plan.extras,
    revisionsOverride: revisions,
    formatSiteOverride: options.formatSite,
    ...(options.tags.link ? { linkOverride: options.tags.link } : {}),
  };
  if (pending.atomic) {
    // A displayed result drawing donates its wrappers as a result run does.
    pending.resultDirectives ??= options.tags.bidiDirectives
      ? { bidiDirectives: options.tags.bidiDirectives }
      : {};
    (pending.cachedDrawings ??= []).push({
      textOffset: pending.cachedText.length,
      props,
      style,
      extras,
    });
    pending.cachedText += '\uFFFC';
  } else {
    pending.buffered.push({
      text: '\uFFFC',
      ...attribution,
      style,
      start,
      end,
      projected: true,
      ...plan.extras,
      ...options.tags,
      fieldAtom: { formField: pending.formField },
    });
  }
  return next;
}

/** Split only an unchanged cached result; live field values replace the entire cache. */
export function emitAtomicFieldResult(
  pending: PendingFieldProjection,
  synthesis: AtomicFieldSynthesis,
  extras: PieceEmitExtras,
  emit: FieldResultEmitter
): void {
  const start = pending.atomStart;
  const end = start + 1;
  if (!pending.cachedDrawings?.length || synthesis.text !== pending.cachedText) {
    emit(synthesis.text, synthesis.props, synthesis.style, true, start, end, extras);
    return;
  }
  let offset = 0;
  for (const drawing of pending.cachedDrawings) {
    if (drawing.textOffset > offset) {
      emit(
        synthesis.text.slice(offset, drawing.textOffset),
        synthesis.props,
        synthesis.style,
        true,
        start,
        end,
        extras
      );
    }
    emit('\uFFFC', drawing.props, drawing.style, true, start, end, {
      ...extras,
      ...drawing.extras,
    });
    offset = drawing.textOffset + 1;
  }
  if (offset < synthesis.text.length) {
    emit(synthesis.text.slice(offset), synthesis.props, synthesis.style, true, start, end, extras);
  }
}
