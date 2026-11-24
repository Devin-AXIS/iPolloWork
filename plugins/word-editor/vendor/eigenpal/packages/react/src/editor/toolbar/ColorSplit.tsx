import { usePickerKeyboard } from './usePickerKeyboard';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The split colour controls: font colour and text highlight.
//
// Both are WIRED value slots. The MAIN half applies the last-used value (seeded from
// the registry's swatch — the red "A"); the narrow CHEVRON half opens Word's picker:
// Automatic (or No Color), the document's theme-colour matrix (ten columns, base plus
// five tint/shade rows), the standard-colour row, and a custom hex field. The popup
// follows the FontFamily pattern: outside pointer presses close it, a pick applies and
// closes, and every control keeps the caret (mousedown prevented, except the hex
// input, which needs focus).
//
// Swatch values are either CONSTANTS in this file or theme hexes ALREADY BOUNDED by
// the engine's derivation (`collectDocumentThemeColors` validates six-digit hex at the
// trust boundary), so the inline `backgroundColor` style objects are not a string sink
// for untrusted data. The engine still validates every dispatched value
// (`setMarkAttr`'s hex / ST_HighlightColor gates); a malformed value would be refused,
// not applied.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  colorPickerGrid,
  commandForSlotValue,
  listenForOutsidePress,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import {
  ToolbarButton,
  chromeControlForSlot,
  chromeIcon,
  guardToolbarMousedown,
} from './ToolbarButton';
import type { ToolbarSlotPartProps } from './parts';

/**
 * Props for the split colour controls. @public
 *
 * The one addition over a plain slot part is `icon`, and it belongs here rather than on
 * `ToolbarSlotPartProps`: the other slot parts are steppers and pickers with no single glyph
 * to replace, so an icon prop on the shared type would be a promise three of them could not
 * keep.
 */
export interface ToolbarColorSplitProps extends ToolbarSlotPartProps {
  /**
   * Replaces the glyph above the colour bar — the registry's red "A" or highlighter pen.
   *
   * The BAR is not replaceable and still paints the live value, so a host swapping the glyph
   * keeps the thing that makes this control readable at a glance.
   */
  icon?: DocxEditorChildren;
}

/** A split colour control pinned to one slot. @public */
export interface ToolbarColorSplitComponent {
  (props: ToolbarColorSplitProps): ReturnType<typeof ToolbarButton>;
  readonly docxSlot: ChromeSlotId;
}

interface SwatchDef {
  /** The value dispatched to the engine (hex without '#', or an ST_HighlightColor name). */
  readonly value: string;
  /** i18n key for the colour's accessible name. */
  readonly labelKey: string;
  /** The CSS colour painted in the grid (a constant or an engine-bounded hex). */
  readonly css: string;
}

/** Word's standard-colour row — ten swatches, `w:color` hex values. */
const STANDARD_COLOR_SWATCHES: readonly SwatchDef[] = [
  { value: 'C00000', labelKey: 'colorPicker.colors.darkRed', css: '#c00000' },
  { value: 'FF0000', labelKey: 'colorPicker.colors.red', css: '#ff0000' },
  { value: 'FFC000', labelKey: 'colorPicker.colors.orange', css: '#ffc000' },
  { value: 'FFFF00', labelKey: 'colorPicker.colors.yellow', css: '#ffff00' },
  { value: '92D050', labelKey: 'colorPicker.colors.lightGreen', css: '#92d050' },
  { value: '00B050', labelKey: 'colorPicker.colors.green', css: '#00b050' },
  { value: '00B0F0', labelKey: 'colorPicker.colors.lightBlue', css: '#00b0f0' },
  { value: '0070C0', labelKey: 'colorPicker.colors.blue', css: '#0070c0' },
  { value: '002060', labelKey: 'colorPicker.colors.darkBlue', css: '#002060' },
  { value: '7030A0', labelKey: 'colorPicker.colors.purple', css: '#7030a0' },
];

