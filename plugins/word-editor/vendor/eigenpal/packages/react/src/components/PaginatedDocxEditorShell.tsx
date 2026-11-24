import type { DocxEditorChildren } from '../docx-editor-children';
// The paginated surface wired to the real editor chrome (task 11.1).
//
// The surface on its own is a document with no way to act on it but the keyboard. This
// composes the existing toolbar with it, which is the whole point of keeping that toolbar
// driven by plain state and one callback: it does not know or care which engine answers.
//
// The mapping is the interesting part, and it is deliberately DIRECT — a toolbar action
// becomes one OOXML property on the selection, named as the file names it. Anything the
// engine cannot yet express is refused rather than approximated, because a toolbar button
// that silently does nothing is worse than one that is visibly unavailable.

import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type {
  PaginatedSurfaceState,
  SectionProperties,
  TextMeasurer,
} from '@docx-editor.dev/core/editor';
import type { FormattingAction, SelectionFormatting } from './Toolbar';
import { EditorToolbar } from './EditorToolbar';
import { HorizontalRuler, type RulerPageSetup } from './ui/HorizontalRuler';
import { resolveColorToHex } from '../lib/colorResolver';
import { PaginatedDocxEditor, type PaginatedDocxEditorHandle } from './PaginatedDocxEditor';

export interface PaginatedDocxEditorShellProps {
  readonly source: Uint8Array;
  /** Shown in the title bar. */
  readonly documentName?: string;
  readonly scale?: number;
  readonly measurer?: TextMeasurer;
  readonly onStateChange?: (state: PaginatedSurfaceState) => void;
  readonly onError?: (reason: string, detail?: string) => void;
  /** Called with the serialized document when File ▸ Save is used. */
  readonly onSave?: (bytes: Uint8Array) => void;
  /**
   * Title-bar slots, owned by the HOST.
   *
   * Brand lockup, adapter and example switchers on the left; document actions on the right.
   * They belong to whoever embeds the editor — a demo's switchers are not editor chrome, and
   * baking them in would ship them to every consumer.
   */
  readonly renderTitleBarLeft?: () => DocxEditorChildren;
  readonly renderTitleBarRight?: () => DocxEditorChildren;
  /** Commands, forwarded from the editor the shell hosts. */
  readonly ref?: Ref<PaginatedDocxEditorHandle>;
  /** Applies the editor's own dark palette; the document canvas stays Word-faithful. */
  readonly colorMode?: 'light' | 'dark';
  /** Reported when the zoom control changes, so the host can re-scale the surface. */
  readonly onZoomChange?: (zoom: number) => void;
  /** The face the document is painted in; never applied to the chrome. */
  readonly documentFontFamily?: string;
  readonly className?: string;
}

/** Highlight names OOXML accepts, keyed by the hex a picker hands back. */
const HIGHLIGHT_BY_HEX: ReadonlyMap<string, string> = new Map([
  ['#ffff00', 'yellow'],
  ['#00ff00', 'green'],
  ['#00ffff', 'cyan'],
  ['#ff00ff', 'magenta'],
  ['#0000ff', 'blue'],
  ['#ff0000', 'red'],
  ['#000080', 'darkBlue'],
  ['#008080', 'darkCyan'],
  ['#008000', 'darkGreen'],
  ['#800080', 'darkMagenta'],
  ['#800000', 'darkRed'],
  ['#808000', 'darkYellow'],
  ['#808080', 'darkGray'],
  ['#c0c0c0', 'lightGray'],
  ['#ffffff', 'white'],
]);

const hexOf = (value: string): string | null => {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? match[1]!.toUpperCase() : null;
};

