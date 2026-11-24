// `ContextMenu.Start`: host rows placed above the packaged rows.
//
// The menu hoists Start by reading its children, so only a Start it can SEE moves: a direct
// child, or one inside Fragments. A Start that a host component returns is invisible to that
// read and renders where the component sits, after the default rows. The menu says which
// region each child renders in through `StartPlacementContext`, so such a Start can warn in
// development instead of landing at the bottom silently.

import { Children, Fragment, cloneElement, createContext, isValidElement, useContext } from 'react';
import type { ReactNode } from 'react';
import { isDevelopment } from '../../lib/is-development';
import { MenuSeparator } from '../menu/parts';
import type { ContextMenuStartProps } from './parts';
import { warnPackagedRowInStart, warnStartNotDirectChild } from '../menu/menu-warnings';

/**
 * Where the menu renders a child: hoisted above the default rows, appended after them, or
 * verbatim in written order (`preset={false}`). Null outside a context menu.
 */
type StartPlacement = 'hoisted' | 'appended' | 'verbatim' | null;

export const StartPlacementContext = createContext<StartPlacement>(null);

/**
 * Host rows that render above the packaged rows instead of after them.
 *
 * Use it for rows about the item under the pointer, such as spelling suggestions for the
 * word that was right-clicked. Read that item with `useContextMenuTarget()`. A menu opened
 * from the keyboard has no target: `useContextMenuAnchor()` reports `trigger: 'keyboard'`,
 * and `editor.getSelectionRange()` reads the caret instead. It must be a direct child of
 * `DocxEditor.ContextMenu`; a component that returns it renders at the end.
 *
 * @public
 */
export function ContextMenuStart({ children }: ContextMenuStartProps) {
  if (useContext(StartPlacementContext) === 'appended') warnStartNotDirectChild();
  return (
    <>
      {children}
      <MenuSeparator />
    </>
  );
}
ContextMenuStart.docxRowPlacement = 'start' as const;

/**
 * Whether a child asked to render ABOVE the default set.
 *
 * `ContextMenu.Start`, or any component carrying `docxRowPlacement: 'start'` (a static, like
 * `docxRow`), renders before the packaged rows instead of after them: "you right-clicked one
 * of MINE" belongs at the top, where the pointer is.
 */
export function startPlacedChild(child: ReactNode): boolean {
  if (!isValidElement(child)) return false;
  const type = child.type as { docxRowPlacement?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return false;
  return type.docxRowPlacement === 'start';
}

function fragmentChildren(child: ReactNode): ReactNode[] | null {
  if (!isValidElement(child) || child.type !== Fragment) return null;
  return Children.toArray((child.props as { children?: ReactNode }).children);
}

function holdsStart(child: ReactNode): boolean {
  if (startPlacedChild(child)) return true;
  return fragmentChildren(child)?.some(holdsStart) ?? false;
}

/**
 * Split the menu's children into the rows placed above the default set and the rest.
 *
 * Fragments that hold a Start are opened at any depth, so each Start moves up and each other
 * row stays below. Fragments without one stay whole, because a Fragment can be one keyed
 * override of a packaged row.
 */
export function partitionStartRows(children: ReactNode): {
  readonly start: ReactNode[];
  readonly rest: ReactNode[];
} {
  const start: ReactNode[] = [];
  const rest: ReactNode[] = [];
  // `Children.toArray` keys each level from `.0`, so a row taken out of a Fragment gets the
  // Fragment's key as a prefix, or two levels would hand React the same key.
  const visit = (nodes: ReactNode[], prefix: string) => {
    for (const node of nodes) {
      const child =
        prefix && isValidElement(node) ? cloneElement(node, { key: `${prefix}${node.key}` }) : node;
      if (startPlacedChild(child)) start.push(child);
      else if (holdsStart(child) && isValidElement(child)) {
        visit(fragmentChildren(child) ?? [], `${String(child.key)}/`);
      } else rest.push(child);
    }
  };
  visit(Children.toArray(children), '');
  return { start, rest };
}

/** Warn about packaged rows inside `Start`, which render again in their default place. */
export function warnPackagedRowsIn(
  startRows: readonly ReactNode[],
  rowOfChild: (child: ReactNode) => string | null
): void {
  if (!isDevelopment()) return;
  for (const start of startRows) {
    if (!isValidElement(start)) continue;
    const { start: nested, rest } = partitionStartRows(
      (start.props as { children?: ReactNode }).children
    );
    warnPackagedRowsIn(nested, rowOfChild);
    for (const inner of rest) {
      const id = rowOfChild(inner);
      if (id !== null) warnPackagedRowInStart(id);
    }
  }
}
