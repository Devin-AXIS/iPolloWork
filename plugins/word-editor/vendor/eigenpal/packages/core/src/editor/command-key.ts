import type { EditorCommand } from '../contracts/editor.ts';

function orderedJsonValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(orderedJsonValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, orderedJsonValue((value as Record<string, unknown>)[key])])
  );
}

/**
 * Stable value identity for a command, including nested payloads.
 *
 * @internal
 */
export function editorCommandKey(command: EditorCommand): string {
  return JSON.stringify(orderedJsonValue(command));
}
