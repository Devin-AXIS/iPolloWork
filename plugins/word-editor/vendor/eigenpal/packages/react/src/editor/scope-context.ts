// Who is responsible for putting `.docx-editor` on the DOM.
//
// `.docx-editor` is the Tailwind scope (see the `important` strategy in
// packages/core/tailwind.dist.config.cjs) AND the carrier of the `--doc-*`
// tokens, so every chrome part needs it on an ancestor or it renders unstyled.
// `DocxEditor.Root` is container-less — it renders providers and no element —
// so in the composition path there IS no ancestor, and each part has to scope
// itself.
//
// The packaged `<DocxEditor>` host is the other case: it renders a real
// wrapper that already carries the class. A part adding it again there is
// redundant, and not harmlessly so — it puts `.docx-editor` on four more
// elements, so ordinary consumer CSS like
//
//   .my-shell .docx-editor { height: 100% }
//
// silently lands on the toolbar and the menu bar as well as the root. That is
// the single most natural rule a host writes (the docs tell them to give the
// editor a box with a real height), and it made the toolbar as tall as the
// editor while the page area collapsed to nothing.
//
// So the wrapper announces itself, and parts inside it skip the class. Hosts
// composing from `Root` see no change: default `false`, every part self-scopes.

import { createContext, useContext } from 'react';

/** True when an ancestor element already carries `.docx-editor`. */
export const ScopedByAncestorContext = createContext(false);

/** True when the enclosing `Root` resolved a dark chrome. */
export const ChromeDarkContext = createContext(false);

/**
 * The scope class a chrome part should add to its own root element: the class
 * when nothing above it is scoped, an empty string when something already is.
 *
 * ```tsx
 * const scope = useScopeClassName();
 * <div className={`${scope}docx-toolbar`} />
 * ```
 *
 * Under a `Root` whose `colorMode` resolved dark, the class is `'docx-editor dark '`, so a part
 * you build with the editor's `--doc-*` tokens follows the editor theme.
 *
 * Returns a trailing space so it concatenates cleanly, and `''` collapses away.
 */
export function useScopeClassName(): '' | 'docx-editor ' | 'docx-editor dark ' {
  const scoped = useContext(ScopedByAncestorContext);
  const dark = useContext(ChromeDarkContext);
  if (scoped) return '';
  return dark ? 'docx-editor dark ' : 'docx-editor ';
}
