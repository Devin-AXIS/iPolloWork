/**
 * The horizontal ruler — page margins plus Word's four indent handles.
 *
 * Margins are the grey zones at either end; dragging the grey/white boundary moves them.
 *
 * The indent handles are Word's, not Google's three:
 *
 *   ▽  first line   at leftMargin + left + firstLine
 *   △  hanging      at leftMargin + left      — drags `left`, PINS the first-line marker
 *   ▭  left box     at leftMargin + left      — drags `left`, TAKES the first line with it
 *   △  right        at pageWidth - rightMargin - right
 *
 * The hanging triangle and the left box are coincident horizontally, as in Word, and are
 * separated vertically instead — the box sits below the strip. They differ only in what a
 * drag takes with them.
 *
 * All the arithmetic lives in the engine (`ruler-indent.ts`), including the snap grid and
 * the clamps, so this file only converts pixels to twips and paints.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import {
  dragIndent,
  handlePosition,
  rulerMarginTicks,
  rulerTabPosition,
  SNAP_TWIPS_CM,
  SNAP_TWIPS_INCH,
  type RulerIndent,
  type RulerIndentHandle,
  type RulerPageMetrics,
} from '@docx-editor.dev/core/editor';
import { twipsToPixels, pixelsToTwips, formatPx } from '../../lib/units';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Section page setup as the engine reports it (`Editor.getPageSetup()`) —
 * page size, orientation, and margins, in twips. Derived from the contract.
 */
export type RulerPageSetup = NonNullable<ReturnType<Editor['getPageSetup']>>;

/**
 * A tab stop the ruler paints. `position` is twips from the paragraph's leading margin
 * (the right one for a right-to-left paragraph) —
 * the same value the `removeTabMark` command takes as `positionTwips`.
 */
export interface RulerTabStop {
  position: number;
  alignment: 'left' | 'center' | 'right' | 'decimal' | 'bar';
}

export interface HorizontalRulerProps {
  pageSetup?: RulerPageSetup | null;
  zoom?: number;
  /** Whether the MARGIN handles drag. */
  editable?: boolean;
  onLeftMarginChange?: (marginTwips: number) => void;
  onRightMarginChange?: (marginTwips: number) => void;
  /** Fires when a margin drag is released — the moment to commit what the drag previewed. */
  onMarginDragEnd?: () => void;
  /**
   * Paint the four indent handles.
   *
   * Off by default so a ruler with no paragraph context does not show handles pinned at
   * zero. When on they are painted whatever `indentEditable` says: Word shows the markers
   * on a read-only document and simply refuses the drag, and hiding them would remove the
   * only place a reader can see a paragraph's indents.
   */
  showIndentHandles?: boolean;
  /** The paragraph's indent in twips; `firstLine` is SIGNED, negative for a hanging. */
  indent?: RulerIndent | null;
  /** Whether the INDENT handles drag — a different capability from `editable`. */
  indentEditable?: boolean;
  /** Fires continuously through an indent drag, for the host to preview. */
  onIndentChange?: (indent: RulerIndent) => void;
  /** Fires when an indent drag is released — the moment to commit one undoable step. */
  onIndentDragEnd?: () => void;
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
  tabMarks?: RulerTabStop[] | null;
  onTabMarkRemove?: (positionTwips: number) => void;
}

type MarkerType = 'leftMargin' | 'rightMargin' | RulerIndentHandle;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_WIDTH_TWIPS = 12240;
const DEFAULT_MARGIN_TWIPS = 1440;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;

/** The band carrying the grey margin zones, the ticks and the labels. */
const STRIP_HEIGHT = 20;
/** The left box hangs BELOW the strip, which is how it and the hanging triangle coexist. */
const BOX_HEIGHT = 6;
/** Full ruler height; consumers that stack chrome below the ruler derive from this. */
export const RULER_HEIGHT = STRIP_HEIGHT + BOX_HEIGHT + 2;

const RULER_TEXT_COLOR = 'var(--doc-text-muted)';
const RULER_TICK_COLOR = 'var(--doc-text-subtle)';
const MARGIN_ZONE_COLOR = 'var(--doc-shadow-subtle)';
const INDENT_COLOR = 'var(--doc-primary)';
const INDENT_HOVER_COLOR = 'var(--doc-primary-hover)';
const INDENT_DISABLED_COLOR = 'var(--doc-text-subtle)';

const TRI_SIZE = 5; // triangle half-width in px
const TRI_HEIGHT = 7;

const FLUSH: RulerIndent = { left: 0, right: 0, firstLine: 0 };

