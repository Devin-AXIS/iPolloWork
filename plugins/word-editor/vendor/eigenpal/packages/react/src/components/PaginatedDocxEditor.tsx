// A React host for the engine-owned paginated surface (task 11.1).
//
// THIN, deliberately. The host owns three things and nothing else: a container element, the
// surface's lifetime, and the translation of engine state into React state. Every editing
// decision — what a key does, where the caret goes, what a selection means — belongs to the
// engine, so that React and Vue cannot drift into two behaviours.
//
// The measurer is injected rather than chosen here: which font bytes a document is measured
// and painted with is a packaging decision, and baking one in would make the adapter the
// place fidelity is decided.
//
// The engine is reached through its COMPOSITION ROOT only. An adapter that imported the
// layout lane for a parameter type would be reaching past the boundary for a name, which is
// how a boundary starts leaking. The import path becomes `@docx-editor.dev/core/editor` when
// task 10.5 migrates the namespace.

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceState,
  type NavigationCommand,
  type SectionProperties,
  type SurfaceFormatting,
  type TextMeasurer,
} from '@docx-editor.dev/core/editor';

export interface PaginatedDocxEditorProps {
  /** The document to open. Replacing it remounts the surface. */
  readonly source: Uint8Array;
  /** Points to CSS pixels. */
  readonly scale?: number;
  /** Host-supplied font metrics; layout stays DOM-free without it. */
  readonly measurer?: TextMeasurer;
  /** Called on every committed revision and every selection change. */
  readonly onStateChange?: (state: PaginatedSurfaceState) => void;
  /** Called once if the document cannot be opened, with the engine's typed reason. */
  readonly onError?: (reason: string, detail?: string) => void;
  readonly className?: string;
  /**
   * The face runs naming no font are painted in.
   *
   * Applied to the DOCUMENT container only. Setting it on an ancestor leaks the document's
   * face into the surrounding chrome — a measured text face is chosen to match what the
   * shaper measured, and it renders the toolbar and the brand lockup heavier than the UI
   * font they were designed in.
   */
  readonly documentFontFamily?: string;
  readonly ref?: Ref<PaginatedDocxEditorHandle>;
}

/**
 * What a host can drive from outside.
 *
 * Commands only. There is no accessor for the document or the layout, because a caller
 * holding either could act on a revision the model has already left behind.
 */
export interface PaginatedDocxEditorHandle {
  focus(): void;
  type(text: string): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  navigate(command: NavigationCommand, extend?: boolean): void;
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  setRunProperty(localName: string, attributes?: Record<string, string>): void;
  /**
   * `options.mergeAttributes` keeps the attributes the call does not name, for the
   * properties carrying several independent settings in one element — `w:spacing` holds the
   * line rule AND the space before and after, so a line-spacing pick without it deleted the
   * paragraph's spacing. `physicalAlignment` and `paragraphDirection` spell `w:jc` and
   * `w:bidi` per paragraph direction.
   */
  setParagraphProperty(
    localName: string,
    attributes?: Record<string, string | null>,
    options?: {
      readonly mergeAttributes?: boolean;
      readonly physicalAlignment?: boolean;
      readonly paragraphDirection?: 'ltr' | 'rtl';
    }
  ): void;
  /** Formatting at the selection, for a toolbar to reflect. */
  formatting(): SurfaceFormatting | null;
  /** The section the document declares — what a ruler is made of. */
  sectionProperties(): SectionProperties | null;
  /** Save pending form input. Throws for invalid values or an active edit. */
  save(): Uint8Array | null;
}

/** Vue name for the same handle contract. @public */
export type PaginatedDocxEditorExpose = PaginatedDocxEditorHandle;

export function PaginatedDocxEditor({
  source,
  scale,
  measurer,
  onStateChange,
  onError,
  className,
  documentFontFamily,
  ref,
}: PaginatedDocxEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<PaginatedSurface | null>(null);
  const [state, setState] = useState<PaginatedSurfaceState | null>(null);

  // Held in refs so the effect does not re-run — and therefore does not tear the surface
  // down and lose the caret — every time a parent re-renders with a new callback identity.
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const result = mountPaginatedSurface(container, source, {
      ...(scale === undefined ? {} : { scale }),
      ...(measurer ? { measurer } : {}),
      onChange: (next) => {
        setState(next);
        onStateChangeRef.current?.(next);
      },
    });

    if (!result.ok) {
      // A rejection is a property of the FILE, so it is reported rather than thrown: a
      // corrupt upload should not take the surrounding application down.
      onErrorRef.current?.(result.reason, result.detail);
      return;
    }

    surfaceRef.current = result.surface;
    const initial = result.surface.state();
    setState(initial);
    // The INITIAL state is reported too. A host that only hears about changes cannot draw
    // anything derived from the document until the user edits it — the ruler stayed missing
    // until the first keystroke.
    onStateChangeRef.current?.(initial);
    return () => {
      result.surface.destroy();
      surfaceRef.current = null;
    };
    // `scale` is deliberately NOT a dependency: it is a paint parameter, and remounting on it
    // reopened the document from the original bytes — changing zoom threw away every edit,
    // the caret and the undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, measurer]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => surfaceRef.current?.focus(),
      type: (text: string) => surfaceRef.current?.type(text),
      undo: () => surfaceRef.current?.undo(),
      redo: () => surfaceRef.current?.redo(),
      selectAll: () => surfaceRef.current?.selectAll(),
      navigate: (command: NavigationCommand, extend?: boolean) =>
        surfaceRef.current?.navigate(command, extend),
      toggleRunProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.current?.toggleRunProperty(localName, attributes),
      setRunProperty: (localName: string, attributes?: Record<string, string>) =>
        surfaceRef.current?.setRunProperty(localName, attributes),
      setParagraphProperty: (
        localName: string,
        attributes?: Record<string, string | null>,
        options?: Parameters<PaginatedDocxEditorHandle['setParagraphProperty']>[2]
      ) => surfaceRef.current?.setParagraphProperty(localName, attributes, options),
      formatting: () => surfaceRef.current?.formatting() ?? null,
      sectionProperties: () => surfaceRef.current?.sectionProperties() ?? null,
      save: () => surfaceRef.current?.save() ?? null,
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      // Centred by margin rather than by a flex parent: the pages are absolutely positioned,
      // so the container's own width is what has to be centred.
      style={{
        margin: '24px auto',
        ...(documentFontFamily ? { fontFamily: documentFontFamily } : {}),
      }}
      // MERGED, not replaced. Every rule that gives the sheet its paper colour is scoped to
      // `docx-paginated-surface`, while the content inversion keys off a class the painter
      // always emits — so a host passing a className used to leave inverted near-white text
      // floating on the workspace with no visible page.
      className={className ? `docx-paginated-surface ${className}` : 'docx-paginated-surface'}
      data-revision={state?.revision ?? 0}
      data-page-count={state?.pageCount ?? 0}
    />
  );
}
