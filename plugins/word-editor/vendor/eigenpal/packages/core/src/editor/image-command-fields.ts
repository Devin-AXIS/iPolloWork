import type { EditorCommand } from '../contracts/editor.ts';
import { propertiesCommandHasPositionFields } from '../store/package/drawing-position-input.ts';

export function hasBorderPayload(
  command: Extract<EditorCommand, { type: 'setImageProperties' }>
): boolean {
  return command.borderWidthEmu !== undefined || command.borderColor !== undefined;
}

export function positionCommandHasFields(
  command: Extract<EditorCommand, { type: 'setImagePosition' }>
): boolean {
  return (
    command.horizontalEmu !== undefined ||
    command.verticalEmu !== undefined ||
    command.relativeToH !== undefined ||
    command.relativeToV !== undefined
  );
}

export function propertiesCommandHasFields(
  command: Extract<EditorCommand, { type: 'setImageProperties' }>
): boolean {
  return (
    command.widthEmu !== undefined ||
    command.heightEmu !== undefined ||
    command.alt !== undefined ||
    command.title !== undefined ||
    command.description !== undefined ||
    command.hyperlink !== undefined ||
    command.crop !== undefined ||
    command.wrap !== undefined ||
    command.resetToNaturalSize === true ||
    propertiesCommandHasPositionFields(command)
  );
}