// ============================================================================
// HELPERS
// ============================================================================

function formatValueForTooltip(twips: number, unit: 'inch' | 'cm'): string {
  if (unit === 'inch') return (twips / TWIPS_PER_INCH).toFixed(2) + '"';
  return (twips / TWIPS_PER_CM).toFixed(1) + ' cm';
}

/** The keyboard nudge: one grid step, or one twip with Shift for fine placement. */
function nudgeStep(unit: 'inch' | 'cm', fine: boolean): number {
  if (fine) return 1;
  return Math.round(unit === 'cm' ? SNAP_TWIPS_CM : SNAP_TWIPS_INCH);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function HorizontalRuler({
  pageSetup,
  zoom = 1,
  editable = false,
  onLeftMarginChange,
  onRightMarginChange,
  onMarginDragEnd,
  showIndentHandles = false,
  indent,
  indentEditable = false,
  onIndentChange,
  onIndentDragEnd,
  unit = 'inch',
  className = '',
  style,
  tabMarks,
  onTabMarkRemove,
}: HorizontalRulerProps): React.ReactElement {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState<MarkerType | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<MarkerType | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [dragPositionPx, setDragPositionPx] = useState<number | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const pageWidthTwips = pageSetup?.pageWidthTwips ?? DEFAULT_PAGE_WIDTH_TWIPS;
  const leftMarginTwips = pageSetup?.marginsTwips.left ?? DEFAULT_MARGIN_TWIPS;
  const rightMarginTwips = pageSetup?.marginsTwips.right ?? DEFAULT_MARGIN_TWIPS;
  // The binding gutter narrows the content area exactly as the left margin does, so the
  // margin clamps must count it — the engine refuses margins that swallow the page.
  const gutterTwips = pageSetup?.gutterTwips ?? 0;

  const page: RulerPageMetrics = {
    pageWidth: pageWidthTwips,
    leftMargin: leftMarginTwips,
    rightMargin: rightMarginTwips,
  };
  const current = indent ?? FLUSH;

  const pageWidthPx = twipsToPixels(pageWidthTwips) * zoom;
  const leftMarginPx = twipsToPixels(leftMarginTwips) * zoom;
  const rightMarginPx = twipsToPixels(rightMarginTwips) * zoom;

  /** Twips from the page's left sheet edge, for a client x. */
  const twipsAt = useCallback(
    (clientX: number): number | null => {
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return pixelsToTwips((clientX - rect.left) / zoom);
    },
    [zoom]
  );

  const handleMove = useCallback(
    (marker: MarkerType, clientX: number, altKey: boolean) => {
      const positionTwips = twipsAt(clientX);
      if (positionTwips === null) return;
      setDragPositionPx(twipsToPixels(positionTwips) * zoom);

      if (marker === 'leftMargin' || marker === 'rightMargin') {
        // Margins keep their own clamps: unlike indents these mirror an engine refusal, so
        // a drag past them would only produce a rejected command.
        if (marker === 'leftMargin') {
          const maxMargin = pageWidthTwips - rightMarginTwips - gutterTwips - 720;
          const rounded = Math.round(Math.max(0, Math.min(positionTwips, maxMargin)));
          setDragValue(rounded);
          onLeftMarginChange?.(rounded);
        } else {
          const fromRight = pageWidthTwips - positionTwips;
          const maxMargin = pageWidthTwips - leftMarginTwips - gutterTwips - 720;
          const rounded = Math.round(Math.max(0, Math.min(fromRight, maxMargin)));
          setDragValue(rounded);
          onRightMarginChange?.(rounded);
        }
        return;
      }
      // Alt bypasses the snap grid, as in Word.
      const next = dragIndent(marker, positionTwips, current, page, { unit, precise: altKey });
      setDragValue(
        marker === 'right' ? next.right : marker === 'firstLine' ? next.firstLine : next.left
      );
      onIndentChange?.(next);
    },
    [
      twipsAt,
      zoom,
      pageWidthTwips,
      leftMarginTwips,
      rightMarginTwips,
      gutterTwips,
      onLeftMarginChange,
      onRightMarginChange,
      onIndentChange,
      current,
      page,
      unit,
    ]
  );

  const endDrag = useCallback(
    (marker: MarkerType) => {
      if (marker === 'leftMargin' || marker === 'rightMargin') onMarginDragEnd?.();
      else onIndentDragEnd?.();
      setDragging(null);
      setDragValue(null);
      setDragPositionPx(null);
    },
    [onMarginDragEnd, onIndentDragEnd]
  );

  /** Arrow-key operation, so a focusable slider is an operable one (WCAG 2.1.1). */
  const nudge = useCallback(
    (marker: RulerIndentHandle, direction: -1 | 1, fine: boolean) => {
      const at = handlePosition(marker, current, page);
      const next = dragIndent(marker, at + direction * nudgeStep(unit, fine), current, page, {
        unit,
        // A nudge is already an exact step; snapping it again would swallow small moves.
        precise: true,
      });
      onIndentChange?.(next);
      // No drag to release, so the commit is immediate — one undo entry per keypress.
      onIndentDragEnd?.();
    },
    [current, page, unit, onIndentChange, onIndentDragEnd]
  );

  // Numbers count from the margin the paragraph starts at, the right one when it reads
  // right to left.
  const ticks = rulerMarginTicks(page, current, unit).map((tick) => ({
    ...tick,
    position: twipsToPixels(tick.position) * zoom,
  }));
  const indentDraggable = showIndentHandles && indentEditable && onIndentChange !== undefined;

  const marker = (handle: RulerIndentHandle): number =>
    twipsToPixels(handlePosition(handle, current, page)) * zoom;

  const handleProps = (
    handle: RulerIndentHandle,
    labelKey: Parameters<typeof t>[0],
    value: number
  ) => ({
    positionPx: marker(handle),
    editable: indentDraggable,
    isDragging: dragging === handle,
    isHovered: hoveredMarker === handle,
    onPointerEnter: () => setHoveredMarker(handle),
    onPointerLeave: () => setHoveredMarker(null),
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!indentDraggable) return;
      event.preventDefault();
      event.stopPropagation();
      // Capture, so a pointer that leaves the ruler — or the window — still reports its
      // move and its release. The old document-level mouse listeners could latch `dragging`
      // forever when a mouseup landed outside the page.
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(handle);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragging !== handle) return;
      handleMove(handle, event.clientX, event.altKey);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragging !== handle) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      endDrag(handle);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (!indentDraggable) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      nudge(handle, event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
    },
    label: t(labelKey),
    valueNow: value,
    valueText: formatValueForTooltip(value, unit),
    pageWidthTwips,
  });

  return (
    <div
      ref={rulerRef}
      className={`docx-horizontal-ruler ${className}`}
      style={{
        position: 'relative',
        width: formatPx(pageWidthPx),
        height: RULER_HEIGHT,
        backgroundColor: 'transparent',
        overflow: 'visible',
        userSelect: 'none',
        touchAction: 'none',
        cursor: dragging ? 'ew-resize' : 'default',
        // The clamp-safe default for every host row, block or flex. Auto margins centre
        // the ruler in a wide row and resolve to ZERO when the ruler outgrows it, pinning
        // it to the start edge — the same degradation as the page stack's
        // `margin-inline: auto` (see `.docx-editor-one-surface__pages`). A row that
        // centres with `justify-content: center` instead overflows an oversized ruler on
        // BOTH sides, clipping its left inches while the page stays pinned left; and a
        // flex row lets the box collapse without `flexShrink: 0`, since every child is
        // absolutely positioned. Both sit BEFORE the spread so a host can override.
        flexShrink: 0,
        marginInline: 'auto',
        ...style,
      }}
      // A GROUP, not a slider: it contains sliders. It carried `aria-valuemin`/`max` with
      // no `aria-valuenow`, which describes nothing.
      role="group"
      aria-label={t('ruler.horizontal')}
    >
      {/* Grey margin zones — drag anywhere in the grey to move the margin. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: formatPx(leftMarginPx),
          height: STRIP_HEIGHT,
          backgroundColor: MARGIN_ZONE_COLOR,
          borderRight: '1px solid var(--doc-shadow-subtle)',
          cursor: editable ? 'ew-resize' : 'default',
          zIndex: 1,
        }}
        onPointerDown={
          editable && onLeftMarginChange
            ? (event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging('leftMargin');
              }
            : undefined
        }
        onPointerMove={(event) =>
          dragging === 'leftMargin' && handleMove('leftMargin', event.clientX, event.altKey)
        }
        onPointerUp={(event) => {
          if (dragging !== 'leftMargin') return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          endDrag('leftMargin');
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: formatPx(rightMarginPx),
          height: STRIP_HEIGHT,
          backgroundColor: MARGIN_ZONE_COLOR,
          borderLeft: '1px solid var(--doc-shadow-subtle)',
          cursor: editable ? 'ew-resize' : 'default',
          zIndex: 1,
        }}
        onPointerDown={
          editable && onRightMarginChange
            ? (event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging('rightMargin');
              }
            : undefined
        }
        onPointerMove={(event) =>
          dragging === 'rightMargin' && handleMove('rightMargin', event.clientX, event.altKey)
        }
        onPointerUp={(event) => {
          if (dragging !== 'rightMargin') return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          endDrag('rightMargin');
        }}
      />

      {/* Tick marks, anchored to the bottom of the strip. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: STRIP_HEIGHT,
          pointerEvents: 'none',
        }}
      >
        {ticks.map((tick, i) => (
          <RulerTick key={i} tick={tick} />
        ))}
      </div>

      {/* Tab stop markers (display only) */}
      {tabMarks?.map((tab) => (
        <TabMarker
          key={tab.position}
          tabMark={tab}
          positionPx={twipsToPixels(rulerTabPosition(tab.position, page, current)) * zoom}
          onDoubleClick={() => onTabMarkRemove?.(tab.position)}
        />
      ))}

      {/* === WORD'S FOUR INDENT HANDLES === */}
      {showIndentHandles && (
        <>
          <IndentTriangle
            direction="down"
            anchor="top"
            {...handleProps('firstLine', 'ruler.firstLineIndent', current.firstLine)}
          />
          <IndentTriangle
            direction="up"
            anchor="strip"
            {...handleProps('hanging', 'ruler.hangingIndent', current.left)}
          />
          <IndentBox {...handleProps('left', 'ruler.leftIndent', current.left)} />
          <IndentTriangle
            direction="up"
            anchor="strip"
            {...handleProps('right', 'ruler.rightIndent', current.right)}
          />
        </>
      )}

      {/* Drag tooltip */}
      {dragging && dragValue !== null && dragPositionPx !== null && (
        <DragTooltip value={formatValueForTooltip(dragValue, unit)} positionPx={dragPositionPx} />
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface TickData {
  position: number;
  height: number;
  label?: string;
}

function RulerTick({ tick }: { tick: TickData }): React.ReactElement {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: formatPx(tick.position),
          bottom: 0,
          width: 1,
          height: tick.height,
          backgroundColor: RULER_TICK_COLOR,
        }}
      />
      {tick.label && (
        <div
          style={{
            position: 'absolute',
            left: formatPx(tick.position),
            top: 2,
            transform: 'translateX(-50%)',
            fontSize: '9px',
            color: RULER_TEXT_COLOR,
            fontFamily: 'sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {tick.label}
        </div>
      )}
    </>
  );
}

/** Everything the four handles share: placement, interaction and accessible value. */
interface HandleProps {
  positionPx: number;
  editable: boolean;
  isDragging: boolean;
  isHovered: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  label: string;
  valueNow: number;
  valueText: string;
  pageWidthTwips: number;
}

function handleColor(props: HandleProps): string {
  if (!props.editable) return INDENT_DISABLED_COLOR;
  return props.isDragging || props.isHovered ? INDENT_HOVER_COLOR : INDENT_COLOR;
}

/** The shared wrapper: hit target, focus, and the slider semantics. */
function handleShell(
  props: HandleProps,
  width: number,
  vertical: CSSProperties
): CSSProperties & Record<string, unknown> {
  return {
    position: 'absolute',
    left: formatPx(props.positionPx - width / 2),
    width,
    cursor: props.editable ? 'ew-resize' : 'default',
    zIndex: props.isDragging ? 10 : 4,
    touchAction: 'none',
    ...vertical,
  };
}

function sliderAria(props: HandleProps) {
  return {
    role: 'slider' as const,
    'aria-label': props.label,
    'aria-orientation': 'horizontal' as const,
    // A slider with no value describes nothing; these were missing entirely.
    'aria-valuenow': props.valueNow,
    'aria-valuemin': -props.pageWidthTwips,
    'aria-valuemax': props.pageWidthTwips,
    'aria-valuetext': props.valueText,
    'aria-disabled': props.editable ? undefined : true,
    tabIndex: props.editable ? 0 : -1,
  };
}

interface IndentTriangleProps extends HandleProps {
  direction: 'up' | 'down';
  /** `top` rides the top of the strip; `strip` sits on its bottom edge. */
  anchor: 'top' | 'strip';
}

function IndentTriangle({ direction, anchor, ...props }: IndentTriangleProps): React.ReactElement {
  const color = handleColor(props);
  const vertical: CSSProperties =
    anchor === 'top'
      ? { top: 0, height: TRI_HEIGHT + 1 }
      : { top: STRIP_HEIGHT - TRI_HEIGHT, height: TRI_HEIGHT };

  return (
    <div
      className="docx-ruler-indent"
      style={handleShell(props, TRI_SIZE * 2, vertical)}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onKeyDown={props.onKeyDown}
      {...sliderAria(props)}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: 0,
          height: 0,
          borderLeft: `${TRI_SIZE}px solid transparent`,
          borderRight: `${TRI_SIZE}px solid transparent`,
          ...(direction === 'down'
            ? { top: 0, borderTop: `${TRI_HEIGHT}px solid ${color}` }
            : { bottom: 0, borderBottom: `${TRI_HEIGHT}px solid ${color}` }),
          transition: 'border-color 0.1s',
        }}
      />
    </div>
  );
}

