// The section taxonomy of the packaged panes: which slots each pane shows, in which order, under
// which heading. `PANE_SECTIONS` is to the panes what `CHROME_GROUPS` is to the toolbar. The
// Format shape pane and the Chart pane render these sections and hold no logic of their own, so
// a host that builds its own pane, popover, or drawer from the same sections shows the same
// controls with the same enabled state. DOM-free.

import type { ChromeSlotId } from './chrome-controls.ts';
import type { EditorPaneId } from './pane-requests.ts';

/** The section ids of each packaged pane. @public */
export interface PaneSectionIds {
  readonly shape: 'fill' | 'outline';
  readonly chart: 'type' | 'elements' | 'colors' | 'data';
}

/** A section id of `pane`, such as `fill` for the shape pane. @public */
export type PaneSectionId<P extends EditorPaneId = EditorPaneId> = PaneSectionIds[P];

/** One section of a pane: a heading and the slots under it, in order. @public */
export interface PaneSection<P extends EditorPaneId = EditorPaneId> {
  /** Stable section id, unique within its pane. */
  readonly id: PaneSectionId<P>;
  /** The i18n key of the heading, or null for a section with no heading. */
  readonly labelKey: string | null;
  readonly slots: readonly ChromeSlotId[];
}

/**
 * The sections of each packaged pane, in pane order. More panes can join in a minor release, so
 * read it with `paneSections(pane)`. @public
 */
export const PANE_SECTIONS: { readonly [P in EditorPaneId]: readonly PaneSection<P>[] } = {
  shape: [
    { id: 'fill', labelKey: 'shape.pane.fill', slots: ['shape.fill', 'shape.fillTransparency'] },
    {
      id: 'outline',
      labelKey: 'shape.pane.outline',
      slots: ['shape.outlineColor', 'shape.outlineWidth', 'shape.outlineDash'],
    },
  ],
  chart: [
    { id: 'type', labelKey: null, slots: ['chart.type'] },
    {
      id: 'elements',
      labelKey: 'chart.format.elements',
      slots: [
        'chart.title',
        'chart.legend',
        'chart.dataLabels',
        'chart.axes',
        'chart.gridlines',
        'chart.categoryAxisTitle',
        'chart.valueAxisTitle',
      ],
    },
    { id: 'colors', labelKey: 'chart.format.colors', slots: ['chart.seriesColor'] },
    { id: 'data', labelKey: null, slots: ['chart.data'] },
  ],
};

/** The sections of `pane`, or none for a pane with no packaged sections. @public */
export function paneSections<P extends EditorPaneId>(pane: P): readonly PaneSection<P>[] {
  return (PANE_SECTIONS[pane] as readonly PaneSection<P>[] | undefined) ?? [];
}

/** Every slot `pane` shows, in pane order. @public */
export function paneSlots(pane: EditorPaneId): readonly ChromeSlotId[] {
  return paneSections(pane).flatMap((section) => section.slots);
}
