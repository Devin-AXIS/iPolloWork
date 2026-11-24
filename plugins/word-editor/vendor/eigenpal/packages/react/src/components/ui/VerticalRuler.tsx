/**
 * VerticalRuler Component
 *
 * A vertical ruler that displays alongside the document with:
 * - Page height scale with tick marks
 * - Top and bottom margin indicators
 * - Optional dragging to adjust margins
 * - Support for zoom levels
 *
 * Similar to Google Docs' vertical ruler.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { RulerPageSetup } from './HorizontalRuler';
import { twipsToPixels, pixelsToTwips, formatPx } from '../../lib/units';
import { useChromeDir, useTranslation } from '../../i18n';
import { hostDocumentOf } from '@docx-editor.dev/core/editor';

// ============================================================================
// TYPES
// ============================================================================

export interface VerticalRulerProps {
  /** Section page setup (`Editor.getPageSetup()`), twips throughout */
  pageSetup?: RulerPageSetup | null;
  /** Zoom level (1.0 = 100%) */
  zoom?: number;
  /** Whether margins can be dragged to adjust */
  editable?: boolean;
  /** Callback when top margin changes (in twips) */
  onTopMarginChange?: (marginTwips: number) => void;
  /** Callback when bottom margin changes (in twips) */
  onBottomMarginChange?: (marginTwips: number) => void;
  /** Fires when a margin drag is released — the moment to commit what the drag previewed. */
  onMarginDragEnd?: () => void;
  /** Unit to display (inches or cm) */
  unit?: 'inch' | 'cm';
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

type MarkerType = 'topMargin' | 'bottomMargin';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_HEIGHT_TWIPS = 15840; // 11 inches
const DEFAULT_MARGIN_TWIPS = 1440; // 1 inch
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;

