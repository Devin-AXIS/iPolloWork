// The zoom lifecycle, as one hook.
//
// Everything here is a thin read of engine state plus a call back into it — there is no zoom
// state in React. That is deliberate: the engine owns the scale because the painted pages,
// the ruler and hit testing all divide by it, and a second copy in a component would be a
// fourth opinion that drifts the first time a fit refits without asking.
//
// Both halves of the state are exposed because neither implies the other. `zoom` is the
// resolved number a ruler multiplies by; `mode` is what a control has to show as selected. A
// menu that ticked the entry matching the percentage would tick "75%" while the editor was
// tracking the viewport and about to move off it.

import { useCallback, useMemo } from 'react';
import type { EditorSnapshot, ZoomMode } from '@docx-editor.dev/core/contracts/editor';
import { FIT_WIDTH_ZOOM_MODE } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { ZOOM_LEVELS, stepZoomLevel } from './zoom-levels';

interface ZoomSlice {
  readonly zoom: number;
  readonly mode: ZoomMode | undefined;
}

const selectZoom = (snapshot: EditorSnapshot): ZoomSlice => ({
  zoom: snapshot.zoom,
  mode: snapshot.zoomMode,
});

// The slice is a fresh object each tick, so `Object.is` would re-render on every keystroke.
// The engine keeps `zoomMode` reference-stable, which makes both members cheap to compare.
const sameZoom = (a: ZoomSlice, b: ZoomSlice) => a.zoom === b.zoom && a.mode === b.mode;

/** What {@link useZoom} answers. @public */
export interface UseZoomResult {
  /** The scale in force, resolved. 1 is 100%. */
  readonly zoom: number;
  /** Where {@link UseZoomResult.zoom} came from. Fixed until an implementation says otherwise. */
  readonly mode: ZoomMode;
  /** Whether the editor is tracking the viewport rather than holding a number. */
  readonly isFit: boolean;
  /** Set a fixed scale. Leaves any fit mode, the same as picking a level in the toolbar. */
  readonly setZoom: (zoom: number) => void;
  readonly setMode: (mode: ZoomMode | 'auto') => void;
  /** Fit the page width and keep fitting: shrink AND grow with the viewport. */
  readonly fitToWidth: () => void;
  /** The default: fit the page width, never past 100%. */
  readonly auto: () => void;
  /** Back to a plain, untracked 100%. */
  readonly reset: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  /** The ladder the steppers walk, so a custom control shows the same levels. */
  readonly levels: readonly number[];
}

const FIXED: ZoomMode = { type: 'fixed' };

/**
 * Read and drive the document's zoom.
 *
 * ```tsx
 * const { zoom, isFit, auto, zoomIn } = useZoom();
 * <button onClick={auto} aria-pressed={isFit}>Fit</button>
 * <span>{Math.round(zoom * 100)}%</span>
 * ```
 *
 * Outside a `DocxEditor.Root` — and before the editor is created — this reports 100% fixed
 * and every action is a no-op, so a control can render unconditionally.
 *
 * @public
 */
export function useZoom(): UseZoomResult {
  const editor = useDocxEditor();
  const { zoom, mode } = useEditorState(selectZoom, sameZoom);

  const setZoom = useCallback((next: number) => void editor?.setZoom(next), [editor]);
  const setMode = useCallback(
    (next: ZoomMode | 'auto') => void editor?.setZoomMode(next),
    [editor]
  );

  return useMemo(() => {
    const resolved = mode ?? FIXED;
    // Not `stepZoomLevel(zoom)` alone: in a fit mode the resolved scale is an arbitrary
    // percentage between two rungs, and stepping from 0.79 must land on the next rung up
    // rather than refusing because 0.79 is not on the ladder. It already does — `find` takes
    // the first level strictly greater — but the disabled state has to agree, which is why
    // both come from the same call.
    const previous = stepZoomLevel(zoom, 'out');
    const next = stepZoomLevel(zoom, 'in');
    return {
      zoom,
      mode: resolved,
      isFit: resolved.type === 'fit',
      setZoom,
      setMode,
      fitToWidth: () => setMode(FIT_WIDTH_ZOOM_MODE),
      auto: () => setMode('auto'),
      reset: () => {
        // Either order lands on fixed 100% — `setZoom` leaves a fit on its own, even when the
        // fit had already resolved to 1. Mode first anyway, so the one publish a caller sees
        // carries both halves of the change rather than a scale beside a mode about to move.
        setMode(FIXED);
        setZoom(1);
      },
      zoomIn: () => next !== null && setZoom(next),
      zoomOut: () => previous !== null && setZoom(previous),
      canZoomIn: !!editor && next !== null,
      canZoomOut: !!editor && previous !== null,
      levels: ZOOM_LEVELS,
    };
  }, [editor, zoom, mode, setZoom, setMode]);
}