/**
 * The left-indent box — Word's rectangle below the hanging triangle.
 *
 * Below rather than beside, which is what lets it share an x with the hanging triangle
 * without the two fighting over the same hit target.
 */
function IndentBox(props: HandleProps): React.ReactElement {
  return (
    <div
      className="docx-ruler-indent docx-ruler-indent--box"
      style={handleShell(props, TRI_SIZE * 2, { top: STRIP_HEIGHT + 1, height: BOX_HEIGHT })}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onKeyDown={props.onKeyDown}
      {...sliderAria(props)}
    >
      <div
        style={{
          position: 'absolute',
          left: 1,
          top: 0,
          width: TRI_SIZE * 2 - 2,
          height: BOX_HEIGHT,
          backgroundColor: handleColor(props),
          borderRadius: 1,
          transition: 'background-color 0.1s',
        }}
      />
    </div>
  );
}

function DragTooltip({
  value,
  positionPx,
}: {
  value: string;
  positionPx: number;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: formatPx(positionPx),
        top: -22,
        transform: 'translateX(-50%)',
        backgroundColor: 'var(--doc-text)',
        color: 'var(--doc-on-primary)',
        fontSize: '10px',
        fontFamily: 'sans-serif',
        padding: '2px 6px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {value}
    </div>
  );
}

