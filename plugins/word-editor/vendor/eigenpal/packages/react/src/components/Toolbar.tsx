import type { DocxEditorChildren } from '../docx-editor-children';
import type { RefObject } from '../docx-editor-ref-object';
import type { ReactNode } from 'react';
/**
 * Toolbar Component
 *
 * The customizable formatting rail — undo/redo, zoom, styles, fonts,
 * bold/italic/underline, colors, alignment, lists, table/image context,
 * clear formatting. Used standalone (`<Toolbar ...props>`), inside
 * `<EditorToolbar>` (reads from context via `EditorToolbar.Toolbar`), or
 * embedded inline. Also the home of the `ToolbarButton` / `ToolbarGroup` /
 * `ToolbarSeparator` primitives and the shared `FormattingAction` /
 * `SelectionFormatting` / `ToolbarProps` types.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../i18n';
import type { CSSProperties } from 'react';
import type { ColorValue, Theme } from '@docx-editor.dev/core/contracts/editor';
import { resolveColorToHex } from '../lib/colorResolver';
import type { DocumentStyleSummary } from '../lib/stylePreview';
import type { ParagraphAlignment } from './ui/AlignmentButtons';
import { Button } from './ui/Button';
import { Tooltip } from './ui/Tooltip';
import { FontPicker } from './ui/FontPicker';
import type { FontOption } from './ui/FontPicker';
import { normalizeFontFamilies } from './ui/normalizeFontFamilies';
import { FontSizePicker, halfPointsToPoints } from './ui/FontSizePicker';
import { ColorPicker } from './ui/ColorPicker';
import { AlignmentButtons } from './ui/AlignmentButtons';
import { ListButtons, createDefaultListState } from './ui/ListButtons';
import type { ListState } from './ui/ListButtons';
import { LineSpacingPicker } from './ui/LineSpacingPicker';
import { StylePicker } from './ui/StylePicker';
import { MaterialSymbol } from './ui/MaterialSymbol';
import { ZoomControl } from './ui/ZoomControl';
import { TableBorderPicker } from './ui/TableBorderPicker';
import { TableBorderColorPicker } from './ui/TableBorderColorPicker';
import { TableBorderWidthPicker } from './ui/TableBorderWidthPicker';
import { TableCellFillPicker } from './ui/TableCellFillPicker';
import { TableMoreDropdown } from './ui/TableMoreDropdown';
import { ImageWrapDropdown } from './ui/ImageWrapDropdown';
import { ImageTransformDropdown } from './ui/ImageTransformDropdown';
import type { TableAction } from './ui/TableToolbar';
import { cn } from '../lib/utils';
import { EditorToolbarContext } from './EditorToolbarContext';
import { hostDocumentOf, hostWindowOf } from '@docx-editor.dev/core/editor';

const ICON_SIZE = 18;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Current formatting state of the selection
 */
export interface SelectionFormatting {
  /** Whether selected text is bold */
  bold?: boolean;
  /** Whether selected text is italic */
  italic?: boolean;
  /** Whether selected text is underlined */
  underline?: boolean;
  /** Whether selected text has strikethrough */
  strike?: boolean;
  /** Whether selected text is superscript */
  superscript?: boolean;
  /** Whether selected text is subscript */
  subscript?: boolean;
  /** Font family of selected text */
  fontFamily?: string;
  /** Font size of selected text (in half-points) */
  fontSize?: number;
  /** Text color */
  color?: string;
  /** Highlight color */
  highlight?: string;
  /** Paragraph alignment */
  alignment?: ParagraphAlignment;
  /** List state of the current paragraph */
  listState?: ListState;
  /** Line spacing in twips (OOXML value, 240 = single spacing) */
  lineSpacing?: number;
  /** Paragraph style ID */
  styleId?: string;
  /** Paragraph left indentation in twips */
  indentLeft?: number;
  /** Whether the paragraph is RTL (bidi) */
  bidi?: boolean;
}

/**
 * Formatting action types
 */
