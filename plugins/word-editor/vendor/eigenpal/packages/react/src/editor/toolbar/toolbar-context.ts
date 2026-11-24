// Toolbar-scoped context: the translate function the root publishes to its parts.
//
// The adapter ships NO hardcoded user-facing English (repo i18n rule): every label is
// an i18n key from the chrome registry, resolved through the host's `t` when one is
// provided and otherwise through the active `LocaleContext` catalogue — matching
// `<DocxEditor>`'s own default, so a bare `DocxEditor.Toolbar` is legible and
// `LocaleProvider` localizes composed chrome exactly like the packaged entry point.

import { createContext, useContext } from 'react';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';

/** Resolves an i18n key to display text. @public */
export type ToolbarTranslate = (key: string) => string;

export interface ToolbarContextValue {
  readonly t: ToolbarTranslate | undefined;
  /** Host save handler for the `file.save` part; absent renders the part disabled. */
  readonly onSave: (() => void) | undefined;
}

export const ToolbarContext = createContext<ToolbarContextValue>({
  t: undefined,
  onSave: undefined,
});

/** The toolbar root's published value. Internal: parts read it, hosts pass props. */
export function useToolbarContext(): ToolbarContextValue {
  return useContext(ToolbarContext);
}

/**
 * The label for an i18n key given a host resolver: the host's translation, else the
 * locale catalogue. The toolbar ROOT needs this before it publishes its context, so the
 * resolver is separate from the context read below — a raw key must never reach the DOM.
 */
export function useToolbarLabelFor(t: ToolbarTranslate | undefined): (key: string) => string {
  const { t: catalogT } = useTranslation();
  return (key: string) => t?.(key) ?? catalogT(key as TranslationKey);
}

/** The label for an i18n key: the host's translation, else the locale catalogue. */
export function useToolbarLabel(): (key: string) => string {
  const { t } = useContext(ToolbarContext);
  return useToolbarLabelFor(t);
}