interface TabMarkerProps {
  tabMark: RulerTabStop;
  positionPx: number;
  onDoubleClick: () => void;
}

const TAB_SYMBOLS: Record<string, string> = {
  left: 'L',
  center: 'C',
  right: 'R',
  decimal: 'D',
  bar: '|',
};

function TabMarker({ tabMark, positionPx, onDoubleClick }: TabMarkerProps): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: formatPx(positionPx - 5),
        top: STRIP_HEIGHT - 12,
        width: 10,
        height: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 8,
        fontWeight: 700,
        color: 'var(--doc-text-muted)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      title={`${tabMark.alignment} tab at ${(tabMark.position / 1440).toFixed(2)}"`}
    >
      {TAB_SYMBOLS[tabMark.alignment] || 'L'}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function positionToMargin(
  positionPx: number,
  side: 'left' | 'right',
  pageWidthPx: number,
  zoom: number
): number {
  const positionTwips = pixelsToTwips(positionPx / zoom);
  if (side === 'left') return Math.max(0, positionTwips);
  return Math.max(0, pixelsToTwips(pageWidthPx / zoom) - positionTwips);
}

export function getRulerDimensions(
  pageSetup?: RulerPageSetup | null,
  zoom: number = 1
): { width: number; leftMargin: number; rightMargin: number; contentWidth: number } {
  const pw = pageSetup?.pageWidthTwips ?? DEFAULT_PAGE_WIDTH_TWIPS;
  const lm = pageSetup?.marginsTwips.left ?? DEFAULT_MARGIN_TWIPS;
  const rm = pageSetup?.marginsTwips.right ?? DEFAULT_MARGIN_TWIPS;
  const width = twipsToPixels(pw) * zoom;
  const leftMargin = twipsToPixels(lm) * zoom;
  const rightMargin = twipsToPixels(rm) * zoom;
  return { width, leftMargin, rightMargin, contentWidth: width - leftMargin - rightMargin };
}

export function getMarginInUnits(marginTwips: number, unit: 'inch' | 'cm'): string {
  return unit === 'inch'
    ? (marginTwips / TWIPS_PER_INCH).toFixed(2) + '"'
    : (marginTwips / TWIPS_PER_CM).toFixed(1) + ' cm';
}

export function parseMarginFromUnits(value: string, unit: 'inch' | 'cm'): number | null {
  const num = parseFloat(value.replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  return Math.round(num * (unit === 'inch' ? TWIPS_PER_INCH : TWIPS_PER_CM));
}

export default HorizontalRuler;
