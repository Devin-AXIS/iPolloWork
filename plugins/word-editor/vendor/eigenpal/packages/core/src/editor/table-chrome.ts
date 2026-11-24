// Shared table chrome: draft border state, complete-spec command building, labels,
// and preview vocabulary. React and Vue consume this module — no duplicated logic.

import type {
  ColorValue,
  EditorCommand,
  TableBorderEdgeTarget,
  TableBorderSpec,
  TableBorderStyle,
  TableContext,
  TableInteractionLabelKey,
} from '@docx-editor.dev/core/contracts/editor';
import { createT, en } from '@docx-editor.dev/i18n';
import type { ChromeSlotId } from './chrome-controls.ts';
import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

/** Border target picker value — concrete scopes plus clear (`none`). */
export type TableBorderTargetValue = TableBorderEdgeTarget | 'none';

/** UI draft: last active edge scope and the complete border spec to reapply. */
export interface TableChromeDraft {
  readonly activeTarget: TableBorderEdgeTarget;
  readonly spec: TableBorderSpec;
}

/** The draft a table's border chrome starts from: a 1pt black single border on every edge. */
export const DEFAULT_TABLE_CHROME_DRAFT: TableChromeDraft = {
  activeTarget: 'all',
  spec: {
    style: 'single',
    size: 8,
    color: { kind: 'hex', value: '000000' },
  },
};

/**
 * The chrome slots that only exist while the caret is inside a table.
 *
 * A subset of `ChromeSlotId`, so these names are public API on the same terms — renaming one is
 * a breaking change.
 */
export type TableChromeSlotId =
  | 'table.borderTarget'
  | 'table.borderColor'
  | 'table.borderStyle'
  | 'table.borderWidth'
  | 'table.cellFill';

/** Every {@link TableChromeSlotId}, for iteration and for {@link isTableChromeSlot}. */
export const TABLE_CHROME_SLOT_IDS: readonly TableChromeSlotId[] = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
];

export type { TableInteractionLabelKey };

/**
 * The English label for a furniture-insertion control.
 *
 * The FALLBACK, for a host that has not wired its own translator — adapters pass their
 * `useTranslation` result instead so the control follows the app's locale.
 */
export function defaultTableLabel(key: TableInteractionLabelKey): string {
  return createT(en)(key);
}

/** Whether a chrome slot is one of the table-only ones. Narrows the type. */
export function isTableChromeSlot(slot: ChromeSlotId): slot is TableChromeSlotId {
  return (TABLE_CHROME_SLOT_IDS as readonly string[]).includes(slot);
}

/** Contextual table chrome is visible when the engine reports table context. */
export function tableChromeVisible(table: TableContext | null | undefined): boolean {
  return table != null;
}

/** One entry in the border-target picker: which edges it addresses, its icon, and its label key. */
export interface TableBorderTargetOption {
  readonly value: TableBorderTargetValue;
  readonly icon: keyof typeof GENERATED_ICON_PATHS;
  /** i18n key, never a literal string — both adapters translate it themselves. */
  readonly labelKey: string;
}

/** The border-target picker's entries, in Word's own order, ending with clear. */
export const TABLE_BORDER_TARGET_OPTIONS: readonly TableBorderTargetOption[] = [
  { value: 'all', icon: 'border_all', labelKey: 'table.borders.all' },
  { value: 'outside', icon: 'border_outer', labelKey: 'table.borders.outside' },
  { value: 'inside', icon: 'border_inner', labelKey: 'table.borders.inside' },
  { value: 'top', icon: 'border_top', labelKey: 'table.borders.top' },
  { value: 'bottom', icon: 'border_bottom', labelKey: 'table.borders.bottom' },
  { value: 'left', icon: 'border_left', labelKey: 'table.borders.left' },
  { value: 'right', icon: 'border_right', labelKey: 'table.borders.right' },
  { value: 'none', icon: 'border_clear', labelKey: 'table.borders.none' },
];

/** One entry in the border-style picker, with the CSS class that draws its preview line. */
export interface TableBorderStyleOption {
  readonly value: TableBorderStyle;
  readonly labelKey: string;
  /** Class on the preview swatch. Defined in the core stylesheet, which both adapters import. */
  readonly previewClass: string;
}

/** The border-style picker's entries. */
export const TABLE_BORDER_STYLE_OPTIONS: readonly TableBorderStyleOption[] = [
  {
    value: 'single',
    labelKey: 'table.borderStyles.single',
    previewClass: 'docx-table-line--single',
  },
  {
    value: 'dashed',
    labelKey: 'table.borderStyles.dashed',
    previewClass: 'docx-table-line--dashed',
  },
  {
    value: 'dotted',
    labelKey: 'table.borderStyles.dotted',
    previewClass: 'docx-table-line--dotted',
  },
  {
    value: 'double',
    labelKey: 'table.borderStyles.double',
    previewClass: 'docx-table-line--double',
  },
  {
    value: 'triple',
    labelKey: 'table.borderStyles.triple',
    previewClass: 'docx-table-line--triple',
  },
  { value: 'thick', labelKey: 'table.borderStyles.thick', previewClass: 'docx-table-line--thick' },
];

/** One entry in the border-width picker. */
export interface TableBorderWidthOption {
  /** `w:sz` — eighths of a point, as OOXML stores border widths. */
  readonly size: number;
  readonly labelKey: string;
  /** Points, for drawing the preview swatch. `size / 8`. */
  readonly previewThickness: number;
}