/**
 * The closed `ST_HighlightColor` palette, in the engine's own order
 * (`HIGHLIGHT_NAMES`), painted with the same hexes the paint lane maps them to
 * (semantic-paint's HIGHLIGHT table — spec-fixed values, duplicated as constants).
 */
const HIGHLIGHT_SWATCHES: readonly SwatchDef[] = [
  { value: 'yellow', labelKey: 'colorPicker.colors.yellow', css: '#ffff00' },
  { value: 'green', labelKey: 'colorPicker.colors.brightGreen', css: '#00ff00' },
  { value: 'cyan', labelKey: 'colorPicker.colors.cyan', css: '#00ffff' },
  { value: 'magenta', labelKey: 'colorPicker.colors.magenta', css: '#ff00ff' },
  { value: 'blue', labelKey: 'colorPicker.colors.blue', css: '#0000ff' },
  { value: 'red', labelKey: 'colorPicker.colors.red', css: '#ff0000' },
  { value: 'darkBlue', labelKey: 'colorPicker.colors.darkBlue', css: '#000080' },
  { value: 'darkCyan', labelKey: 'colorPicker.colors.darkCyan', css: '#008080' },
  { value: 'darkGreen', labelKey: 'colorPicker.colors.darkGreen', css: '#008000' },
  { value: 'darkMagenta', labelKey: 'colorPicker.colors.darkMagenta', css: '#800080' },
  { value: 'darkRed', labelKey: 'colorPicker.colors.darkRed', css: '#800000' },
  { value: 'darkYellow', labelKey: 'colorPicker.colors.darkYellow', css: '#808000' },
  { value: 'darkGray', labelKey: 'colorPicker.colors.darkGray', css: '#808080' },
  { value: 'lightGray', labelKey: 'colorPicker.colors.lightGray', css: '#c0c0c0' },
  { value: 'black', labelKey: 'colorPicker.colors.black', css: '#000000' },
  { value: 'white', labelKey: 'colorPicker.colors.white', css: '#ffffff' },
];

/** Office's default scheme (the 2013+ "Office" theme), for documents without one. */
const DEFAULT_THEME_HEXES: readonly string[] = [
  'FFFFFF', // lt1 — Background 1
  '000000', // dk1 — Text 1
  'E7E6E6', // lt2 — Background 2
  '44546A', // dk2 — Text 2
  '4472C4', // accent1
  'ED7D31', // accent2
  'A5A5A5', // accent3
  'FFC000', // accent4
  '5B9BD5', // accent5
  '70AD47', // accent6
];

/** Column labels, in the same order the engine answers slots (Word's picker order). */
const THEME_COLUMN_KEYS: readonly string[] = [
  'colorPicker.theme.background1',
  'colorPicker.theme.text1',
  'colorPicker.theme.background2',
  'colorPicker.theme.text2',
  'colorPicker.theme.accent1',
  'colorPicker.theme.accent2',
  'colorPicker.theme.accent3',
  'colorPicker.theme.accent4',
  'colorPicker.theme.accent5',
  'colorPicker.theme.accent6',
];

/**
 * The label key of a tint or shade row: `accent1:40` is Lighter 40%, `accent1:-25` Darker 25%.
 * The paint comes from core's `colorPickerGrid`, the same luminance model as every other colour
 * picker, so one swatch paints one colour everywhere.
 */
function variantLabelKey(pick: string): string {
  const shift = Number(pick.split(':')[1] ?? 0);
  return shift > 0 ? `colorPicker.theme.lighter${shift}` : `colorPicker.theme.darker${-shift}`;
}

const HEX_VALUE = /^[0-9A-Fa-f]{6}$/;

/** Near-white swatches get an outline so they stay visible on the popup surface. */
function isLightHex(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 230;
}