// Ruler styling - Google Docs style
// Exported so the outline toggle/panel can inset past the vertical ruler
// (it overlays the editor's inline-start edge) instead of rendering on top of it.
export const RULER_WIDTH = 20;
const RULER_TEXT_COLOR = 'var(--doc-text-muted)';
const RULER_TICK_COLOR = 'var(--doc-text-subtle)';
const MARKER_COLOR = 'var(--doc-primary)';
const MARKER_HOVER_COLOR = 'var(--doc-primary)';
const MARKER_ACTIVE_COLOR = 'var(--doc-primary-hover)';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function VerticalRuler({
  pageSetup,
  zoom = 1,
  editable = false,
  onTopMarginChange,
  onBottomMarginChange,
  onMarginDragEnd,
  unit = 'inch',
  className = '',
  style,
}: VerticalRulerProps): React.ReactElement {
  const { t } = useTranslation();
  // Ticks and margin markers face the page from the inline end of the chrome direction.
  const dir = useChromeDir();
  const [dragging, setDragging] = useState<MarkerType | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<MarkerType | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // Get page dimensions
  const pageHeightTwips = pageSetup?.pageHeightTwips ?? DEFAULT_PAGE_HEIGHT_TWIPS;
  const topMarginTwips = pageSetup?.marginsTwips.top ?? DEFAULT_MARGIN_TWIPS;
  const bottomMarginTwips = pageSetup?.marginsTwips.bottom ?? DEFAULT_MARGIN_TWIPS;

  const handleKeyDown = (event: React.KeyboardEvent, marker: MarkerType) => {
    if (!editable || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = marker === 'topMargin' ? topMarginTwips : bottomMarginTwips;
    const other = marker === 'topMargin' ? bottomMarginTwips : topMarginTwips;
    const maximum = Math.max(0, pageHeightTwips - other - 720);
    const step = event.shiftKey
      ? 1
      : Math.round(unit === 'cm' ? TWIPS_PER_CM / 10 : TWIPS_PER_INCH / 8);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? maximum
          : Math.max(0, Math.min(maximum, current + (event.key === 'ArrowUp' ? step : -step)));
    if (next === current) return;
    (marker === 'topMargin' ? onTopMarginChange : onBottomMarginChange)?.(next);
    onMarginDragEnd?.();
  };

  // Convert to pixels with zoom
  const pageHeightPx = twipsToPixels(pageHeightTwips) * zoom;
  const topMarginPx = twipsToPixels(topMarginTwips) * zoom;
  const bottomMarginPx = twipsToPixels(bottomMarginTwips) * zoom;

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.MouseEvent, marker: MarkerType) => {
      if (!editable) return;
      e.preventDefault();
      setDragging(marker);
    },
    [editable]
  );

  // Handle drag
  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!dragging || !rulerRef.current) return;

      const rect = rulerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;

      const positionTwips = pixelsToTwips(y / zoom);

      if (dragging === 'topMargin') {
        const maxMargin = pageHeightTwips - bottomMarginTwips - 720;
        const newMargin = Math.max(0, Math.min(positionTwips, maxMargin));
        onTopMarginChange?.(Math.round(newMargin));
      } else if (dragging === 'bottomMargin') {
        const fromBottom = pageHeightTwips - positionTwips;
        const maxMargin = pageHeightTwips - topMarginTwips - 720;
        const newMargin = Math.max(0, Math.min(fromBottom, maxMargin));
        onBottomMarginChange?.(Math.round(newMargin));
      }
    },
    [
      dragging,
      zoom,
      pageHeightTwips,
      topMarginTwips,
      bottomMarginTwips,
      onTopMarginChange,
      onBottomMarginChange,
    ]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    if (dragging !== null) onMarginDragEnd?.();
    setDragging(null);
  }, [dragging, onMarginDragEnd]);

  // Add/remove document event listeners
  useEffect(() => {
    if (dragging) {
      const doc = hostDocumentOf(rulerRef.current);
      doc.addEventListener('mousemove', handleDrag);
      doc.addEventListener('mouseup', handleDragEnd);
      return () => {
        doc.removeEventListener('mousemove', handleDrag);
        doc.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [dragging, handleDrag, handleDragEnd]);

  // Generate tick marks
  const ticks = generateVerticalTicks(pageHeightTwips, zoom, unit);

  const rulerStyle: CSSProperties = {
    position: 'relative',
    width: RULER_WIDTH,
    height: formatPx(pageHeightPx),
    backgroundColor: 'transparent',
    overflow: 'visible',
    userSelect: 'none',
    cursor: dragging ? 'ns-resize' : 'default',
    ...style,
  };

  return (
    <div
      ref={rulerRef}
      className={`docx-vertical-ruler ${className}`}
      style={rulerStyle}
      dir={dir}
      role="group"
      aria-label={t('ruler.vertical')}
    >
      {/* Tick marks */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          pointerEvents: 'none',
        }}
      >
        {ticks.map((tick, index) => (
          <VerticalTick key={index} tick={tick} />
        ))}
      </div>

      {/* Top margin marker */}
      <VerticalMarginMarker
        type="topMargin"
        value={topMarginTwips}
        maximum={Math.max(0, pageHeightTwips - bottomMarginTwips - 720)}
        valueText={topMarginTwips / (unit === 'cm' ? TWIPS_PER_CM : TWIPS_PER_INCH)}
        unit={unit}
        onKeyDown={(event) => handleKeyDown(event, 'topMargin')}
        position={topMarginPx}
        editable={editable}
        isDragging={dragging === 'topMargin'}
        isHovered={hoveredMarker === 'topMargin'}
        onMouseEnter={() => setHoveredMarker('topMargin')}
        onMouseLeave={() => setHoveredMarker(null)}
        onMouseDown={(e) => handleDragStart(e, 'topMargin')}
      />

      {/* Bottom margin marker */}
      <VerticalMarginMarker
        type="bottomMargin"
        value={bottomMarginTwips}
        maximum={Math.max(0, pageHeightTwips - topMarginTwips - 720)}
        valueText={bottomMarginTwips / (unit === 'cm' ? TWIPS_PER_CM : TWIPS_PER_INCH)}
        unit={unit}
        onKeyDown={(event) => handleKeyDown(event, 'bottomMargin')}
        position={pageHeightPx - bottomMarginPx}
        editable={editable}
        isDragging={dragging === 'bottomMargin'}
        isHovered={hoveredMarker === 'bottomMargin'}
        onMouseEnter={() => setHoveredMarker('bottomMargin')}
        onMouseLeave={() => setHoveredMarker(null)}
        onMouseDown={(e) => handleDragStart(e, 'bottomMargin')}
      />
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface VerticalTickData {
  position: number;
  width: number;
  label?: string;
}

function VerticalTick({ tick }: { tick: VerticalTickData }): React.ReactElement {
  const tickStyle: CSSProperties = {
    position: 'absolute',
    top: formatPx(tick.position),
    insetInlineEnd: 0,
    height: 1,
    width: tick.width,
    backgroundColor: RULER_TICK_COLOR,
  };

  const labelStyle: CSSProperties = {
    position: 'absolute',
    top: formatPx(tick.position),
    insetInlineStart: 2,
    transform: 'translateY(-50%)',
    fontSize: '9px',
    color: RULER_TEXT_COLOR,
    fontFamily: 'sans-serif',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div style={tickStyle} />
      {tick.label && <div style={labelStyle}>{tick.label}</div>}
    </>
  );
}

interface VerticalMarginMarkerProps {
  type: 'topMargin' | 'bottomMargin';
  position: number;
  value: number;
  maximum: number;
  valueText: number;
  unit: 'inch' | 'cm';
  onKeyDown: (event: React.KeyboardEvent) => void;
  editable: boolean;
  isDragging: boolean;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

function VerticalMarginMarker({
  type,
  position,
  value,
  maximum,
  valueText,
  unit,
  onKeyDown,
  editable,
  isDragging,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
}: VerticalMarginMarkerProps): React.ReactElement {
  const { t } = useTranslation();
  const color = isDragging ? MARKER_ACTIVE_COLOR : isHovered ? MARKER_HOVER_COLOR : MARKER_COLOR;

  const markerStyle: CSSProperties = {
    position: 'absolute',
    top: formatPx(position - 5),
    insetInlineEnd: 0,
    width: RULER_WIDTH,
    height: 10,
    cursor: editable ? 'ns-resize' : 'default',
    zIndex: isDragging ? 10 : 1,
  };

  // Triangle pointing toward the page edge it sits beside
  const triangleStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    insetInlineEnd: 2,
    width: 0,
    height: 0,
    borderTop: '5px solid transparent',
    borderBottom: '5px solid transparent',
    borderInlineEnd: `8px solid ${color}`,
    transition: 'border-inline-end-color 0.1s',
  };

  return (
    <div
      className={`docx-ruler-marker docx-ruler-marker-${type}`}
      style={markerStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      role="slider"
      aria-label={type === 'topMargin' ? t('ruler.topMargin') : t('ruler.bottomMargin')}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={maximum}
      aria-valuetext={`${valueText.toFixed(2)} ${unit === 'cm' ? 'cm' : 'in'}`}
      aria-disabled={!editable}
      onKeyDown={onKeyDown}
      tabIndex={editable ? 0 : -1}
    >
      <div style={triangleStyle} />
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateVerticalTicks(
  pageHeightTwips: number,
  zoom: number,
  unit: 'inch' | 'cm'
): VerticalTickData[] {
  const ticks: VerticalTickData[] = [];

  if (unit === 'inch') {
    const eighthInchTwips = TWIPS_PER_INCH / 8;
    const totalEighths = Math.ceil(pageHeightTwips / eighthInchTwips);

    for (let i = 0; i <= totalEighths; i++) {
      const twipsPos = i * eighthInchTwips;
      if (twipsPos > pageHeightTwips) break;

      const pxPos = twipsToPixels(twipsPos) * zoom;

      if (i % 8 === 0) {
        const inches = i / 8;
        ticks.push({
          position: pxPos,
          width: 10,
          label: inches > 0 ? String(inches) : undefined,
        });
      } else if (i % 4 === 0) {
        ticks.push({ position: pxPos, width: 6 });
      } else if (i % 2 === 0) {
        ticks.push({ position: pxPos, width: 4 });
      } else {
        ticks.push({ position: pxPos, width: 2 });
      }
    }
  } else {
    const mmTwips = TWIPS_PER_CM / 10;
    const totalMm = Math.ceil(pageHeightTwips / mmTwips);

    for (let i = 0; i <= totalMm; i++) {
      const twipsPos = i * mmTwips;
      if (twipsPos > pageHeightTwips) break;

      const pxPos = twipsToPixels(twipsPos) * zoom;

      if (i % 10 === 0) {
        const cm = i / 10;
        ticks.push({
          position: pxPos,
          width: 10,
          label: cm > 0 ? String(cm) : undefined,
        });
      } else if (i % 5 === 0) {
        ticks.push({ position: pxPos, width: 6 });
      } else {
        ticks.push({ position: pxPos, width: 3 });
      }
    }
  }

  return ticks;
}

export default VerticalRuler;