/** @deprecated Use `<DocxEditor>` from the composition layer instead. */
export function PaginatedDocxEditorShell({
  source,
  scale,
  measurer,
  documentName,
  onStateChange,
  onError,
  onSave,
  renderTitleBarLeft,
  renderTitleBarRight,
  ref,
  colorMode,
  onZoomChange,
  documentFontFamily,
  className,
}: PaginatedDocxEditorShellProps) {
  const editorRef = useRef<PaginatedDocxEditorHandle>(null);
  const [state, setState] = useState<PaginatedSurfaceState | null>(null);
  const [formatting, setFormatting] = useState<SelectionFormatting>({});
  const [section, setSection] = useState<SectionProperties | null>(null);

  const refresh = useCallback(
    (next: PaginatedSurfaceState) => {
      setState(next);
      // Read AFTER the commit, from the engine, rather than predicting what the action did.
      // A toolbar that tracks its own optimistic state drifts the moment an edit is refused.
      const current = editorRef.current?.formatting();
      if (current) {
        setFormatting({
          bold: current.bold,
          italic: current.italic,
          underline: current.underline,
          strike: current.strikethrough,
          superscript: current.superscript,
          subscript: current.subscript,
          ...(current.fontFamily ? { fontFamily: current.fontFamily } : {}),
          ...(current.fontSizeHalfPoints ? { fontSize: current.fontSizeHalfPoints } : {}),
          ...(current.alignment ? { alignment: current.alignment as never } : {}),
          ...(current.styleId ? { styleId: current.styleId } : {}),
          ...(current.color ? { color: `#${current.color}` } : {}),
          ...(current.highlight ? { highlight: current.highlight } : {}),
        });
      }
      // Section properties come from the TREE, so an edit can change them — a page-size
      // change has to move the ruler, not just the pagination.
      setSection(editorRef.current?.sectionProperties() ?? null);
      onStateChange?.(next);
    },
    [onStateChange]
  );

  const onFormat = useCallback((action: FormattingAction) => {
    const editor = editorRef.current;
    if (!editor) return;

    if (typeof action === 'string') {
      switch (action) {
        case 'bold':
          return editor.toggleRunProperty('b');
        case 'italic':
          return editor.toggleRunProperty('i');
        case 'underline':
          return editor.toggleRunProperty('u', { val: 'single' });
        case 'strikethrough':
          return editor.toggleRunProperty('strike');
        case 'superscript':
          return editor.setRunProperty('vertAlign', { val: 'superscript' });
        case 'subscript':
          return editor.setRunProperty('vertAlign', { val: 'subscript' });
        case 'clearFormatting':
          // Explicit OFF, not removal: the property may be inherited from a style, and
          // dropping the local override would let the inherited value come back.
          editor.setRunProperty('b', { val: '0' });
          editor.setRunProperty('i', { val: '0' });
          editor.setRunProperty('u', { val: 'none' });
          editor.setRunProperty('strike', { val: '0' });
          editor.setRunProperty('vertAlign', { val: 'baseline' });
          return;
        case 'setRtl':
        case 'setLtr':
          // The same write as the `direction.*` chrome slots and `setParagraphDirection`.
          return editor.setParagraphProperty('bidi', undefined, {
            paragraphDirection: action === 'setRtl' ? 'rtl' : 'ltr',
          });
        default:
          // Lists, indent and links are deferred lanes. Doing nothing visibly is honest;
          // approximating them would write OOXML the engine cannot round-trip.
          return;
      }
    }

    switch (action.type) {
      case 'fontFamily':
        return editor.setRunProperty('rFonts', { ascii: action.value, hAnsi: action.value });
      case 'fontSize':
        // The picker speaks POINTS; `w:sz` stores half-points. Passing it through wrote half
        // the requested size, and the picker then redisplayed that.
        return editor.setRunProperty('sz', { val: String(Math.round(action.value * 2)) });
      case 'textColor': {
        // The picker emits a contract ColorValue OBJECT for text, not a string.
        // Hex and theme values resolve to a concrete hex (theme slots against the
        // Office defaults — the engine does not expose the document theme yet);
        // `auto` has no hex and is refused rather than approximated.
        const value = action.value;
        const hex =
          typeof value === 'string' ? hexOf(value) : (resolveColorToHex(value, null) ?? null);
        return hex ? editor.setRunProperty('color', { val: hex }) : undefined;
      }
      case 'highlightColor': {
        // The picker emits a BARE uppercase hex ("FFFF00"), not "#ffff00", so every lookup
        // missed. `none` clears the highlight and is a legal ST_HighlightColor.
        const raw = action.value.trim().toLowerCase();
        if (raw === 'none' || raw === '')
          return editor.setRunProperty('highlight', { val: 'none' });
        const name = HIGHLIGHT_BY_HEX.get(raw.startsWith('#') ? raw : `#${raw}`);
        // `w:highlight` takes a NAME from a fixed list, not a hex. An unmapped colour is
        // refused rather than written as something Word would drop on open.
        return name ? editor.setRunProperty('highlight', { val: name }) : undefined;
      }
      case 'alignment':
        // A physical edge: a right-to-left paragraph reaches its right margin with `left`.
        return editor.setParagraphProperty(
          'jc',
          { val: String(action.value) },
          { physicalAlignment: true }
        );
      case 'lineSpacing':
        // The picker already speaks TWIPS (240 = single). Multiplying again turned "1.5
        // lines" into 360 lines.
        // Merged: `w:spacing` carries the line rule and the space before/after together, so
        // a replacing write deleted the paragraph's spacing on its way to changing the line
        // height. Same rule as the engine's own `setLineSpacing`.
        return editor.setParagraphProperty(
          'spacing',
          { line: String(Math.round(action.value)), lineRule: 'auto' },
          { mergeAttributes: true }
        );
      case 'applyStyle':
        return editor.setParagraphProperty('pStyle', { val: action.value });
      default:
        return;
    }
  }, []);

  // The chrome skeleton: a fixed toolbar above a scroll container holding the pages. The
  // full shell adds rulers, the outline panel and the sidebar, all of which need section
  // properties — page size and margins — that this surface does not publish yet.
  // Forwarded rather than re-implemented: the shell adds chrome, not commands.
  useImperativeHandle(ref, () => editorRef.current as PaginatedDocxEditorHandle, []);

  const zoom = scale === undefined ? 1 : scale / (96 / 72);
  // The engine's section carries more than the ruler reads — header, footer and
  // gutter offsets, columns — so it is narrowed to the contract's page-setup
  // shape rather than the ruler being widened to know about page furniture it
  // does not draw.
  const rulerPageSetup: RulerPageSetup | null = section
    ? {
        pageWidthTwips: section.pageSize.widthTwips,
        pageHeightTwips: section.pageSize.heightTwips,
        orientation: section.landscape ? 'landscape' : 'portrait',
        marginsTwips: {
          top: section.margins.topTwips,
          right: section.margins.rightTwips,
          bottom: section.margins.bottomTwips,
          left: section.margins.leftTwips,
        },
      }
    : null;

  return (
    <div
      // `docx-editor` is never dropped: the whole dark palette is scoped to `.docx-editor.dark`, so
      // a host className that replaced it left the element carrying `dark` while every token
      // silently resolved light.
      className={[
        'docx-editor docx-paginated-shell',
        colorMode === 'dark' ? 'dark' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      // The root PAINTS its background rather than leaving it transparent. The dark tokens
      // resolved correctly without this, but nothing drew them — so the page inverted while
      // the chrome around it stayed whatever the host body happened to be.
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--doc-bg)',
        color: 'var(--doc-text)',
      }}
      data-testid="paginated-shell"
    >
      {/* The SAME chrome the full editor composes — title bar, document name, menu bar and
          the formatting rail — rather than a lookalike built beside it. `EditorToolbar` is
          the provider those parts read their state and commands from, so the composition is
          the composition, not a copy of its appearance. */}
      <EditorToolbar
        currentFormatting={formatting}
        onFormat={onFormat}
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
        canUndo={state?.canUndo ?? false}
        canRedo={state?.canRedo ?? false}
        // Zoom re-scales the SURFACE, which means a fresh layout at the new scale rather
        // than a CSS transform over the old one: the pages are painted from records, so
        // scaling the painted output would blur the glyphs and put the caret off the text.
        zoom={zoom}
        onZoomChange={onZoomChange}
        // The File menu appears when there is something for it to do. Save is the one file
        // action this surface can honour today; print and page setup belong to lanes that
        // are not built, and offering them would be offering nothing.
        onSave={() => {
          const bytes = editorRef.current?.save();
          if (bytes) onSave?.(bytes);
        }}
      >
        <EditorToolbar.TitleBar>
          {renderTitleBarLeft && <EditorToolbar.Logo>{renderTitleBarLeft()}</EditorToolbar.Logo>}
          <EditorToolbar.DocumentName value={documentName ?? 'Document'} editable={false} />
          {renderTitleBarRight && (
            <EditorToolbar.TitleBarRight>{renderTitleBarRight()}</EditorToolbar.TitleBarRight>
          )}
          <EditorToolbar.MenuBar />
        </EditorToolbar.TitleBar>
        <EditorToolbar.Toolbar />
      </EditorToolbar>
      <div
        className="docx-editor__scroll-container"
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--doc-bg)' }}
      >
        {rulerPageSetup ? (
          // A block row, not flex justify-center: the ruler centres itself clamp-safely
          // (see HorizontalRuler's base style), so it degrades like the page on narrow hosts.
          <div style={{ padding: '4px 0' }}>
            <HorizontalRuler pageSetup={rulerPageSetup} zoom={zoom} />
          </div>
        ) : null}
        <PaginatedDocxEditor
          ref={editorRef}
          source={source}
          {...(documentFontFamily ? { documentFontFamily } : {})}
          {...(scale === undefined ? {} : { scale })}
          {...(measurer ? { measurer } : {})}
          onStateChange={refresh}
          {...(onError ? { onError } : {})}
        />
      </div>
    </div>
  );
}