/** Widths in eighths of a point — Word-like presets. */
export const TABLE_BORDER_WIDTH_OPTIONS: readonly TableBorderWidthOption[] = [
  { size: 4, labelKey: 'table.borderWidths.halfPt', previewThickness: 0.5 },
  { size: 8, labelKey: 'table.borderWidths.onePt', previewThickness: 1 },
  { size: 12, labelKey: 'table.borderWidths.oneHalfPt', previewThickness: 1.5 },
  { size: 16, labelKey: 'table.borderWidths.twoPt', previewThickness: 2 },
  { size: 24, labelKey: 'table.borderWidths.threePt', previewThickness: 3 },
];

/**
 * What one table-chrome selection produced: the command to run, and the draft to remember.
 *
 * Both halves matter. A border picker is stateful — choosing "dashed" and then "outside" must
 * apply a dashed outside border — so each pick returns the COMPLETE spec to execute alongside the
 * draft the next pick builds on.
 */
export interface TableChromePick {
  readonly command: EditorCommand;
  readonly nextDraft: TableChromeDraft;
}

function isEdgeTarget(value: unknown): value is TableBorderEdgeTarget {
  return (
    value === 'all' ||
    value === 'outside' ||
    value === 'inside' ||
    value === 'top' ||
    value === 'bottom' ||
    value === 'left' ||
    value === 'right'
  );
}

function isBorderTargetValue(value: unknown): value is TableBorderTargetValue {
  return value === 'none' || isEdgeTarget(value);
}

function isColorValue(value: unknown): value is ColorValue {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'hex' || kind === 'theme' || kind === 'auto';
}

function isBorderStyle(value: unknown): value is TableBorderStyle {
  return TABLE_BORDER_STYLE_OPTIONS.some((option) => option.value === value);
}

/**
 * Build the engine command for one table chrome pick and the draft state after it.
 * Target picks apply the current complete spec; `none` clears the active target only.
 */
export function applyTableChromePick(
  draft: TableChromeDraft,
  slot: TableChromeSlotId,
  value: unknown
): TableChromePick | null {
  switch (slot) {
    case 'table.borderTarget': {
      if (!isBorderTargetValue(value)) return null;
      if (value === 'none') {
        return {
          command: { type: 'setTableBorders', scope: 'none', target: draft.activeTarget },
          nextDraft: draft,
        };
      }
      return {
        command: { type: 'setTableBorders', scope: value, spec: draft.spec },
        nextDraft: { activeTarget: value, spec: draft.spec },
      };
    }
    case 'table.borderColor': {
      if (!isColorValue(value)) return null;
      const spec = { ...draft.spec, color: value };
      return {
        command: { type: 'setTableBorders', scope: draft.activeTarget, spec },
        nextDraft: { activeTarget: draft.activeTarget, spec },
      };
    }
    case 'table.borderStyle': {
      if (!isBorderStyle(value)) return null;
      const spec = { ...draft.spec, style: value };
      return {
        command: { type: 'setTableBorders', scope: draft.activeTarget, spec },
        nextDraft: { activeTarget: draft.activeTarget, spec },
      };
    }
    case 'table.borderWidth': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return null;
      const spec = { ...draft.spec, size: value };
      return {
        command: { type: 'setTableBorders', scope: draft.activeTarget, spec },
        nextDraft: { activeTarget: draft.activeTarget, spec },
      };
    }
    case 'table.cellFill': {
      if (value !== null && !isColorValue(value)) return null;
      return {
        command: { type: 'setCellFill', color: value },
        nextDraft: draft,
      };
    }
    default:
      return null;
  }
}

/** Probe command for `Editor.can` — uses the draft's active target and a well-formed value. */
export function probeTableChromeCommand(
  slot: TableChromeSlotId,
  draft: TableChromeDraft = DEFAULT_TABLE_CHROME_DRAFT
): EditorCommand | null {
  switch (slot) {
    case 'table.borderTarget':
      return { type: 'setTableBorders', scope: draft.activeTarget, spec: draft.spec };
    case 'table.borderColor':
      return applyTableChromePick(draft, slot, { kind: 'hex', value: '000000' })?.command ?? null;
    case 'table.borderStyle':
      return applyTableChromePick(draft, slot, 'single')?.command ?? null;
    case 'table.borderWidth':
      return applyTableChromePick(draft, slot, 8)?.command ?? null;
    case 'table.cellFill':
      return { type: 'setCellFill', color: { kind: 'hex', value: 'FFFF00' } };
    default:
      return null;
  }
}

/**
 * The i18n key naming one border target, for a trigger that shows the active scope.
 *
 * Falls back to the "all" key rather than throwing: a label is chrome, and a missing one should
 * not take the toolbar down.
 */
export function tableChromeLabelKeyForTarget(target: TableBorderEdgeTarget): string {
  const match = TABLE_BORDER_TARGET_OPTIONS.find((option) => option.value === target);
  return match?.labelKey ?? 'table.borders.all';
}

/** Material Symbol paths for one table chrome icon name. */
export function tableChromeIconPaths(name: keyof typeof GENERATED_ICON_PATHS): readonly string[] {
  return GENERATED_ICON_PATHS[name];
}
