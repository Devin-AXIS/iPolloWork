// Shared validation for {@link DrawingPositionInput} — command, tree-op, and read paths.

import type { DrawingPositionInput } from './drawing-projection.ts';
import {
  REL_FROM_H_VALUES,
  REL_FROM_V_VALUES,
  ST_COORDINATE_MAX,
  ST_COORDINATE_MIN,
  ST_POSITION_OFFSET_MAX,
  ST_POSITION_OFFSET_MIN,
} from './ooxml-drawing-rules.ts';

export function validateDrawingPositionOffset(value: number | undefined): boolean {
  if (value === undefined) return true;
  if (!Number.isFinite(value) || !Number.isInteger(value)) return false;
  return value >= ST_POSITION_OFFSET_MIN && value <= ST_POSITION_OFFSET_MAX;
}

export function validateDrawingSimpleCoordinate(value: number | undefined): boolean {
  if (value === undefined) return true;
  if (!Number.isFinite(value) || !Number.isInteger(value)) return false;
  return value >= ST_COORDINATE_MIN && value <= ST_COORDINATE_MAX;
}

/** Validate a position input, refusing offsets or bases outside what OOXML allows. */
export function validateDrawingPositionInput(position: DrawingPositionInput): boolean {
  const mode = position.mode ?? 'frame';
  if (mode === 'simple') {
    return (
      validateDrawingSimpleCoordinate(position.horizontalEmu) &&
      validateDrawingSimpleCoordinate(position.verticalEmu)
    );
  }
  if (position.relativeToH !== undefined && !REL_FROM_H_VALUES.has(position.relativeToH)) {
    return false;
  }
  if (position.relativeToV !== undefined && !REL_FROM_V_VALUES.has(position.relativeToV)) {
    return false;
  }
  return (
    validateDrawingPositionOffset(position.horizontalEmu) &&
    validateDrawingPositionOffset(position.verticalEmu)
  );
}

/** Legal `relativeFrom` bases for a horizontal offset (page, margin, column, character, …). */
export const DRAWING_REL_FROM_H = Object.freeze([...REL_FROM_H_VALUES] as const);
/** Legal `relativeFrom` bases for a vertical offset (page, margin, paragraph, line, …). */
export const DRAWING_REL_FROM_V = Object.freeze([...REL_FROM_V_VALUES] as const);

/** Whether an image-properties command carries any positioning fields at all. */
export function propertiesCommandHasPositionFields(command: {
  readonly horizontalEmu?: number;
  readonly verticalEmu?: number;
  readonly relativeToH?: string;
  readonly relativeToV?: string;
}): boolean {
  return (
    command.horizontalEmu !== undefined ||
    command.verticalEmu !== undefined ||
    command.relativeToH !== undefined ||
    command.relativeToV !== undefined
  );
}

/** Extract the position input from an image-properties command, or null when it carries none. */
export function positionInputFromPropertiesCommand(
  command: {
    readonly horizontalEmu?: number;
    readonly verticalEmu?: number;
    readonly relativeToH?: string;
    readonly relativeToV?: string;
  },
  selected: { readonly position?: DrawingPositionInput | null } | null
): DrawingPositionInput {
  if (selected?.position?.mode === 'simple') {
    return Object.freeze({
      mode: 'simple' as const,
      ...(command.horizontalEmu !== undefined ? { horizontalEmu: command.horizontalEmu } : {}),
      ...(command.verticalEmu !== undefined ? { verticalEmu: command.verticalEmu } : {}),
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(command.horizontalEmu !== undefined ? { horizontalEmu: command.horizontalEmu } : {}),
    ...(command.verticalEmu !== undefined ? { verticalEmu: command.verticalEmu } : {}),
    ...(command.relativeToH !== undefined
      ? { relativeToH: command.relativeToH as DrawingPositionInput['relativeToH'] }
      : {}),
    ...(command.relativeToV !== undefined
      ? { relativeToV: command.relativeToV as DrawingPositionInput['relativeToV'] }
      : {}),
  });
}

/** Validate a set-position command before it reaches the store. */
export function validateSetImagePositionCommand(
  command: {
    readonly horizontalEmu?: number;
    readonly verticalEmu?: number;
    readonly relativeToH?: string;
    readonly relativeToV?: string;
  },
  mode: 'frame' | 'simple'
): boolean {
  if (command.relativeToH !== undefined && !REL_FROM_H_VALUES.has(command.relativeToH)) {
    return false;
  }
  if (command.relativeToV !== undefined && !REL_FROM_V_VALUES.has(command.relativeToV)) {
    return false;
  }
  const offsetCheck =
    mode === 'simple' ? validateDrawingSimpleCoordinate : validateDrawingPositionOffset;
  return offsetCheck(command.horizontalEmu) && offsetCheck(command.verticalEmu);
}