export type FormattingAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'superscript'
  | 'subscript'
  | 'clearFormatting'
  | 'bulletList'
  | 'numberedList'
  | 'indent'
  | 'outdent'
  | 'insertLink'
  | 'setRtl'
  | 'setLtr'
  | { type: 'fontFamily'; value: string }
  | { type: 'fontSize'; value: number }
  | { type: 'textColor'; value: ColorValue | string }
  | { type: 'highlightColor'; value: string }
  | { type: 'alignment'; value: ParagraphAlignment }
  | { type: 'lineSpacing'; value: number }
  | { type: 'applyStyle'; value: string };

/**
 * Props for the Toolbar (formatting rail) component
 * @deprecated Use `DocxEditor.Toolbar` from the composition layer instead.
 */
export interface ToolbarProps {
  /** Current formatting of the selection */
  currentFormatting?: SelectionFormatting;
  /** Callback when a formatting action is triggered */
  onFormat?: (action: FormattingAction) => void;
  /** Callback for undo action */
  onUndo?: () => void;
  /** Callback for redo action */
  onRedo?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Whether the toolbar is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Whether to enable keyboard shortcuts (default: true) */
  enableShortcuts?: boolean;
  /** Ref to the editor container for keyboard events */
  editorRef?: RefObject<HTMLElement>;
  /** Custom toolbar items to render at the end */
  children?: DocxEditorChildren;
  /** When true, renders with display:contents so children flow in the parent flex container */
  inline?: boolean;
  /** Whether to show font family picker (default: true) */
  showFontPicker?: boolean;
  /**
   * Custom list of fonts in the toolbar dropdown. When omitted, the built-in
   * 12-font default is used. Strings render in the "Other" group; pass
   * `FontOption[]` for category grouping and CSS fallback chains.
   * An empty array renders an empty (but enabled) dropdown.
   */
  fontFamilies?: ReadonlyArray<string | FontOption>;
  /**
   * Fonts the loaded document references that the browser can render (embedded
   * faces + system-resolved). Rendered in a "Document fonts" group, deduped
   * against `fontFamilies`. Managed by the editor, not a consumer prop.
   */
  documentFonts?: readonly FontOption[];
  /** Whether to show font size picker (default: true) */
  showFontSizePicker?: boolean;
  /** Whether to show text color picker (default: true) */
  showTextColorPicker?: boolean;
  /** Whether to show highlight color picker (default: true) */
  showHighlightColorPicker?: boolean;
  /** Whether to show alignment buttons (default: true) */
  showAlignmentButtons?: boolean;
  /** Whether to show list buttons (default: true) */
  showListButtons?: boolean;
  /** Whether to show line spacing picker (default: true) */
  showLineSpacingPicker?: boolean;
  /** Whether to show style picker (default: true) */
  showStylePicker?: boolean;
  /** Document styles for the style picker (`Editor.getDocumentStyles()`). */
  documentStyles?: readonly DocumentStyleSummary[];
  /** Theme for the style picker / color picker theme matrix */
  theme?: Theme | null;
  /** Callback for print action. Set to enable the File > Print menu entry. */
  onPrint?: () => void;
  /** Callback to open/import a DOCX file (File → Open) */
  onOpen?: () => void;
  /** Callback to save/download the current DOCX (File → Save) */
  onSave?: () => void;
  /** Whether to show zoom control (default: true) */
  showZoomControl?: boolean;
  /** Current zoom level (1.0 = 100%) */
  zoom?: number;
  /** Callback when zoom changes */
  onZoomChange?: (zoom: number) => void;
  /** Callback to refocus the editor after toolbar interactions */
  onRefocusEditor?: () => void;
  /** Callback when a table should be inserted */
  onInsertTable?: (rows: number, columns: number) => void;
  /** Whether to show table insert button (default: true) */
  showTableInsert?: boolean;
  /** Whether to show the Help menu in the menu bar (default: true) */
  showHelpMenu?: boolean;
  /** Callback when user wants to insert an image */
  onInsertImage?: () => void;
  /** Callback when user wants to insert a page break */
  onInsertPageBreak?: () => void;
  /** Callback when user wants to insert a "next page" section break */
  onInsertSectionBreakNextPage?: () => void;
  /** Callback when user wants to insert a "continuous" section break */
  onInsertSectionBreakContinuous?: () => void;
  /** Callback when user wants to insert a table of contents */
  onInsertTOC?: () => void;
  /** Callback when user wants to insert a shape */
  onInsertShape?: (data: {
    shapeType: string;
    width: number;
    height: number;
    fillColor?: string;
    fillType?: string;
    outlineWidth?: number;
    outlineColor?: string;
  }) => void;
  /** Image context when an image is selected */
  imageContext?: {
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
  } | null;
  /** Callback when image wrap type changes */
  onImageWrapType?: (wrapType: string) => void;
  /** Callback for image transform (rotate/flip) */
  onImageTransform?: (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void;
  /** Callback to open image properties dialog (alt text + border) */
  onOpenImageProperties?: () => void;
  /** Callback to open page setup dialog */
  onPageSetup?: () => void;
  /** Callback to open the watermark dialog */
  onWatermark?: () => void;
  /** Table context when cursor is in a table */
  tableContext?: {
    isInTable: boolean;
    rowCount?: number;
    columnCount?: number;
    canSplitCell?: boolean;
    hasMultiCellSelection?: boolean;
    cellBorderColor?: ColorValue;
    cellBackgroundColor?: string;
  } | null;
  /** Callback when a table action is triggered */
  onTableAction?: (action: TableAction) => void;
}

/**
 * Props for individual toolbar buttons
 */
export interface ToolbarButtonProps {
  /** Whether the button is in active/pressed state */
  active?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Button title/tooltip */
  title?: string;
  /** Click handler */
  onClick?: () => void;
  /** Button content */
  children: ReactNode;
  /** Additional CSS class name */
  className?: string;
  /** ARIA label for accessibility */
  ariaLabel?: string;
}

/**
 * Props for toolbar button groups
 */
export interface ToolbarGroupProps {
  /** Group label for accessibility */
  label?: string;
  /** Group content */
  children: ReactNode;
  /** Additional CSS class name */
  className?: string;
}

// ============================================================================
// PRIMITIVES
// ============================================================================

/**
 * Individual toolbar button with shadcn styling
 */
/** @deprecated Use `DocxEditor.Toolbar` button parts instead. */
export function ToolbarButton({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
  className,
  ariaLabel,
}: ToolbarButtonProps) {
  const testId =
    ariaLabel?.toLowerCase().replace(/\s+/g, '-') ||
    title
      ?.toLowerCase()
      .replace(/\s+/g, '-')
      // `[^()]` (not `[^)]`) so the run can't span unmatched `(` and
      // backtrack quadratically on a long parenthesis-heavy title.
      .replace(/\([^()]*\)/g, '')
      .trim();

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        // Hover + active states live in editor.css (.docx-editor-toolbar-toggle); see
        // that rule for why they're not Tailwind utilities here.
        'docx-editor-toolbar-toggle text-muted-foreground',
        disabled && 'opacity-30 cursor-not-allowed',
        className
      )}
      data-active={active ? 'true' : undefined}
      onMouseDown={handleMouseDown}
      onClick={disabled ? undefined : onClick}
      // Native disabled controls receive no mouse event in Chromium, so their
      // preventDefault handler cannot preserve the editor's focus/caret.
      // Keep the control semantically disabled and out of tab order while
      // allowing pointer-down cancellation at the toolbar boundary.
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      aria-pressed={active ? true : false}
      aria-label={ariaLabel || title}
      data-testid={testId ? `toolbar-${testId}` : undefined}
    >
      {children}
    </Button>
  );

  if (title) {
    return <Tooltip content={title}>{button}</Tooltip>;
  }

  return button;
}

