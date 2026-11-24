// The chrome color mode a `DocxEditor.Root` declares, for the parts that scope themselves.
//
// The dark palette is scoped to `.docx-editor.dark`. `Root` renders no element, so in the
// composition path each part puts `.docx-editor` on its own root element (see
// `scope-context.ts`). Those same parts add `dark` beside it when `Root` resolved a dark
// mode, so a composed toolbar, menu bar, or viewport themes like the packaged editor.
// The resolution rules live in `lib/colorMode.ts`, shared with `<DocxEditor>`.

import { useContext, useSyncExternalStore } from 'react';
import {
  prefersColorSchemeDark,
  resolveIsDark,
  subscribeSystemDark,
  type ColorMode,
} from '../lib/colorMode';
import { ChromeDarkContext, ScopedByAncestorContext } from './scope-context';

export { ChromeDarkContext };

/**
 * Whether a color mode is dark right now. `'system'` follows the OS setting and updates
 * when it changes; `undefined` is light.
 */
export function useResolvedDark(colorMode: ColorMode | undefined): boolean {
  const following = colorMode === 'system';
  // The OS setting as an external store: read on the client, light on the server, so a
  // server-rendered tree hydrates without a mismatch and corrects itself right after.
  const systemDark = useSyncExternalStore(
    following ? subscribeToSystemDark : subscribeToNothing,
    following ? prefersColorSchemeDark : lightSnapshot,
    lightSnapshot
  );
  return resolveIsDark(colorMode ?? 'light', systemDark);
}

function subscribeToSystemDark(onChange: () => void): () => void {
  return subscribeSystemDark(() => onChange());
}

function subscribeToNothing(): () => void {
  return () => {};
}

function lightSnapshot(): boolean {
  return false;
}

/** True when the enclosing `Root` resolved a dark chrome. */
export function useChromeDark(): boolean {
  return useContext(ChromeDarkContext);
}

/**
 * The scope classes a self-scoping chrome part adds to its root element: `docx-editor`, and
 * `dark` with it under a dark `Root`, or nothing when an ancestor already carries the scope.
 * Ends with a space so it concatenates cleanly.
 */
export function useChromeScopeClassName(): '' | 'docx-editor ' | 'docx-editor dark ' {
  const scoped = useContext(ScopedByAncestorContext);
  const dark = useContext(ChromeDarkContext);
  if (scoped) return '';
  return dark ? 'docx-editor dark ' : 'docx-editor ';
}

/**
 * The theme the enclosing editor resolved from `colorMode`, never `'system'`, as {@link useEditorColorMode} reports it.
 *
 * @public
 */
export type ResolvedColorMode = 'light' | 'dark';

/**
 * What {@link useEditorColorMode} returns.
 *
 * @public
 */
export interface UseEditorColorModeReturn {
  /** The resolved theme: `'dark'` or `'light'`. Re-renders when `colorMode` or the OS setting changes. */
  readonly colorMode: ResolvedColorMode;
}

/**
 * The theme the enclosing `DocxEditor.Root` resolved from its `colorMode`, so parts you build
 * yourself can match the editor chrome. `'system'` resolves to the operating system's current
 * setting and re-renders when it changes. Outside a `Root`, or without `colorMode`, the answer
 * is `'light'`.
 *
 * @example
 * ```tsx
 * function MyPanel() {
 *   const { colorMode } = useEditorColorMode();
 *   return <aside className={colorMode === 'dark' ? 'panel panel--dark' : 'panel'} />;
 * }
 * ```
 *
 * @public
 */
export function useEditorColorMode(): UseEditorColorModeReturn {
  return useContext(ChromeDarkContext) ? DARK : LIGHT;
}

// One object per theme, so the answer keeps its identity until the theme changes.
const LIGHT: UseEditorColorModeReturn = Object.freeze({ colorMode: 'light' });
const DARK: UseEditorColorModeReturn = Object.freeze({ colorMode: 'dark' });
