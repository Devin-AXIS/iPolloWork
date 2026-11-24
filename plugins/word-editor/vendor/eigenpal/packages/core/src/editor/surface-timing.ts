/**
 * Which surface work the performance diagnostics time: the presses a person makes and the
 * layouts an edit causes, never modifier keys alone or the layouts that loading causes.
 */

/** Presses of these keys alone change nothing on the page, so they are not timed. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  ...['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Hyper', 'Super', 'Symbol'],
  ...['Fn', 'FnLock', 'CapsLock', 'NumLock', 'ScrollLock', 'SymbolLock'],
]);

/** Layouts that loading causes, not the person: untimed unless an edit joined the batch. */
const LOADING_LAYOUTS = ['opening', 'fonts', 'drawing-resources'] as const;

/** Whether a key or pointer press counts as a press a person waits on. */
export function timedPress(event: Event): boolean {
  return !MODIFIER_KEYS.has((event as KeyboardEvent).key);
}

/** Whether a layout pass counts: one an edit joined, or one that loading did not cause. */
export function timedLayout(scope: {
  readonly paragraphIds: { readonly size: number };
  readonly dependencyKeys: { has(key: string): boolean };
}): boolean {
  return (
    scope.paragraphIds.size > 0 ||
    !LOADING_LAYOUTS.some((reason) => scope.dependencyKeys.has(reason))
  );
}