interface ColorSplitConfig {
  readonly slot: ChromeSlotId;
  /** The seed value for the main half, from the registry's swatch. */
  readonly defaultValue: string;
  /** CSS colour for an applied value (hex slots prefix '#', highlight looks up). */
  readonly cssOf: (value: string) => string;
  /** The clearing value and its label: Automatic (`auto`) or No Color (`none`). */
  readonly clear: { readonly value: string; readonly labelKey: string };
  /** Renders the popup body below the clear button. */
  readonly body: (props: PopupBodyProps) => DocxEditorChildren;
}

interface PopupBodyProps {
  readonly apply: (value: string) => void;
  readonly label: (key: string) => string;
  readonly current: string | null;
  readonly themeHexes: readonly string[];
}

export function ToolbarColorSwatch({
  value,
  css,
  title,
  selected,
  apply,
}: {
  value: string;
  css: string;
  title: string;
  selected: boolean;
  apply: (value: string) => void;
}) {
  return (
    <button
      type="button"
      className="docx-toolbar__swatch"
      style={{ backgroundColor: css }}
      aria-label={title}
      aria-pressed={selected}
      title={title}
      data-value={value}
      {...(selected ? { 'data-selected': '' } : {})}
      {...(css.startsWith('var(') || isLightHex(css.replace('#', '')) ? { 'data-light': '' } : {})}
      onMouseDown={guardToolbarMousedown}
      onClick={() => apply(value)}
    />
  );
}

