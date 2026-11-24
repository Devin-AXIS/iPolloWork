// `setShapeFill` and `setShapeOutline`: the fill and outline of the selected shape, text box,
// line or group, as one `setShapeFormat` op and so one undo step.
//
// `can` runs the same validation the op runs against the current part, so a command `can`
// admits applies, and one it refuses names the reason: no selection, a stale one, a drawing
// with no fill to set, or a value the op cannot write exactly.

import type {
  EditorCommand,
  ExecResult,
  SetShapeFillCommand,
  SetShapeOutlineCommand,
} from '../contracts/editor.ts';
import type { ShapeColorValue } from '../contracts/editor-shape-format.ts';
import { themeColorElement, validateShapeFormat } from '../store/store/tree-op-shape-format.ts';
import type {
  DrawingTreeDocOp,
  ShapeThemeColorInput,
  TreeOpRejection,
} from '../store/store/tree-op-types.ts';
import { resolveColorNode } from '../store/package/drawing-shape-color.ts';
import { createPackageShapeThemeResolvers } from '../store/package/theme-color-resolution.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import { selectedImageStateOf } from './docx-editor-images.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';
import { CHART_THEME_SLOTS, chartThemeHexes } from './chart-pane.ts';
import { shapeColorHex } from '../store/package/shape-format.ts';

type ShapeFormatCommand = Extract<EditorCommand, { type: 'setShapeFill' | 'setShapeOutline' }>;
type SetShapeFormatOp = Extract<DrawingTreeDocOp, { op: 'setShapeFormat' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

export function isShapeFormatCommand(command: EditorCommand): command is ShapeFormatCommand {
  return command.type === 'setShapeFill' || command.type === 'setShapeOutline';
}

/** `RRGGBB` from `RRGGBB`, `#RRGGBB` or a CSS colour name; anything else stays for the op to refuse. */
function hexOf(color: unknown): string | undefined {
  if (color === undefined) return undefined;
  return typeof color === 'string' ? (shapeColorHex(color) ?? color) : String(color);
}

/** Resolves a theme colour to the `RRGGBB` it shows in this document, or null. */
type ThemeHex = (theme: ShapeThemeColorInput) => string | null;

/** The default theme, by slot name, for a document that has no theme part. */
const DEFAULT_THEME = new Map<string, string | null>(
  CHART_THEME_SLOTS.map((slot, index) => [slot, chartThemeHexes(undefined)[index] ?? null])
);

/** `RRGGBB` of a theme colour, with its tint or shade, through `resolveSchemeColor`. */
function themeHexOf(
  theme: ShapeThemeColorInput,
  resolveSchemeColor: (scheme: string) => string | null
): string | null {
  const hex = resolveColorNode(themeColorElement(theme), resolveSchemeColor)?.hex;
  return hex ? hex.toUpperCase() : null;
}

/**
 * The op fields of a command colour: `color` alone for `RRGGBB`, or the theme reference with
 * the `RRGGBB` it resolves to, which a VML copy writes. A document with no theme colours takes
 * the `RRGGBB` of the default theme, because a reference there would resolve to nothing. A
 * theme name that is not a slot keeps an invalid colour, so the op refuses it.
 */
function colorFields(
  color: ShapeColorValue | undefined,
  themeHex: ThemeHex
): { color?: string; theme?: ShapeThemeColorInput } {
  if (color === undefined) return {};
  if (typeof color !== 'object' || color === null) return { color: hexOf(color) };
  const theme: ShapeThemeColorInput = {
    name: color.theme,
    ...(color.shift !== undefined ? { shift: color.shift } : {}),
  };
  const hex = themeHex(theme);
  if (hex) return { color: hex, theme };
  return { color: themeHexOf(theme, (slot) => DEFAULT_THEME.get(slot) ?? null) ?? '' };
}

function fillOf(
  command: SetShapeFillCommand,
  themeHex: ThemeHex
): SetShapeFormatOp['fill'] | Refusal {
  const { visible, color, transparency } = command;
  if (visible === undefined && color === undefined && transparency === undefined)
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'setShapeFill needs visible, color or transparency',
    };
  if (visible === false) {
    if (color !== undefined || transparency !== undefined)
      return { ok: false, code: 'invalidArgs', reason: 'a hidden fill takes no color' };
    return { type: 'none' };
  }
  return {
    type: 'solid',
    ...colorFields(color, themeHex),
    ...(transparency !== undefined ? { transparency } : {}),
  };
}

