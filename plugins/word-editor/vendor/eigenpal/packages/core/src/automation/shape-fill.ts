// `Shape.fill` as Office.js spells it: a type, a `#RRGGBB` foreground colour and a transparency,
// read from what the shapes paint and written as one `setShapeFormat` op.
//
// INTERNAL. A shape outline has no member on Office.js `Shape`, so it is not here; the editor
// command `setShapeOutline` writes it.

import type { ShapeFillState } from '../store/package/shape-format.ts';
import type { ShapeFillInput } from '../store/store/tree-op-types.ts';
import { shapeColorHex } from '../store/package/shape-format.ts';

/** `Word.ShapeFillType`, as a read answers it. */
export type AutomationShapeFillType =
  'Solid' | 'NoFill' | 'Gradient' | 'Pattern' | 'Picture' | 'Mixed';

/** What a `ShapeFill` read answers. */
export interface AutomationShapeFillRead {
  readonly type: AutomationShapeFillType;
  /** `#RRGGBB` of a solid fill; empty for any other type. */
  readonly foregroundColor: string;
  /** From 0 (opaque) to 1 (clear); 0 for anything but a solid fill. */
  readonly transparency: number;
}

/** A `ShapeFill` write: `clear()`, or a solid colour and transparency. */
export type AutomationShapeFillWrite =
  { readonly clear: true } | { readonly color?: string; readonly transparency?: number };

const TYPES: Readonly<Record<ShapeFillState['type'], AutomationShapeFillType>> = {
  solid: 'Solid',
  none: 'NoFill',
  gradient: 'Gradient',
  pattern: 'Pattern',
  picture: 'Picture',
  mixed: 'Mixed',
};

export function shapeFillRead(fill: ShapeFillState): AutomationShapeFillRead {
  return {
    type: TYPES[fill.type],
    foregroundColor: fill.color ? `#${fill.color}` : '',
    transparency: fill.transparency,
  };
}

/** The op input a write asks for, or why the write is refused. */
export function shapeFillInput(
  write: AutomationShapeFillWrite
): ShapeFillInput | { readonly refused: string } {
  if (!write || typeof write !== 'object') return { refused: 'fill: expected a fill write' };
  if ('clear' in write) {
    return write.clear === true ? { type: 'none' } : { refused: 'clear: expected true' };
  }
  const { color, transparency } = write;
  if (color === undefined && transparency === undefined)
    return { refused: 'fill: set a color or a transparency' };
  const hex = color === undefined ? undefined : shapeColorHex(color);
  if (hex === null) return { refused: 'color: expected #RRGGBB, RRGGBB or a CSS color name' };
  if (
    transparency !== undefined &&
    (typeof transparency !== 'number' || !(transparency >= 0 && transparency <= 1))
  )
    return { refused: 'transparency: expected a number from 0 to 1' };
  return {
    type: 'solid',
    ...(hex !== undefined ? { color: hex } : {}),
    ...(transparency !== undefined ? { transparency } : {}),
  };
}
