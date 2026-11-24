// Reads the preset toolbar's children into what the root arranges: slot overrides, group
// descriptions (`Toolbar.Group`), and loose children, which keep their old fixed block.

import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { DocxEditorToolbarGroupProps } from './ToolbarGroup';

/** The parts of the preset toolbar's children, by role. */
export interface ToolbarChildren<Key extends string> {
  /** Slot overrides of the default arrangement. The last override for a slot wins. */
  readonly overrides: Map<Key, ReactElement>;
  /** Slot overrides of the contextual table chrome. */
  readonly tableOverrides: Map<Key, ReactElement>;
  /** `Toolbar.Group` descriptions in order of appearance. The last one for an id wins. */
  readonly groups: readonly DocxEditorToolbarGroupProps[];
  /** Everything else, rendered in one fixed block after the groups. */
  readonly appended: readonly ReactNode[];
}

/** True for a `Toolbar.Group` element. */
export function isToolbarGroupElement(
  child: ReactNode
): child is ReactElement<DocxEditorToolbarGroupProps> {
  if (!isValidElement(child)) return false;
  const type = child.type as { docxToolbarGroup?: unknown };
  return (typeof type === 'function' || typeof type === 'object') && type.docxToolbarGroup === true;
}

export function readToolbarChildren<Key extends string>(
  children: DocxEditorChildren,
  slotOfChild: (child: ReactNode) => Key | null,
  isDefaultSlot: (slot: Key) => boolean,
  isTableSlot: (slot: Key) => boolean
): ToolbarChildren<Key> {
  const overrides = new Map<Key, ReactElement>();
  const tableOverrides = new Map<Key, ReactElement>();
  const groups = new Map<string, DocxEditorToolbarGroupProps>();
  const appended: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (isToolbarGroupElement(child)) {
      // Re-inserted so the LAST description's position is its order of appearance.
      groups.delete(child.props.id);
      groups.set(child.props.id, child.props);
      continue;
    }
    const slot = slotOfChild(child);
    // Last override for a slot wins, matching how later props win in a spread.
    if (slot && isDefaultSlot(slot)) overrides.set(slot, child as ReactElement);
    else if (slot && isTableSlot(slot)) tableOverrides.set(slot, child as ReactElement);
    // Hiding a slot the bar does not draw leaves nothing, not an empty appended block.
    else if (slot && isValidElement(child) && (child.props as { hidden?: unknown }).hidden === true)
      continue;
    else appended.push(child);
  }
  return { overrides, tableOverrides, groups: [...groups.values()], appended };
}