function outlineOf(
  command: SetShapeOutlineCommand,
  themeHex: ThemeHex
): SetShapeFormatOp['outline'] {
  const { visible, color, widthPt, dash } = command;
  return {
    ...(visible !== undefined ? { visible } : {}),
    ...colorFields(color, themeHex),
    ...(widthPt !== undefined ? { widthPt } : {}),
    ...(dash !== undefined ? { dash } : {}),
  };
}

const REASONS: Partial<Record<TreeOpRejection, string>> = {
  'invalid-drawing-value': 'the fill or outline value is out of range',
  'unsupported-property': 'a legacy shape has no transparency',
  'no-solid-fill': 'the shape has no solid fill to change; set a color',
  'not-a-shape-drawing': 'this drawing has no fill or outline to set',
  'unknown-drawing': 'stale drawing selection',
};

function refusalOf(reason: TreeOpRejection | string): Refusal {
  const known = REASONS[reason as TreeOpRejection];
  return {
    ok: false,
    code: reason === 'not-a-shape-drawing' ? 'unsupported' : 'invalidArgs',
    reason: known ?? reason,
  };
}

/** The op a shape format command writes, or why it is refused. */
function planCommand(command: ShapeFormatCommand, surface: PaginatedSurface | null) {
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' } as const;
  const protectedWrite = commandProtectionRefusal(command, surface);
  if (protectedWrite) return protectedWrite;
  const selected = selectedImageStateOf(surface);
  if (!selected) return { ok: false, code: 'notFound', reason: 'no drawing is selected' } as const;
  if (command.drawingNodeId !== undefined && command.drawingNodeId !== selected.id)
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' } as const;
  if (!selected.shapeFormat) return refusalOf('not-a-shape-drawing');
  let op: SetShapeFormatOp;
  const themeHex: ThemeHex = (theme) =>
    themeHexOf(
      theme,
      createPackageShapeThemeResolvers(surface.session.currentPackage()).resolveSchemeColor
    );
  if (command.type === 'setShapeFill') {
    const fill = fillOf(command, themeHex);
    if (fill && 'ok' in fill) return fill;
    op = { op: 'setShapeFormat', drawingNodeId: selected.id, fill };
  } else {
    op = {
      op: 'setShapeFormat',
      drawingNodeId: selected.id,
      outline: outlineOf(command, themeHex),
    };
  }
  // A shape selected inside the group takes the edit alone.
  if (selected.memberId) op = { ...op, shapeNodeId: selected.memberId };
  const part = partOfNodeId(surface.session, selected.id) ?? surface.session.part();
  const rejection = validateShapeFormat(part, op);
  return rejection ? refusalOf(rejection) : op;
}

/** The refusal `can` reports for a shape format command, or null when it applies. */
export function gateShapeFormatCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null
): Refusal | null {
  if (!isShapeFormatCommand(command)) return null;
  const planned = planCommand(command, surface);
  return 'ok' in planned ? planned : null;
}

/** Apply a shape format command as one undo step; null when it committed. */
export function execShapeFormatCommand(
  surface: PaginatedSurface,
  command: ShapeFormatCommand
): ExecResult | null {
  const planned = planCommand(command, surface);
  if ('ok' in planned) return planned;
  const result = surface.applyDrawingOps([planned]);
  if (result.rejected)
    return refusalOf(typeof result.reason === 'string' ? result.reason : 'the change was refused');
  return null;
}