/** The theme matrix: one base row, then five variant rows with per-column ladders. */
function ThemeMatrix({ apply, label, current, themeHexes }: PopupBodyProps) {
  const rows = colorPickerGrid(themeHexes).theme.slice(1);
  return (
    <div className="docx-toolbar__swatch-section">
      <div className="docx-toolbar__swatch-heading">{label('colorPicker.themeColors')}</div>
      <div className="docx-toolbar__swatch-grid docx-toolbar__swatch-grid--theme" role="group">
        {themeHexes.map((hex, column) => (
          <ToolbarColorSwatch
            key={`base-${column}`}
            value={hex}
            css={`#${hex.toLowerCase()}`}
            title={label(THEME_COLUMN_KEYS[column]!)}
            selected={current === hex}
            apply={apply}
          />
        ))}
        {rows.map((row, index) =>
          row.map((swatch, column) => {
            const hex = swatch.hex.slice(1);
            return (
              <ToolbarColorSwatch
                key={`${index}-${column}`}
                value={hex}
                css={`#${hex.toLowerCase()}`}
                title={`${label(THEME_COLUMN_KEYS[column]!)}, ${label(variantLabelKey(swatch.pick))}`}
                selected={current === hex}
                apply={apply}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/** Standard colours plus the custom hex field — the font-colour popup body. */
function FontColorBody(props: PopupBodyProps) {
  const { apply, label, current } = props;
  const [draft, setDraft] = useState('');
  const valid = HEX_VALUE.test(draft);
  return (
    <>
      <ThemeMatrix {...props} />
      <div className="docx-toolbar__swatch-section">
        <div className="docx-toolbar__swatch-heading">{label('colorPicker.standardColors')}</div>
        <div className="docx-toolbar__swatch-grid" role="group">
          {STANDARD_COLOR_SWATCHES.map((swatch) => (
            <ToolbarColorSwatch
              key={swatch.value}
              value={swatch.value}
              css={swatch.css}
              title={label(swatch.labelKey)}
              selected={current === swatch.value}
              apply={apply}
            />
          ))}
        </div>
      </div>
      <div className="docx-toolbar__swatch-section">
        <div className="docx-toolbar__swatch-heading">{label('colorPicker.customColor')}</div>
        <div className="docx-toolbar__swatch-custom">
          <span className="docx-toolbar__swatch-hash" aria-hidden="true">
            #
          </span>
          <input
            type="text"
            className="docx-toolbar__swatch-hex"
            value={draft}
            maxLength={6}
            spellCheck={false}
            aria-label={label('colorPicker.customColor')}
            onChange={(event) =>
              setDraft(event.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) apply(draft.toUpperCase());
            }}
          />
          <button
            type="button"
            className="docx-toolbar__swatch-apply"
            disabled={!valid}
            onMouseDown={guardToolbarMousedown}
            onClick={() => apply(draft.toUpperCase())}
          >
            {label('colorPicker.apply')}
          </button>
        </div>
      </div>
    </>
  );
}

/** Props for the shared Word-style hex colour picker body. @internal */
export interface ToolbarHexColorPickerBodyProps {
  readonly apply: (value: string) => void;
  readonly current: string | null;
}

/** Theme matrix, standard row, and custom hex field — shared by font and table pickers. @internal */
export function ToolbarHexColorPickerBody({
  apply,
  current,
}: ToolbarHexColorPickerBodyProps): ReactNode {
  const editor = useDocxEditor();
  const label = useToolbarLabel();
  const themeEntries = editor?.getDocumentThemeColors() ?? [];
  const themeHexes =
    themeEntries.length === THEME_COLUMN_KEYS.length
      ? themeEntries.map((entry) => entry.hex)
      : DEFAULT_THEME_HEXES;
  const normalizedCurrent = current?.toUpperCase() ?? null;
  return (
    <FontColorBody
      apply={apply}
      label={label}
      current={normalizedCurrent}
      themeHexes={themeHexes}
    />
  );
}

/**
 * Word's highlighter palette: the first fifteen names, five per row. `white` stays
 * applicable (documents carry it) but is not offered — Word's picker omits it, and
 * No Color is the way to clear.
 */
const HIGHLIGHT_GRID = HIGHLIGHT_SWATCHES.filter((swatch) => swatch.value !== 'white');

/** The highlight popup body: the closed ST_HighlightColor grid, Word's 5-wide layout. */
function HighlightBody({ apply, label, current }: PopupBodyProps) {
  return (
    <div className="docx-toolbar__swatch-section">
      <div className="docx-toolbar__swatch-heading">{label('colorPicker.highlightColors')}</div>
      <div className="docx-toolbar__swatch-grid docx-toolbar__swatch-grid--highlight" role="group">
        {HIGHLIGHT_GRID.map((swatch) => (
          <ToolbarColorSwatch
            key={swatch.value}
            value={swatch.value}
            css={swatch.css}
            title={label(swatch.labelKey)}
            selected={current === swatch.value}
            apply={apply}
          />
        ))}
      </div>
    </div>
  );
}

function createColorSplit(config: ColorSplitConfig): ToolbarColorSplitComponent {
  const { slot, defaultValue, cssOf, clear, body } = config;
  const isFontColor = slot === 'text.color';

  const Part = ({ className, hidden, icon }: ToolbarColorSplitProps) => {
    const editor = useDocxEditor();
    const { isEnabled, disabledReason } = useEditorCommand(slot);
    const label = useToolbarLabel();
    const [open, setOpen] = useState(false);
    const [lastValue, setLastValue] = useState(defaultValue);
    const rootRef = useRef<HTMLDivElement | null>(null);
    usePickerKeyboard(rootRef, open, () => setOpen(false));

    // The live value at the selection, so the popup marks the current swatch. Hex
    // colours come back as `{ kind: 'hex', value }`; highlights as their name.
    const current = useEditorState((snapshot) => {
      if (isFontColor) {
        const color = snapshot.formatting?.color;
        return color && color.kind === 'hex' ? color.value.toUpperCase() : null;
      }
      return snapshot.formatting?.highlight ?? null;
    });

    // A document-lifetime read: the session memoizes it (the theme part is immutable
    // in-session), so reading per render costs one length check.
    const themeEntries = editor?.getDocumentThemeColors() ?? [];
    const themeHexes =
      themeEntries.length === THEME_COLUMN_KEYS.length
        ? themeEntries.map((entry) => entry.hex)
        : DEFAULT_THEME_HEXES;

    // Capture before the surface cancels compatibility mouse events or stops propagation.
    useEffect(() => {
      if (!open) return undefined;
      return listenForOutsidePress({
        popup: rootRef.current,
        close: () => setOpen(false),
      });
    }, [open]);

    const apply = useCallback(
      (value: string) => {
        setOpen(false);
        if (!editor) return;
        editor.focus();
        const command = commandForSlotValue(slot, value);
        if (!command) return;
        if (editor.can(command).ok) {
          editor.exec(command);
          // The clearing value is not a colour the apply half should remember.
          if (value !== clear.value) setLastValue(value);
        }
      },
      [editor]
    );

    const control = useMemo(() => chromeControlForSlot(slot), []);
    if (hidden) return null;
    const text = label(control?.labelKey ?? slot);
    return (
      <div
        ref={rootRef}
        className={`docx-toolbar__colorsplit${className ? ` ${className}` : ''}`}
        data-slot={slot}
      >
        <button
          type="button"
          className="docx-toolbar__button docx-toolbar__colorsplit-main"
          disabled={!isEnabled}
          {...(!isEnabled ? { 'data-disabled': '' } : {})}
          aria-label={text}
          title={disabledReason ?? text}
          onMouseDown={guardToolbarMousedown}
          onClick={() => apply(lastValue)}
        >
          {icon ?? chromeIcon(control?.paths)}
          <span
            className="docx-toolbar__colorsplit-bar"
            style={{ backgroundColor: cssOf(lastValue) }}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="docx-toolbar__colorsplit-caret"
          disabled={!isEnabled}
          {...(!isEnabled ? { 'data-disabled': '' } : {})}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={text}
          title={disabledReason ?? text}
          onMouseDown={guardToolbarMousedown}
          onClick={() => setOpen((value) => !value)}
        >
          ▾
        </button>
        {open ? (
          <div
            className="docx-toolbar__swatch-popup"
            role="dialog"
            aria-label={text}
            onMouseDown={guardToolbarMousedown}
          >
            <button
              type="button"
              className="docx-toolbar__swatch-clear"
              onMouseDown={guardToolbarMousedown}
              onClick={() => apply(clear.value)}
            >
              <span
                className={`docx-toolbar__swatch-clear-chip${
                  clear.value === 'none' ? ' docx-toolbar__swatch-clear-chip--none' : ''
                }`}
                aria-hidden="true"
              />
              {label(clear.labelKey)}
            </button>
            {body({ apply, label, current, themeHexes })}
          </div>
        ) : null}
      </div>
    );
  };
  return Object.assign(Part, { docxSlot: slot });
}

const HIGHLIGHT_CSS = new Map(HIGHLIGHT_SWATCHES.map((swatch) => [swatch.value, swatch.css]));

/**
 * The font-colour split button (`DocxEditorToolbar.FontColor`): wired to `text.color`.
 * The seed is the registry swatch (the chrome spec's default red: the apply
 * half starts at `{ rgb: 'FF0000' }` before any pick).
 */
export const ToolbarFontColor: ToolbarColorSplitComponent = createColorSplit({
  slot: 'text.color',
  // The registry's `swatch: '#ff0000'`, as the hex value `w:color` takes.
  defaultValue: 'FF0000',
  cssOf: (value) => (value === 'auto' ? '#000000' : `#${value}`),
  clear: { value: 'auto', labelKey: 'colorPicker.automatic' },
  body: (props) => <ToolbarHexColorPickerBody apply={props.apply} current={props.current} />,
});

/**
 * The highlight split button (`DocxEditorToolbar.Highlight`): wired to
 * `text.highlight`, values from the closed ST_HighlightColor palette.
 */
export const ToolbarHighlight: ToolbarColorSplitComponent = createColorSplit({
  slot: 'text.highlight',
  defaultValue: 'yellow',
  cssOf: (value) => HIGHLIGHT_CSS.get(value) ?? '#ffff00',
  clear: { value: 'none', labelKey: 'colorPicker.noColor' },
  body: (props) => <HighlightBody {...props} />,
});