/**
 * Toolbar button group with modern styling
 */
/** @deprecated Use `DocxEditor.Toolbar` group parts instead. */
export function ToolbarGroup({ label, children, className }: ToolbarGroupProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-px px-1.5 border-r border-border/50 last:border-r-0 first:pl-0',
        className
      )}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/**
 * Toolbar separator
 */
export function ToolbarSeparator() {
  return <div className="w-px h-6 bg-border mx-1.5" role="separator" />;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Resolves props: if explicit props are provided, use them; otherwise fall back to context.
 */
function useToolbarProps(props: ToolbarProps): ToolbarProps {
  const ctx = React.useContext(EditorToolbarContext);

  // If we have context, merge: explicit props override context
  if (ctx) {
    return { ...ctx, ...stripUndefined(props) };
  }
  return props;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Icon-based formatting toolbar — undo/redo, zoom, styles, fonts,
 * bold/italic/underline, colors, alignment, lists, table/image context, clear formatting.
 */
/** @deprecated Use `DocxEditor.Toolbar` from the composition layer instead. */
export function Toolbar(explicitProps: ToolbarProps) {
  const { t } = useTranslation();
  const props = useToolbarProps(explicitProps);
  const {
    currentFormatting = {},
    onFormat,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    disabled = false,
    className,
    style,
    enableShortcuts = true,
    editorRef,
    children,
    showFontPicker = true,
    fontFamilies,
    documentFonts,
    showFontSizePicker = true,
    showTextColorPicker = true,
    showHighlightColorPicker = true,
    showAlignmentButtons = true,
    showListButtons = true,
    showLineSpacingPicker = true,
    showStylePicker = true,
    documentStyles,
    theme,
    showZoomControl = true,
    zoom,
    onZoomChange,
    onRefocusEditor,
    imageContext,
    onImageWrapType,
    onImageTransform,
    onOpenImageProperties,
    tableContext,
    onTableAction,
    inline = false,
  } = props;

  const barRef = useRef<HTMLDivElement>(null);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleFormat = useCallback(
    (action: FormattingAction) => {
      if (!disabled && onFormat) {
        onFormat(action);
      }
    },
    [disabled, onFormat]
  );

  const handleUndo = useCallback(() => {
    if (!disabled && canUndo && onUndo) {
      onUndo();
    }
  }, [disabled, canUndo, onUndo]);

  const handleRedo = useCallback(() => {
    if (!disabled && canRedo && onRedo) {
      onRedo();
    }
  }, [disabled, canRedo, onRedo]);

  const handleFontFamilyChange = useCallback(
    (fontFamily: string) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'fontFamily', value: fontFamily });
        // Do not refocus here: focus() on an empty paragraph clears storedMarks
        // / DTF (same regression as style picker). FormatToggle already uses
        // mousedown preventDefault so the editor keeps focus.
      }
    },
    [disabled, onFormat]
  );

  const normalizedFonts = React.useMemo(() => normalizeFontFamilies(fontFamilies), [fontFamilies]);

  const handleFontSizeChange = useCallback(
    (sizeInPoints: number) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'fontSize', value: sizeInPoints });
      }
    },
    [disabled, onFormat]
  );

  const handleTextColorChange = useCallback(
    (color: ColorValue | string) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'textColor', value: color });
      }
    },
    [disabled, onFormat]
  );

  const handleHighlightColorChange = useCallback(
    (color: ColorValue | string) => {
      if (!disabled && onFormat) {
        const highlightValue = typeof color === 'string' ? color : '';
        onFormat({ type: 'highlightColor', value: highlightValue });
      }
    },
    [disabled, onFormat]
  );

  const handleAlignmentChange = useCallback(
    (alignment: ParagraphAlignment) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'alignment', value: alignment });
      }
    },
    [disabled, onFormat]
  );

  const handleBulletList = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('bulletList');
    }
  }, [disabled, onFormat]);

  const handleNumberedList = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('numberedList');
    }
  }, [disabled, onFormat]);

  const handleIndent = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('indent');
    }
  }, [disabled, onFormat]);

  const handleOutdent = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('outdent');
    }
  }, [disabled, onFormat]);

  const handleLineSpacingChange = useCallback(
    (twipsValue: number) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'lineSpacing', value: twipsValue });
        hostWindowOf(barRef.current).requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleStyleChange = useCallback(
    (styleId: string) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'applyStyle', value: styleId });
        // Do not refocus — EmptyParagraphFormat + DTF own caret marks; a
        // post-picker focus() was clearing them before the first keystroke.
      }
    },
    [disabled, onFormat]
  );

  const handleTableAction = useCallback(
    (action: TableAction) => {
      if (!disabled && onTableAction) {
        onTableAction(action);
        hostWindowOf(barRef.current).requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onTableAction, onRefocusEditor]
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    if (!enableShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // FAIL SOFT on a chord someone else already claimed, like the shared engine keymap.
      //
      // This is a `document`-level BUBBLE listener, so anything the host claimed on the way
      // down has already run: `DocxEditor.Viewport` takes Ctrl/Cmd `=` (and its shifted `+`
      // spelling) for live zoom during capture, and Word's subscript/superscript is bound to
      // the same chord below. Without this, a host that mounts this toolbar around the new
      // viewport got the zoom AND the script toggle from one keystroke.
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      const editorContainer = editorRef?.current;
      const barContainer = barRef.current;

      const isInEditor = editorContainer?.contains(target);
      const isInBar = barContainer?.contains(target);

      if (!isInEditor && !isInBar) return;

      const isCtrl = event.ctrlKey || event.metaKey;

      if (isCtrl && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'b':
            event.preventDefault();
            handleFormat('bold');
            break;
          case 'i':
            event.preventDefault();
            handleFormat('italic');
            break;
          case 'u':
            event.preventDefault();
            handleFormat('underline');
            break;
          case '=':
            if (event.shiftKey) {
              event.preventDefault();
              handleFormat('superscript');
            } else {
              event.preventDefault();
              handleFormat('subscript');
            }
            break;
          case 'l':
            event.preventDefault();
            handleAlignmentChange('left');
            break;
          case 'e':
            event.preventDefault();
            handleAlignmentChange('center');
            break;
          case 'r':
            event.preventDefault();
            handleAlignmentChange('right');
            break;
          case 'j':
            event.preventDefault();
            handleAlignmentChange('both');
            break;
          case 'k':
            event.preventDefault();
            handleFormat('insertLink');
            break;
        }
      }
    };

    // The editor's own document: a pop-out window or an iframe has its own key events.
    const doc = hostDocumentOf(editorRef?.current ?? barRef.current);
    doc.addEventListener('keydown', handleKeyDown);
    return () => {
      doc.removeEventListener('keydown', handleKeyDown);
    };
  }, [enableShortcuts, handleFormat, handleAlignmentChange, editorRef]);

  // ── Focus management ──────────────────────────────────────────────────

  const handleBarMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'OPTION';

    if (!isInteractive) {
      e.preventDefault();
    }
  }, []);

  const handleBarMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const activeEl = hostDocumentOf(target).activeElement as HTMLElement;
      const isSelectActive =
        target.tagName === 'SELECT' ||
        target.tagName === 'OPTION' ||
        activeEl?.tagName === 'SELECT';

      if (isSelectActive) return;

      hostWindowOf(target).requestAnimationFrame(() => {
        onRefocusEditor?.();
      });
    },
    [onRefocusEditor]
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={barRef}
      className={cn(
        !inline &&
          'flex items-center px-2 py-1 bg-muted rounded-full min-h-[36px] overflow-x-auto mx-2 mb-1',
        className
      )}
      style={inline ? { display: 'contents', ...style } : style}
      role={inline ? undefined : 'toolbar'}
      aria-label={inline ? undefined : t('toolbar.ariaLabel')}
      data-testid={inline ? undefined : 'formatting-bar'}
      onMouseDown={inline ? undefined : handleBarMouseDown}
      onMouseUp={inline ? undefined : handleBarMouseUp}
    >
      {/* Undo/Redo Group */}
      <ToolbarGroup label={t('formattingBar.groups.history')}>
        <ToolbarButton
          onClick={handleUndo}
          disabled={disabled || !canUndo}
          title={t('formattingBar.undoShortcut')}
          ariaLabel={t('formattingBar.undo')}
        >
          <MaterialSymbol name="undo" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleRedo}
          disabled={disabled || !canRedo}
          title={t('formattingBar.redoShortcut')}
          ariaLabel={t('formattingBar.redo')}
        >
          <MaterialSymbol name="redo" size={ICON_SIZE} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* Zoom Control */}
      {showZoomControl && (
        <ToolbarGroup label={t('formattingBar.groups.zoom')}>
          <ZoomControl value={zoom} onChange={onZoomChange} disabled={disabled} compact />
        </ToolbarGroup>
      )}

      {/* Style Picker */}
      {showStylePicker && (
        <ToolbarGroup label={t('formattingBar.groups.styles')}>
          <StylePicker
            value={currentFormatting.styleId || 'Normal'}
            onChange={handleStyleChange}
            styles={documentStyles}
            theme={theme}
            disabled={disabled}
            width={120}
          />
        </ToolbarGroup>
      )}

      {/* Font Family and Size Pickers */}
      {(showFontPicker || showFontSizePicker) && (
        <ToolbarGroup label={t('formattingBar.groups.font')}>
          {showFontPicker && (
            <FontPicker
              value={currentFormatting.fontFamily || 'Arial'}
              onChange={handleFontFamilyChange}
              fonts={normalizedFonts}
              documentFonts={documentFonts}
              disabled={disabled}
              width={60}
              placeholder="Arial"
            />
          )}
          {showFontSizePicker && (
            <FontSizePicker
              value={
                currentFormatting.fontSize !== undefined
                  ? halfPointsToPoints(currentFormatting.fontSize)
                  : 11
              }
              onChange={handleFontSizeChange}
              disabled={disabled}
              width={42}
              placeholder="11"
            />
          )}
        </ToolbarGroup>
      )}

      {/* Text Formatting Group */}
      <ToolbarGroup label={t('formattingBar.groups.textFormatting')}>
        <ToolbarButton
          onClick={() => handleFormat('bold')}
          active={currentFormatting.bold}
          disabled={disabled}
          title={t('formattingBar.boldShortcut')}
          ariaLabel={t('formattingBar.bold')}
        >
          <MaterialSymbol name="format_bold" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('italic')}
          active={currentFormatting.italic}
          disabled={disabled}
          title={t('formattingBar.italicShortcut')}
          ariaLabel={t('formattingBar.italic')}
        >
          <MaterialSymbol name="format_italic" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('underline')}
          active={currentFormatting.underline}
          disabled={disabled}
          title={t('formattingBar.underlineShortcut')}
          ariaLabel={t('formattingBar.underline')}
        >
          <MaterialSymbol name="format_underlined" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('strikethrough')}
          active={currentFormatting.strike}
          disabled={disabled}
          title={t('formattingBar.strikethrough')}
          ariaLabel={t('formattingBar.strikethrough')}
        >
          <MaterialSymbol name="strikethrough_s" size={ICON_SIZE} />
        </ToolbarButton>
        {showTextColorPicker && (
          <ColorPicker
            mode="text"
            value={currentFormatting.color?.replace(/^#/, '')}
            onChange={handleTextColorChange}
            theme={theme}
            disabled={disabled}
            title={t('formattingBar.fontColor')}
          />
        )}
        {showHighlightColorPicker && (
          <ColorPicker
            mode="highlight"
            value={currentFormatting.highlight}
            onChange={handleHighlightColorChange}
            theme={theme}
            disabled={disabled}
            title={t('formattingBar.highlightColor')}
          />
        )}
        <ToolbarButton
          onClick={() => handleFormat('insertLink')}
          disabled={disabled}
          title={t('formattingBar.insertLinkShortcut')}
          ariaLabel={t('formattingBar.insertLink')}
        >
          <MaterialSymbol name="link" size={ICON_SIZE} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* Superscript/Subscript Group */}
      <ToolbarGroup label={t('formattingBar.groups.script')}>
        <ToolbarButton
          onClick={() => handleFormat('superscript')}
          active={currentFormatting.superscript}
          disabled={disabled}
          title={t('formattingBar.superscriptShortcut')}
          ariaLabel={t('formattingBar.superscript')}
        >
          <MaterialSymbol name="superscript" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('subscript')}
          active={currentFormatting.subscript}
          disabled={disabled}
          title={t('formattingBar.subscriptShortcut')}
          ariaLabel={t('formattingBar.subscript')}
        >
          <MaterialSymbol name="subscript" size={ICON_SIZE} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* Alignment Dropdown */}
      {showAlignmentButtons && (
        <ToolbarGroup label={t('formattingBar.groups.alignment')}>
          <AlignmentButtons
            value={currentFormatting.alignment || 'left'}
            onChange={handleAlignmentChange}
            disabled={disabled}
          />
        </ToolbarGroup>
      )}

      {/* List Buttons and Line Spacing */}
      {(showListButtons || showLineSpacingPicker) && (
        <ToolbarGroup label={t('formattingBar.groups.listFormatting')}>
          {showListButtons && (
            <ListButtons
              listState={currentFormatting.listState || createDefaultListState()}
              onBulletList={handleBulletList}
              onNumberedList={handleNumberedList}
              onIndent={handleIndent}
              onOutdent={handleOutdent}
              disabled={disabled}
              showIndentButtons={true}
              compact
              hasIndent={(currentFormatting.indentLeft ?? 0) > 0}
            />
          )}
          {showLineSpacingPicker && (
            <LineSpacingPicker
              value={currentFormatting.lineSpacing}
              onChange={handleLineSpacingChange}
              disabled={disabled}
            />
          )}
        </ToolbarGroup>
      )}

      {/* Image controls - shown when image is selected */}
      {imageContext && onImageWrapType && (
        <ToolbarGroup label={t('formattingBar.groups.image')}>
          <ImageWrapDropdown
            imageContext={imageContext}
            onChange={onImageWrapType}
            disabled={disabled}
          />
          {onImageTransform && (
            <ImageTransformDropdown onTransform={onImageTransform} disabled={disabled} />
          )}
          {onOpenImageProperties && (
            <ToolbarButton
              onClick={onOpenImageProperties}
              disabled={disabled}
              title={t('formattingBar.imagePropertiesShortcut')}
              ariaLabel={t('formattingBar.imageProperties')}
            >
              <MaterialSymbol name="tune" size={ICON_SIZE} />
            </ToolbarButton>
          )}
        </ToolbarGroup>
      )}

      {/* Table Options - shown when cursor is in a table */}
      {tableContext?.isInTable && onTableAction && (
        <ToolbarGroup label={t('formattingBar.groups.table')}>
          <TableBorderPicker onAction={handleTableAction} disabled={disabled} />
          <TableBorderColorPicker
            onAction={handleTableAction}
            disabled={disabled}
            theme={theme}
            value={resolveColorToHex(tableContext?.cellBorderColor, theme)}
          />
          <TableBorderWidthPicker onAction={handleTableAction} disabled={disabled} />
          <TableCellFillPicker
            onAction={handleTableAction}
            disabled={disabled}
            theme={theme}
            value={tableContext?.cellBackgroundColor}
          />
          <TableMoreDropdown
            onAction={handleTableAction}
            disabled={disabled}
            tableContext={tableContext}
          />
        </ToolbarGroup>
      )}

      {/* Clear Formatting */}
      <ToolbarButton
        onClick={() => handleFormat('clearFormatting')}
        disabled={disabled}
        title={t('formattingBar.clearFormatting')}
        ariaLabel={t('formattingBar.clearFormatting')}
      >
        <MaterialSymbol name="format_clear" size={ICON_SIZE} />
      </ToolbarButton>

      {/* Custom toolbar items */}
      {children}
    </div>
  );
}

// ============================================================================
// RE-EXPORTED UTILITIES (from toolbarUtils.ts)
// ============================================================================

export { getSelectionFormatting, hasActiveFormatting, mapHexToHighlightName } from './toolbarUtils';

export default Toolbar;
