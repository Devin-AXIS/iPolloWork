// Host-owned groups and slot replacements for the preset toolbar.
//
// The preset bar collapses whole GROUPS into the "⋯" panel when it runs out of width. A
// loose host child has no group, so it used to sit in one fixed block that never collapsed.
// `Toolbar.Group` gives host content the same standing as a built-in group: it is measured,
// it takes a place in the collapse order, and when it collapses it becomes a labeled section
// of the panel. The same part, given a BUILT-IN group id, adds the host's controls to that
// group, or removes the group with `hidden`.
//
// `Toolbar.Slot` replaces one built-in slot with arbitrary content. The root recognizes it by
// its own marker and reads its `slotId`, so it keeps the slot's position and collapse
// behavior.
//
// Both parts are DESCRIPTIONS under the preset: the root reads their props and renders the
// content itself. They render on their own only under `preset={false}`.

import { createContext, useContext } from 'react';
import type { ChromeGroupId, ChromeSlotId } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useToolbarLabel } from './toolbar-context';

/** Props for `DocxEditor.Toolbar.Group`. @public */
export interface DocxEditorToolbarGroupProps {
  /**
   * The group id. A built-in id (`'history'`, `'font'`, `'text'`, `'review'`, ...) adds the
   * children to that group, after its own controls. Any other id makes a host group.
   */
  id: ChromeGroupId | (string & {});
  /**
   * Catalog key for the host group's "⋯" panel heading and accessible name. It goes through
   * the toolbar's `t` and the locale catalog. Built-in groups keep their own label.
   */
  labelKey?: string;
  /**
   * Literal heading and accessible name for a host group. It wins over `labelKey`. Without
   * either, the heading is `id`. Built-in groups keep their own label.
   */
  label?: string;
  /**
   * Collapse priority. A lower number leaves the bar first. Built-in groups use 10 (zoom)
   * through 90 (history) in steps of 10. A host group without a priority collapses before
   * every built-in group.
   */
  priority?: number;
  /** `true` keeps the group in the bar at every width, like the review group. */
  pinned?: boolean;
  /**
   * The group this one follows in the bar. Without it, a host group follows every built-in
   * group, in order of appearance. Ignored for built-in ids.
   */
  after?: ChromeGroupId | (string & {});
  /** Removes the group, built-in or host, from the bar and the "⋯" panel. */
  hidden?: boolean;
  /**
   * Content for the group's "⋯" panel section, rendered after a built-in group's own rows.
   * It renders even when the group has no children, so a built-in id can add a panel-only
   * row. Without it, the panel renders the children in panel rows: actions and buttons
   * become labeled rows, and other content renders as is.
   */
  overflowContent?: () => DocxEditorChildren;
  className?: string;
  children?: DocxEditorChildren;
}

/** A host group's heading: the literal label, else the translated key, else the id. */
export function hostGroupText(
  spec: Pick<DocxEditorToolbarGroupProps, 'id' | 'label' | 'labelKey'>,
  translate: (key: string) => string
): string {
  if (spec.label !== undefined) return spec.label;
  return spec.labelKey !== undefined ? translate(spec.labelKey) : spec.id;
}

/**
 * A group of the preset toolbar: measured, collapsed in priority order, and shown as a
 * labeled section of the "⋯" panel when it does not fit.
 *
 * @example
 * ```tsx
 * <DocxEditor.Toolbar>
 *   <DocxEditor.Toolbar.Group id="review-nav" label="Review" priority={15}>
 *     <DocxEditor.Toolbar.Action label="Next change" icon={<NextIcon />} onSelect={next} />
 *   </DocxEditor.Toolbar.Group>
 *   <DocxEditor.Toolbar.Group id="zoom" hidden />
 * </DocxEditor.Toolbar>
 * ```
 *
 * @public
 */
export function ToolbarHostGroup(props: DocxEditorToolbarGroupProps) {
  const label = useToolbarLabel();
  if (props.hidden) return null;
  return (
    <div
      role="group"
      aria-label={hostGroupText(props, label)}
      className={`docx-toolbar__group${props.className ? ` ${props.className}` : ''}`}
      data-toolbar-host-group={props.id}
    >
      {props.children}
    </div>
  );
}

// Marker for the toolbar root: a static, never the display name, which minifies away.
ToolbarHostGroup.docxToolbarGroup = true as const;

/** Props for `DocxEditor.Toolbar.Slot`. @public */
export interface DocxEditorToolbarSlotProps {
  /** The built-in slot this content replaces, for example `'text.bold'`. */
  slotId: ChromeSlotId;
  /**
   * Render nothing: inside the preset arrangement this removes the slot in place. A named
   * part with `hidden`, such as `<Toolbar.Bold hidden />`, is shorthand for this override.
   */
  hidden?: boolean;
  /**
   * Content for the slot's "⋯" panel row when the slot leaves the bar. Without it the panel row
   * shows the children under the slot's label.
   */
  overflowContent?: () => DocxEditorChildren;
  children?: DocxEditorChildren;
}

/**
 * Replaces one built-in slot with arbitrary content. The content takes the slot's place and
 * collapses with the slot's group. A slot the preset arrangement does not draw has no place
 * to take, so the content is appended and a development warning names the slot. With
 * `hidden` it removes the slot in place; a named part with `hidden`, such as
 * `<Toolbar.Bold hidden />`, is shorthand for `<Toolbar.Slot slotId="text.bold" hidden />`.
 *
 * @example
 * ```tsx
 * <DocxEditor.Toolbar>
 *   <DocxEditor.Toolbar.Slot slotId="zoom.level" overflowContent={() => <MyZoomList />}>
 *     <MyZoomPicker />
 *   </DocxEditor.Toolbar.Slot>
 * </DocxEditor.Toolbar>
 * ```
 *
 * @public
 */
export function ToolbarSlot(props: DocxEditorToolbarSlotProps) {
  if (props.hidden) return null;
  return <>{props.children}</>;
}

// Marker for the toolbar root, which reads `slotId` from an element that carries it.
ToolbarSlot.docxToolbarSlot = true as const;

/** Where a host control renders: in the bar, or as a row of the "⋯" panel. */
export type ToolbarPlacement = 'bar' | 'panel';

/** Set to `panel` around a collapsed host group's children. */
export const ToolbarPlacementContext = createContext<ToolbarPlacement>('bar');

/** Where the calling control renders. */
export function useToolbarPlacement(): ToolbarPlacement {
  return useContext(ToolbarPlacementContext);
}
