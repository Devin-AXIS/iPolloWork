import type { DocxEditorChildren } from '../docx-editor-children';
import type { ReactNode } from 'react';
// The default-set + in-place-override merge, once.
//
// The toolbar, the menu bar and the context menu all offer the same contract: with no
// children you get the packaged arrangement, a child that NAMES a member of it replaces
// that member where it stands, `hidden` removes it, anything else appends, and
// `preset={false}` opts out entirely. Each of them had grown its own copy of the algorithm,
// with the same comments word-for-word — and the copies had already diverged in a way that
// bit: the context menu's forgot to unwrap Fragments, so a host mapping over its overrides
// got a SECOND copy of the row it was trying to replace instead of an override.
//
// Keeping the identification separate from the merge is what lets the three share this:
// each surface still decides what counts as a key (a `ChromeSlotId`, a menu row id, a
// context-menu row id) and how to render a default; only the merge is common.

import { Children, Fragment, isValidElement } from 'react';
import type { ReactElement } from 'react';

/**
 * The key a child element overrides, or null when it is the host's own content.
 *
 * Implementations MUST unwrap a single-child Fragment: `Children.toArray` does not flatten
 * Fragment ELEMENTS, so `<>{override}</>` reaches here as a symbol-typed element and every
 * naive check falls through — which a host hits the moment it maps over its overrides.
 * {@link unwrapFragment} does that part for them.
 */
export type KeyOfChild = (child: ReactNode) => string | null;

/**
 * Resolve a child through a single-child Fragment, if that is what it is.
 *
 * Returns the key of the ONE keyed child inside, or null for a Fragment holding zero or
 * several — a Fragment wrapping two rows names no single row, so it appends as content
 * rather than silently overriding one of them.
 */
export function unwrapFragment(child: ReactNode, keyOf: KeyOfChild): string | null {
  if (!isValidElement(child) || child.type !== Fragment) return null;
  const inner = Children.toArray((child.props as { children?: DocxEditorChildren }).children);
  const keys = inner.map(keyOf).filter((key): key is string => key !== null);
  return keys.length === 1 ? keys[0]! : null;
}

export interface MergeArrangementInput<Entry> {
  /** The packaged arrangement, in order. */
  readonly entries: readonly Entry[];
  readonly children: ReactNode;
  /** `false` renders children verbatim: when the ORDER is the point, stating it is clearer. */
  readonly preset: boolean;
  /** The key an entry answers to, matched against {@link keyOfChild}. */
  readonly keyOfEntry: (entry: Entry, index: number) => string;
  readonly keyOfChild: KeyOfChild;
  /** Render one packaged entry, for the positions no child overrode. */
  readonly renderEntry: (entry: Entry, index: number, children?: ReactNode) => DocxEditorChildren;
  /** Nested registry entries use the same slot overrides as their parent panel. */
  readonly childrenOfEntry?: (entry: Entry) => readonly Entry[] | undefined;
  /** Told of each keyed child that names no entry; it still renders after the default set. */
  readonly onUnmatched?: (key: string, element: ReactElement) => void;
}

/**
 * Merge host children into a packaged arrangement.
 *
 * Children that match an entry replace it IN PLACE. Children that match nothing are the
 * host's own and are kept, in the order given, after the default set — dropping them would
 * swallow a row silently. Matched children are collected in a Map, so two children naming
 * the same entry collapse to the last one, which is what makes a `hidden` override remove
 * the packaged member rather than render a second invisible copy beside it.
 */
export function mergeArrangement<Entry>({
  entries,
  children,
  preset,
  keyOfEntry,
  keyOfChild,
  renderEntry,
  childrenOfEntry,
  onUnmatched,
}: MergeArrangementInput<Entry>): ReactNode {
  if (!preset) return children;
  const overrides = new Map<string, ReactElement>();
  const appended: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    const key = keyOfChild(child);
    // Last override for a key wins, matching how later props win in a spread.
    if (key) overrides.set(key, child as ReactElement);
    else appended.push(child);
  }
  const known = new Set<string>();
  const renderEntries = (items: readonly Entry[]): ReactNode =>
    items.map((entry, index) => {
      const key = keyOfEntry(entry, index);
      known.add(key);
      const nested = childrenOfEntry?.(entry);
      const content = nested ? renderEntries(nested) : undefined;
      const override = overrides.get(key);
      return <Fragment key={key}>{override ?? renderEntry(entry, index, content)}</Fragment>;
    });
  const base = renderEntries(entries);
  const unmatched = [...overrides.entries()]
    .filter(([key]) => !known.has(key))
    .map(([key, element]) => {
      onUnmatched?.(key, element);
      return <Fragment key={key}>{element}</Fragment>;
    });
  return (
    <>
      {base}
      {unmatched}
      {appended}
    </>
  );
}
