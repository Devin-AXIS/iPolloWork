import {
  buildDomEditStylePatchOperation,
  buildDomEditTextPatchOperation,
  buildTextFieldChildLocator,
  type DomEditTextField,
} from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";

/** Apply the same child patches as persistence, keeping live animation targets. */
export function applyTextFieldChildOperations(
  parent: HTMLElement,
  operations: PatchOperation[],
): () => void {
  const restores: Array<() => void> = [];
  for (const op of operations) {
    if (!op.childSelector) continue;
    const target = parent.querySelectorAll<HTMLElement>(op.childSelector)[op.childIndex ?? 0];
    if (!target) continue;
    if (op.type === "text-content" && op.value !== null) {
      const previous = target.textContent;
      restores.push(() => {
        target.textContent = previous;
      });
      target.textContent = op.value;
    } else if (op.type === "inline-style") {
      const previous = target.style.getPropertyValue(op.property);
      restores.push(() => {
        target.style.setProperty(op.property, previous);
      });
      if (op.value === null) target.style.removeProperty(op.property);
      else target.style.setProperty(op.property, op.value);
    }
  }
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

function hasSameKeysInSamePositions(
  originalFields: DomEditTextField[],
  nextFields: DomEditTextField[],
): boolean {
  return originalFields.every((field, index) => nextFields[index]?.key === field.key);
}

function inlineStyleValue(styles: Record<string, string>, property: string): string | null {
  return Object.prototype.hasOwnProperty.call(styles, property) ? styles[property] : null;
}

function inlineStyleProperties(
  originalStyles: Record<string, string>,
  nextStyles: Record<string, string>,
): string[] {
  return Array.from(new Set([...Object.keys(originalStyles), ...Object.keys(nextStyles)]));
}

// fallow-ignore-next-line complexity
export function buildTextFieldChildOperations(
  originalFields: DomEditTextField[],
  nextFields: DomEditTextField[],
  editedFieldKey?: string,
): PatchOperation[] | null {
  if (originalFields.length !== nextFields.length) return null;
  if (!hasSameKeysInSamePositions(originalFields, nextFields)) return null;
  if (nextFields.some((field) => field.source === "text-node")) return null;
  if (nextFields.some((field) => field.source !== "child")) return null;
  if (originalFields.some((field) => field.source !== "child")) return null;

  const originalByKey = new Map(originalFields.map((field) => [field.key, field]));
  const operations: PatchOperation[] = [];

  for (const nextField of nextFields) {
    const originalField = originalByKey.get(nextField.key);
    const locator = buildTextFieldChildLocator(originalFields, nextField.key);
    if (!originalField || !locator) return null;

    if (nextField.value !== originalField.value || nextField.key === editedFieldKey) {
      operations.push(buildDomEditTextPatchOperation(nextField.value, locator));
    }

    for (const property of inlineStyleProperties(
      originalField.inlineStyles,
      nextField.inlineStyles,
    )) {
      const originalValue = inlineStyleValue(originalField.inlineStyles, property);
      const nextValue = inlineStyleValue(nextField.inlineStyles, property);
      if (nextValue !== originalValue) {
        operations.push(buildDomEditStylePatchOperation(property, nextValue, locator));
      }
    }
  }

  return operations;
}
